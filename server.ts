import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { makePool } from './db.js';

const url = process.env.DATABASE_URL ?? 'postgres://erp_api:erp_api_dev@127.0.0.1:5432/erp_demo';
const secret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-me');
if (!secret) throw new Error('JWT_SECRET is required in production');

const prod = process.env.NODE_ENV === 'production';
if (prod && !process.env.TOTP_ENC_KEY) throw new Error('TOTP_ENC_KEY is required in production (2FA secrets are encrypted with it)');
const app = await buildApp(makePool(url), {
  jwtSecret: secret, logger: true, corsOrigin: process.env.CORS_ORIGIN ?? (prod ? false : true), trustProxy: process.env.TRUST_PROXY === '1',
  require2fa: (process.env.REQUIRE_2FA as 'none' | 'managers' | 'all') ?? (prod ? 'managers' : 'none'), totpKey: process.env.TOTP_ENC_KEY,
});

// serve the built web app when present (single process in simple deployments)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api') ? reply.status(404).send({ code: 'NOT_FOUND' }) : reply.sendFile('index.html'));
}
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
