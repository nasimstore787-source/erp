import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startApp, login, auth, addUser, sqlAdmin, TEST_PASSWORD } from './helpers.js';
import { withTenant, type Pool } from '../src/db.js';
import { totpAt, totpStep } from '../src/security.js';

let app: FastifyInstance; let pool: Pool;
const raw = (username: string, password = TEST_PASSWORD, a = app) => a.inject({ method: 'POST', url: '/api/auth/login', payload: { tenant: 'demo', username, password } });
const post = (t: string, url: string, payload?: unknown, a = app) => a.inject({ method: 'POST', url, headers: auth(t), payload: payload as any });
const get = (t: string, url: string, a = app) => a.inject({ method: 'GET', url, headers: auth(t) });
const resetThrottle = (u: string) => sqlAdmin(`DELETE FROM login_throttle WHERE key = 'DEMO:${u}'`);
const resetStep = (u: string) => sqlAdmin(`UPDATE users SET totp_last_step = NULL WHERE username = '${u}'`);
const tenantId = () => sqlAdmin("SELECT id FROM tenants WHERE code = 'DEMO'");

beforeAll(async () => {
  ({ app, pool } = await startApp());
  for (const u of ['sec_lock', 'sec_reset', 'sec_pw', 'sec_off', 'sec_all', 'sec_2fa', 'sec_pol']) addUser(u, 'cashier');
  addUser('sec_mgr', 'manager');
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('what the application role can no longer see', () => {
  it('cannot read password hashes, 2FA secrets or recovery codes, nor write them', async () => {
    const t = tenantId();
    const attempt = (sql: string) => withTenant(pool, t, (c) => c.query(sql)).then(() => 'allowed', (e) => String(e.message));
    expect(await attempt('SELECT password_hash FROM users')).toMatch(/permission denied/);
    expect(await attempt('SELECT totp_secret_enc FROM users')).toMatch(/permission denied/);
    expect(await attempt('SELECT recovery_hashes FROM users')).toMatch(/permission denied/);
    expect(await attempt("UPDATE users SET password_hash = 'x'")).toMatch(/permission denied/);
    expect(await attempt("UPDATE users SET two_fa_enabled = false")).toMatch(/permission denied/);
    expect(await attempt('SELECT username, is_active FROM users')).toBe('allowed');
    expect(await attempt('SELECT * FROM login_throttle')).toMatch(/permission denied/);
  });
});

describe('lockout after failed logins', () => {
  it('locks on the 5th failure, even for the right password, and treats unknown users identically', async () => {
    for (const user of ['sec_lock', 'nobody_here']) {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await raw(user, 'wrong-password')).statusCode);
      expect(codes).toEqual([401, 401, 401, 401, 429]);                  // same for a real and a non-existent account
      expect((await raw(user)).statusCode).toBe(429);
    }
    const locked = await raw('sec_lock');
    expect(locked.json()).toMatchObject({ code: 'LOCKED' });
    resetThrottle('sec_lock');
    expect((await raw('sec_lock')).statusCode).toBe(200);
  });
  it('a successful login resets the counter', async () => {
    for (let i = 0; i < 3; i++) expect((await raw('sec_reset', 'bad')).statusCode).toBe(401);
    expect((await raw('sec_reset')).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) expect((await raw('sec_reset', 'bad')).statusCode).toBe(401);   // not locked: it started again from zero
    resetThrottle('sec_reset');
  });
});

