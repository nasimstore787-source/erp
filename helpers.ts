import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from '../src/app.js';
import bcrypt from 'bcryptjs';
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePool, type Pool } from '../src/db.js';
import { TEST_DB, TEST_PASSWORD } from './global-setup.js';

export async function startApp(opts: Partial<AppOptions> = {}): Promise<{ app: FastifyInstance; pool: Pool }> {
  const pool = makePool(`postgres://erp_api:erp_api_dev@127.0.0.1:5432/${TEST_DB}`);
  const app = await buildApp(pool, { jwtSecret: 'test-secret', ipMax: 10000, ...opts });
  return { app, pool };
}

/** superuser side-door for fixtures the API intentionally does not offer (e.g. receiving stock) */
export function sqlAdmin(sql: string): string {
  return execFileSync('su', ['postgres', '-c', `psql -X -q -t -A -v ON_ERROR_STOP=1 -d ${TEST_DB} -c "${sql.replace(/"/g, '\\"')}"`]).toString().trim();
}

export async function login(app: FastifyInstance, username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenant: 'demo', username, password: TEST_PASSWORD } });
  if (r.statusCode !== 200) throw new Error(`login failed ${r.statusCode} ${r.body}`);
  return { token: r.json().token as string, session: r.json().session };
}

export const auth = (t: string) => ({ authorization: `Bearer ${t}` });

export function saleBody(o: { shift_id: string; date: string; lines: Array<{ item: any; qty: number }>; payments: Array<{ payment_method: string; amount: number }>; customer_id?: string; uuid?: string }) {
  return {
    offline_uuid: o.uuid ?? randomUUID(), receipt_no: 'T-' + Math.random().toString(36).slice(2, 8), invoice_date: o.date, shift_id: o.shift_id,
    customer_id: o.customer_id ?? null,
    lines: o.lines.map((l) => ({ item_id: l.item.id, unit_id: l.item.unit_id, qty: l.qty, unit_price: Number(l.item.price) })),
    payments: o.payments,
  };
}

/** creates a user directly in the DB (superuser side-door) with the test password */
export function addUser(username: string, role: 'cashier' | 'manager'): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'erp-')); chmodSync(dir, 0o755);
  const file = path.join(dir, 'u.sql');
  const hash = bcrypt.hashSync(TEST_PASSWORD, 4);
  writeFileSync(file, `INSERT INTO users(tenant_id, branch_id, role_id, username, full_name_ar, password_hash)
    SELECT t.id, b.id, r.id, '${username}', '${username}', '${hash}' FROM tenants t JOIN branches b ON b.tenant_id = t.id JOIN roles r ON r.tenant_id = t.id
    WHERE t.code = 'DEMO' AND r.name_ar = '${role === 'manager' ? 'مدير' : 'كاشير'}';`);
  chmodSync(file, 0o644);
  execFileSync('su', ['postgres', '-c', `psql -X -q -v ON_ERROR_STOP=1 -d ${TEST_DB} -f ${file}`]);
}
export { TEST_PASSWORD };
