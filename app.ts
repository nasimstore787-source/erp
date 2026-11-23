import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from './db.js';
import { installErrorHandler, HttpError } from './errors.js';
import { withTenant } from './db.js';
import { keyFrom } from './security.js';
import { authRoutes } from './routes/auth.js';
import { posRoutes } from './routes/pos.js';
import { shiftRoutes } from './routes/shifts.js';
import { salesRoutes } from './routes/sales.js';
import { conflictRoutes } from './routes/conflicts.js';
import { invoiceRoutes } from './routes/invoices.js';

export interface Session {
  uid: string; tid: string; name: string; post: boolean; reverse: boolean; cashview: boolean; branch: string;
  tv: number;            // token_version: a password change, 2FA change or "sign out everywhere" invalidates every older token
  uk: string;            // login-throttle key "TENANT:username"
  lim?: boolean;         // limited session: password accepted but the policy requires 2FA enrolment first
}
export interface Security { require2fa: 'none' | 'managers' | 'all'; maxFails: number; lockSeconds: number; ipMax: number; key: Buffer }
declare module '@fastify/jwt' { interface FastifyJWT { payload: Session; user: Session } }
declare module 'fastify' {
  interface FastifyInstance { pool: Pool; security: Security; authenticate: (req: FastifyRequest) => Promise<void> }
}

export function deviceInfo(req: FastifyRequest): string {
  return String(req.headers['x-device'] ?? req.headers['user-agent'] ?? 'web').slice(0, 200);
}

export interface AppOptions {
  jwtSecret: string; logger?: boolean; corsOrigin?: string | boolean; trustProxy?: boolean;
  require2fa?: Security['require2fa']; maxFails?: number; lockSeconds?: number; ipMax?: number; totpKey?: string;
}
export async function buildApp(pool: Pool, opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false });
  app.decorate('pool', pool);
  app.decorate('security', { require2fa: opts.require2fa ?? 'none', maxFails: opts.maxFails ?? 5, lockSeconds: opts.lockSeconds ?? 900, ipMax: opts.ipMax ?? 30,
    key: keyFrom(opts.totpKey ?? 'totp:' + opts.jwtSecret) });
  await app.register(helmet);
  await app.register(rateLimit, { global: false });
  await app.register(cors, { origin: opts.corsOrigin ?? false });
  await app.register(jwt, { secret: opts.jwtSecret, sign: { expiresIn: '12h' } });
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try { await req.jwtVerify(); } catch { throw new HttpError(401, 'UNAUTHORIZED', 'يلزم تسجيل الدخول'); }
    const s = req.user as Session & { purpose?: string };
    if (s.purpose || !s.tid || !s.uid) throw new HttpError(401, 'UNAUTHORIZED', 'يلزم تسجيل الدخول');
    // a disabled user, or a token issued before a password / 2FA change, stops working immediately
    const u = await withTenant(pool, s.tid, async (c) => (await c.query('SELECT is_active, token_version FROM users WHERE id = $1', [s.uid])).rows[0]);
    if (!u || !u.is_active || u.token_version !== s.tv) throw new HttpError(401, 'SESSION_ENDED', 'انتهت الجلسة، سجّل الدخول من جديد.');
    if (s.lim && !req.url.startsWith('/api/auth/') && !req.url.startsWith('/api/me'))
      throw new HttpError(403, 'TWO_FA_ENROLLMENT_REQUIRED', 'يجب تفعيل المصادقة الثنائية قبل المتابعة.');
  });
  installErrorHandler(app);
  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(posRoutes, { prefix: '/api' });
  await app.register(shiftRoutes, { prefix: '/api' });
  await app.register(salesRoutes, { prefix: '/api' });
  await app.register(conflictRoutes, { prefix: '/api' });
  await app.register(invoiceRoutes, { prefix: '/api' });
  return app;
}