describe('password change and session revocation', () => {
  it('checks the current password and the policy, then kills every older token', async () => {
    const old = (await login(app, 'sec_pw')).token;
    expect((await post(old, '/api/auth/password', { current: 'wrong', next: 'Another-pass-2026' })).statusCode).toBe(401);
    expect((await post(old, '/api/auth/password', { current: TEST_PASSWORD, next: 'short1' })).json().code).toBe('WEAK_PASSWORD');
    expect((await post(old, '/api/auth/password', { current: TEST_PASSWORD, next: 'onlyletterspassword' })).json().code).toBe('WEAK_PASSWORD');
    expect((await post(old, '/api/auth/password', { current: TEST_PASSWORD, next: 'sec_pw-12345678' })).json().code).toBe('WEAK_PASSWORD');   // contains the username
    const r = await post(old, '/api/auth/password', { current: TEST_PASSWORD, next: 'Another-pass-2026' });
    expect(r.statusCode).toBe(200);
    expect((await get(old, '/api/me')).json().code).toBe('SESSION_ENDED');
    expect((await get(r.json().token, '/api/me')).statusCode).toBe(200);
    expect((await raw('sec_pw')).statusCode).toBe(401);
    expect((await raw('sec_pw', 'Another-pass-2026')).statusCode).toBe(200);
    resetThrottle('sec_pw');
  });
  it('a disabled user is cut off at once, not when the token expires', async () => {
    const t = (await login(app, 'sec_off')).token;
    expect((await get(t, '/api/me')).statusCode).toBe(200);
    sqlAdmin("UPDATE users SET is_active = false WHERE username = 'sec_off'");
    expect((await get(t, '/api/me')).statusCode).toBe(401);
    expect((await raw('sec_off')).statusCode).toBe(401);
  });
  it('"sign out everywhere" ends all tokens of the user', async () => {
    const a = (await login(app, 'sec_all')).token, b = (await login(app, 'sec_all')).token;
    expect((await post(a, '/api/auth/logout-all')).statusCode).toBe(200);
    expect((await get(a, '/api/me')).statusCode).toBe(401); expect((await get(b, '/api/me')).statusCode).toBe(401);
  });
});

