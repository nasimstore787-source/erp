import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { withTenant } from '../db.js';
import type { Session } from '../app.js';
import { decrypt, encrypt, hashRecovery, newRecoveryCodes, newTotpSecret, normalizeRecovery, otpauthUri, passwordProblem, totpStep, verifyTotp } from '../security.js';

const DUMMY = bcrypt.hashSync('not-a-real-password', 10);   // equalises timing for unknown users
const Login = z.object({ tenant: z.string().min(1).max(32), username: z.string().min(1).max(80), password: z.string().min(1).max(200) });
const Code = z.string().min(6).max(20);
const ISSUER = 'نقطة البيع';

export async function authRoutes(app: FastifyInstance) {
  const { pool, security: sec } = app;
  const q = <T = any>(sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => r.rows as T[]);

  const gate = async (key: string) => {
    const [{ s }] = await q('SELECT fn_login_gate($1) AS s', [key]);
    if (s > 0) throw new HttpError(429, 'LOCKED', `محاولات كثيرة فاشلة. حاول بعد ${Math.ceil(s / 60)} دقيقة.`);
  };
  const fail = async (key: string, code: string, msg: string): Promise<never> => {
    const [{ f }] = await q('SELECT fn_login_failed($1,$2,$3) AS f', [key, sec.maxFails, sec.lockSeconds]);
    if (f >= sec.maxFails) throw new HttpError(429, 'LOCKED', `محاولات كثيرة فاشلة. حاول بعد ${Math.ceil(sec.lockSeconds / 60)} دقيقة.`);
    throw new HttpError(401, code, msg);
  };

  /** builds the session from a fresh lookup: role flags and the policy decide whether it is limited to 2FA enrolment */
  async function issue(tenantCode: string, username: string, key: string) {
    const [u] = await q('SELECT * FROM fn_auth_lookup($1,$2)', [tenantCode, username]);
    const [sc] = await q('SELECT * FROM fn_auth_secrets($1)', [u.out_user_id]);
    const prof = await withTenant(pool, u.out_tenant_id, async (c) => (await c.query('SELECT full_name_ar, branch_id FROM users WHERE id = $1', [u.out_user_id])).rows[0]);
    const needs2fa = sec.require2fa === 'all' || (sec.require2fa === 'managers' && u.out_can_reverse);
    const session: Session = { uid: u.out_user_id, tid: u.out_tenant_id, name: prof.full_name_ar, post: u.out_can_post, reverse: u.out_can_reverse,
      cashview: u.out_can_view_cash_balance, branch: prof.branch_id, tv: sc.out_token_version, uk: key, ...(needs2fa && !u.out_two_fa_enabled ? { lim: true } : {}) };
    return { token: app.jwt.sign(session), session };
  }
  const sessionFor = async (s: Session, tv: number): Promise<Session> => ({ uid: s.uid, tid: s.tid, name: s.name, post: s.post, reverse: s.reverse, cashview: s.cashview, branch: s.branch, uk: s.uk, tv });

  /** TOTP (never replayable) or a single-use recovery code. Returns true when accepted. */
  async function checkSecondFactor(uid: string, secretEnc: string | null, hashes: string[], code: string): Promise<boolean> {
    if (/^\d{6}$/.test(code) && secretEnc) {
      const step = verifyTotp(decrypt(secretEnc, sec.key), code);
      if (step === null) return false;
      const [{ ok }] = await q('SELECT fn_auth_totp_used($1,$2) AS ok', [uid, step]);
      return ok === true;
    }
    const h = hashRecovery(code);
    if (!hashes.includes(h)) return false;
    const [{ ok }] = await q('SELECT fn_auth_use_recovery($1,$2::jsonb,$3::jsonb) AS ok', [uid, JSON.stringify(hashes), JSON.stringify(hashes.filter((x) => x !== h))]);
    return ok === true;
  }

  const limit = { config: { rateLimit: { max: sec.ipMax, timeWindow: '1 minute' } } };

  app.post('/auth/login', limit, async (req) => {
    const b = Login.parse(req.body);
    const tenant = b.tenant.toUpperCase(); const key = `${tenant}:${b.username.toLowerCase()}`;
    await gate(key);
    const [u] = await q('SELECT * FROM fn_auth_lookup($1,$2)', [tenant, b.username]);
    const ok = await bcrypt.compare(b.password, u?.out_password_hash ?? DUMMY);
    if (!u || !ok || !u.out_is_active) return fail(key, 'BAD_CREDENTIALS', 'بيانات الدخول غير صحيحة');
    if (u.out_two_fa_enabled) {
      // password accepted, second factor pending: the throttle is NOT reset until the code is right
      const challenge = app.jwt.sign({ purpose: '2fa', tc: tenant, un: b.username, uid: u.out_user_id } as never, { expiresIn: '5m' });
      return { needs_2fa: true, challenge };
    }
    await q('SELECT fn_login_ok($1)', [key]);
    return issue(tenant, b.username, key);
  });

  app.post('/auth/2fa', limit, async (req) => {
    const b = z.object({ challenge: z.string().min(10), code: Code }).parse(req.body);
    let ch: { purpose?: string; tc: string; un: string; uid: string };
    try { ch = app.jwt.verify(b.challenge); } catch { throw new HttpError(401, 'CHALLENGE_EXPIRED', 'انتهت مهلة التحقق، سجّل الدخول من جديد.'); }
    if (ch.purpose !== '2fa') throw new HttpError(401, 'CHALLENGE_EXPIRED', 'انتهت مهلة التحقق، سجّل الدخول من جديد.');
    const key = `${ch.tc}:${ch.un.toLowerCase()}`;
    await gate(key);
    const [u] = await q('SELECT * FROM fn_auth_lookup($1,$2)', [ch.tc, ch.un]);
    if (!u || u.out_user_id !== ch.uid || !u.out_is_active || !u.out_two_fa_enabled) throw new HttpError(401, 'CHALLENGE_EXPIRED', 'انتهت مهلة التحقق، سجّل الدخول من جديد.');
    const [sc] = await q('SELECT * FROM fn_auth_secrets($1)', [u.out_user_id]);
    if (!(await checkSecondFactor(u.out_user_id, sc.out_totp_secret_enc, sc.out_recovery_hashes, b.code))) return fail(key, 'BAD_CODE', 'رمز التحقق غير صحيح');
    await q('SELECT fn_login_ok($1)', [key]);
    return issue(ch.tc, ch.un, key);
  });

  const auth = { preHandler: app.authenticate };
  const creds = (s: Session) => withTenant(pool, s.tid, async (c) => (await c.query('SELECT * FROM fn_user_credentials($1,$2)', [s.tid, s.uid])).rows[0]);

  app.get('/me', auth, async (req) => {
    const c = await creds(req.user);
    return { ...req.user, two_fa_enabled: c.out_two_fa_enabled, two_fa_required: sec.require2fa === 'all' || (sec.require2fa === 'managers' && req.user.reverse) };
  });

  // --- enrolment: generate a secret (not active yet) ---
  app.post('/auth/2fa/setup', auth, async (req) => {
    const s = req.user; const c = await creds(s);
    if (c.out_two_fa_enabled) throw new HttpError(409, 'TWO_FA_ALREADY', 'المصادقة الثنائية مفعّلة بالفعل');
    const secret = newTotpSecret();
    await withTenant(pool, s.tid, (cl) => cl.query('SELECT fn_user_set_2fa($1,$2,$3,false,$4::jsonb,false)', [s.tid, s.uid, encrypt(secret, sec.key), '[]']));
    const uri = otpauthUri(secret, s.uk.split(':')[1] + '@' + s.uk.split(':')[0], ISSUER);
    return { secret, otpauth: uri, qr_svg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
  });

  // --- confirm with a first valid code; shows the recovery codes once; returns a fresh token (old ones die) ---
  app.post('/auth/2fa/enable', { ...limit, preHandler: app.authenticate }, async (req) => {
    const s = req.user; const b = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const c = await creds(s);
    if (c.out_two_fa_enabled) throw new HttpError(409, 'TWO_FA_ALREADY', 'المصادقة الثنائية مفعّلة بالفعل');
    if (!c.out_totp_secret_enc) throw new HttpError(409, 'TWO_FA_NOT_STARTED', 'ابدأ الإعداد أولًا');
    await gate(s.uk);
    const step = verifyTotp(decrypt(c.out_totp_secret_enc, sec.key), b.code);
    if (step === null || !(await q('SELECT fn_auth_totp_used($1,$2) AS ok', [s.uid, step]))[0].ok) return fail(s.uk, 'BAD_CODE', 'رمز التحقق غير صحيح');
    const codes = newRecoveryCodes();
    const tv = await withTenant(pool, s.tid, async (cl) => (await cl.query('SELECT fn_user_set_2fa($1,$2,$3,true,$4::jsonb,true) AS v', [s.tid, s.uid, c.out_totp_secret_enc, JSON.stringify(codes.map(hashRecovery))])).rows[0].v as number);
    return { recovery_codes: codes, token: app.jwt.sign(await sessionFor(s, tv)) };
  });

  app.post('/auth/2fa/disable', { ...limit, preHandler: app.authenticate }, async (req) => {
    const s = req.user; const b = z.object({ password: z.string().min(1).max(200), code: Code }).parse(req.body);
    if (sec.require2fa === 'all' || (sec.require2fa === 'managers' && s.reverse)) throw new HttpError(403, 'TWO_FA_REQUIRED', 'سياسة المنشأة تُلزمك بالمصادقة الثنائية');
    const c = await creds(s);
    if (!c.out_two_fa_enabled) throw new HttpError(409, 'TWO_FA_NOT_ENABLED', 'المصادقة الثنائية غير مفعّلة');
    await gate(s.uk);
    if (!(await bcrypt.compare(b.password, c.out_password_hash))) return fail(s.uk, 'BAD_CREDENTIALS', 'كلمة المرور غير صحيحة');
    if (!(await checkSecondFactor(s.uid, c.out_totp_secret_enc, c.out_recovery_hashes, b.code))) return fail(s.uk, 'BAD_CODE', 'رمز التحقق غير صحيح');
    const tv = await withTenant(pool, s.tid, async (cl) => (await cl.query('SELECT fn_user_set_2fa($1,$2,NULL,false,$3::jsonb,true) AS v', [s.tid, s.uid, '[]'])).rows[0].v as number);
    return { token: app.jwt.sign(await sessionFor(s, tv)) };
  });

  app.post('/auth/password', { ...limit, preHandler: app.authenticate }, async (req) => {
    const s = req.user; const b = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).parse(req.body);
    await gate(s.uk);
    const c = await creds(s);
    if (!(await bcrypt.compare(b.current, c.out_password_hash))) return fail(s.uk, 'BAD_CREDENTIALS', 'كلمة المرور الحالية غير صحيحة');
    const bad = passwordProblem(b.next, s.uk.split(':')[1]); if (bad) throw new HttpError(400, 'WEAK_PASSWORD', bad);
    if (b.next === b.current) throw new HttpError(400, 'WEAK_PASSWORD', 'اختر كلمة مرور مختلفة عن الحالية');
    const hash = await bcrypt.hash(b.next, 11);
    const tv = await withTenant(pool, s.tid, async (cl) => (await cl.query('SELECT fn_user_set_password($1,$2,$3) AS v', [s.tid, s.uid, hash])).rows[0].v as number);
    return { token: app.jwt.sign(await sessionFor(s, tv)) };
  });

  // sign out of every device (all tokens of this user stop working)
  app.post('/auth/logout-all', auth, async (req) => {
    const s = req.user;
    await withTenant(pool, s.tid, (cl) => cl.query('SELECT fn_user_bump_tokens($1,$2)', [s.tid, s.uid]));
    return { ok: true };
  });
}
export type { FastifyRequest };
