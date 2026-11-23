import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(buf: Buffer): string {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b32decode(s: string): Buffer {
  let bits = 0, val = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => b32encode(randomBytes(20));
export const totpStep = (nowMs = Date.now()) => Math.floor(nowMs / 30000);
export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', b32decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/** returns the matching time step (±1 step of clock drift) or null */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const t = totpStep(nowMs);
  for (const s of [t, t - 1, t + 1]) {
    const a = Buffer.from(totpAt(secretB32, s)), b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return s;
  }
  return null;
}
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

// ---------- encryption of the TOTP secret at rest (AES-256-GCM); the key never lives in the database ----------
export function keyFrom(secret: string): Buffer { return createHash('sha256').update(secret).digest(); }
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob: string, key: Buffer): string {
  const [iv, tag, ct] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// ---------- recovery codes: XXXXX-XXXXX, stored only as SHA-256 hashes, each usable once ----------
const RC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => { const b = randomBytes(10); const s = Array.from(b, (x) => RC[x % RC.length]).join(''); return `${s.slice(0, 5)}-${s.slice(5)}`; });
}
export const normalizeRecovery = (c: string) => c.replace(/[\s-]/g, '').toUpperCase();
export const hashRecovery = (c: string) => createHash('sha256').update(normalizeRecovery(c)).digest('hex');

// ---------- password policy ----------
export function passwordProblem(pw: string, username: string): string | null {
  if (pw.length < 10) return 'كلمة المرور يجب ألا تقل عن 10 أحرف';
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return 'يجب أن تحتوي كلمة المرور على حروف وأرقام';
  if (pw.toLowerCase().includes(username.toLowerCase())) return 'لا تضع اسم المستخدم داخل كلمة المرور';
  if (/^(.)\1+$/.test(pw) || ['1234567890', 'password12', 'qwertyuiop'].includes(pw.toLowerCase())) return 'كلمة المرور سهلة التخمين';
  return null;
}