describe('two-factor authentication', () => {
  let secret = ''; let token = ''; let recovery: string[] = [];
  it('enrols: setup gives a secret and a QR, a wrong code is refused, a right one activates and shows 8 recovery codes once', async () => {
    token = (await login(app, 'sec_2fa')).token;
    const s = (await post(token, '/api/auth/2fa/setup')).json();
    secret = s.secret; expect(secret).toMatch(/^[A-Z2-7]{32}$/); expect(s.qr_svg).toContain('<svg'); expect(s.otpauth).toContain('otpauth://totp/');
    expect((await post(token, '/api/auth/2fa/enable', { code: '000000' })).statusCode).toBe(401);
    const en = await post(token, '/api/auth/2fa/enable', { code: totpAt(secret, totpStep()) });
    expect(en.statusCode).toBe(200); recovery = en.json().recovery_codes; expect(recovery).toHaveLength(8);
    expect((await get(token, '/api/me')).json().code).toBe('SESSION_ENDED');                // the pre-2FA token no longer works
    token = en.json().token; expect((await get(token, '/api/me')).json()).toMatchObject({ two_fa_enabled: true });
    expect((await post(token, '/api/auth/2fa/setup')).statusCode).toBe(409);                // cannot silently replace an active secret
  });
  it('the secret is not stored in clear and the app role cannot read it', async () => {
    const stored = sqlAdmin("SELECT totp_secret_enc FROM users WHERE username = 'sec_2fa'");
    expect(stored).not.toContain(secret); expect(stored.split('.')).toHaveLength(3);
  });
  it('login now needs the second factor; a code cannot be replayed; wrong codes count towards the lockout', async () => {
    resetThrottle('sec_2fa');
    const l = (await raw('sec_2fa')).json(); expect(l.needs_2fa).toBe(true); expect(l.token).toBeUndefined();
    const twofa = (code: string, challenge = l.challenge) => app.inject({ method: 'POST', url: '/api/auth/2fa', payload: { challenge, code } });
    expect((await twofa(totpAt(secret, totpStep()))).json().code).toBe('BAD_CODE');           // same step as the enrolment code: replay refused
    expect((await twofa('123456')).statusCode).toBe(401);
    const ok = await twofa(totpAt(secret, totpStep() + 1));                                     // next step (within the allowed clock drift)
    expect(ok.statusCode).toBe(200); expect((await get(ok.json().token, '/api/me')).statusCode).toBe(200);
    expect((await twofa(totpAt(secret, totpStep() + 1))).statusCode).toBe(401);                 // and that one is used up now
    resetStep('sec_2fa'); resetThrottle('sec_2fa');
    const codes: number[] = []; for (let i = 0; i < 5; i++) codes.push((await twofa('654321')).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 429]);
    expect((await twofa(totpAt(secret, totpStep()))).statusCode).toBe(429);                     // locked: not even a right code
    resetThrottle('sec_2fa');
  });
  it('a recovery code works exactly once', async () => {
    const challenge = () => raw('sec_2fa').then((r) => r.json().challenge);
    const use = async (code: string) => app.inject({ method: 'POST', url: '/api/auth/2fa', payload: { challenge: await challenge(), code } });
    expect((await use(recovery[0])).statusCode).toBe(200);
    expect((await use(recovery[0])).statusCode).toBe(401);
    expect((await use(recovery[1].toLowerCase().replace('-', ' '))).statusCode).toBe(200);        // forgiving about case and separators
    resetThrottle('sec_2fa');
  });
  it('a challenge token is not a session, and an expired/garbage one is refused', async () => {
    const ch = (await raw('sec_2fa')).json().challenge;
    expect((await get(ch, '/api/me')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/2fa', payload: { challenge: 'x'.repeat(30), code: '123456' } })).json().code).toBe('CHALLENGE_EXPIRED');
  });
  it('disabling needs the password and a code', async () => {
    resetStep('sec_2fa');
    expect((await post(token, '/api/auth/2fa/disable', { password: 'wrong', code: totpAt(secret, totpStep()) })).statusCode).toBe(401);
    expect((await post(token, '/api/auth/2fa/disable', { password: TEST_PASSWORD, code: '111111' })).statusCode).toBe(401);
    const d = await post(token, '/api/auth/2fa/disable', { password: TEST_PASSWORD, code: totpAt(secret, totpStep()) });
    expect(d.statusCode).toBe(200);
    resetThrottle('sec_2fa');
    expect((await raw('sec_2fa')).json().token).toBeTruthy();                                    // plain login again
  });
});

describe('policy: managers must use 2FA', () => {
  let strict: FastifyInstance; let spool: Pool;
  beforeAll(async () => { ({ app: strict, pool: spool } = await startApp({ require2fa: 'managers' })); });
  afterAll(async () => { await strict.close(); await spool.end(); });
  it('a manager without 2FA gets a limited session that can only enrol; then everything opens up', async () => {
    const r = await raw('sec_mgr', TEST_PASSWORD, strict); const t = r.json().token;
    expect(r.json().session.lim).toBe(true);
    const blocked = await get(t, '/api/pos/bootstrap', strict);
    expect(blocked.statusCode).toBe(403); expect(blocked.json().code).toBe('TWO_FA_ENROLLMENT_REQUIRED');
    expect((await get(t, '/api/me', strict)).json()).toMatchObject({ two_fa_required: true, two_fa_enabled: false });
    const secret = (await post(t, '/api/auth/2fa/setup', undefined, strict)).json().secret;
    const en = await post(t, '/api/auth/2fa/enable', { code: totpAt(secret, totpStep()) }, strict);
    expect(en.statusCode).toBe(200);
    expect((await get(en.json().token, '/api/pos/bootstrap', strict)).statusCode).toBe(200);
    const dis = await post(en.json().token, '/api/auth/2fa/disable', { password: TEST_PASSWORD, code: totpAt(secret, totpStep() + 1) }, strict);
    expect(dis.statusCode).toBe(403); expect(dis.json().code).toBe('TWO_FA_REQUIRED');       // a manager cannot opt out
  });
  it('a cashier is not affected by the managers-only policy', async () => {
    const r = await raw('sec_pol', TEST_PASSWORD, strict);
    expect(r.json().session.lim).toBeUndefined();
    expect((await get(r.json().token, '/api/pos/bootstrap', strict)).statusCode).toBe(200);
  });
});

describe('transport hardening', () => {
  it('sends security headers', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['content-security-policy']).toBeTruthy();
  });
  it('limits login attempts per IP address regardless of the username', async () => {
    const { app: tight, pool: p2 } = await startApp({ ipMax: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await tight.inject({ method: 'POST', url: '/api/auth/login', payload: { tenant: 'demo', username: `rl_${i}`, password: 'x' } })).statusCode);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]); expect(codes.slice(5)).toEqual([429, 429]);
    await tight.close(); await p2.end();
  });
});
