import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { startApp, login, auth, saleBody, sqlAdmin } from './helpers.js';
import type { Pool } from '../src/db.js';

let app: FastifyInstance; let pool: Pool;
let cashier = ''; let mgr = ''; let boot: any; let shiftId = ''; let date = '';
const item = (code: string) => boot.items.find((i: any) => i.item_code === code);
const post = (token: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(token), payload: payload as any });
const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: auth(token) });
const bootstrap = async () => (await get(cashier, '/api/pos/bootstrap')).json();

beforeAll(async () => {
  ({ app, pool } = await startApp());
  cashier = (await login(app, 'cashier')).token; mgr = (await login(app, 'mgr')).token;
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('auth', () => {
  it('rejects wrong password, unknown user and unknown tenant with the same 401', async () => {
    for (const p of [{ tenant: 'demo', username: 'cashier', password: 'nope' }, { tenant: 'demo', username: 'ghost', password: 'x' }, { tenant: 'zzz', username: 'cashier', password: 'x' }]) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: p });
      expect(r.statusCode).toBe(401); expect(r.json().code).toBe('BAD_CREDENTIALS');
    }
  });
  it('protects every route without a token and validates input', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/pos/bootstrap' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/sales', payload: {} })).statusCode).toBe(401);
    expect((await post(cashier, '/api/sales', { lines: [] })).statusCode).toBe(400);
  });
  it('carries the role flags in the session', async () => {
    expect((await get(cashier, '/api/me')).json()).toMatchObject({ post: true, reverse: false });
    expect((await get(mgr, '/api/me')).json()).toMatchObject({ post: true, reverse: true });
  });
});

describe('shift and cash sale', () => {
  it('bootstrap gives items, customers and no open shift yet', async () => {
    boot = await bootstrap(); date = boot.server_date;
    expect(boot.items.length).toBe(12); expect(boot.shift).toBeNull(); expect(boot.customers.length).toBe(3);
    expect(boot.methods.map((m: any) => m.method)).toContain('CREDIT');
  });
  it('opens a shift; a second one on the same drawer is refused', async () => {
    const r = await post(cashier, '/api/shifts/open', { opening_float: 1000, date });
    expect(r.statusCode).toBe(201); shiftId = r.json().shift_id;
    expect((await post(mgr, '/api/shifts/open', { opening_float: 0, date })).statusCode).toBe(409);
    expect((await bootstrap()).shift.id).toBe(shiftId);
  });
  it('posts a cash sale, deducts stock, and replays idempotently', async () => {
    const rice = item('1001'); const body = saleBody({ shift_id: shiftId, date, lines: [{ item: rice, qty: 2 }], payments: [{ payment_method: 'CASH', amount: 9000 }] });
    const r = await post(cashier, '/api/sales', body);
    expect(r.statusCode).toBe(201); expect(r.json()).toMatchObject({ sync_status: 'SYNCED', replayed: false }); const no = r.json().invoice_no; expect(no).toBeGreaterThan(0);
    expect(Number(item('1001').stock) - Number((await bootstrap()).items.find((i: any) => i.item_code === '1001').stock)).toBe(2);
    const again = await post(cashier, '/api/sales', body);
    expect(again.statusCode).toBe(200); expect(again.json()).toMatchObject({ replayed: true, invoice_no: no });
    expect(Number((await bootstrap()).items.find((i: any) => i.item_code === '1001').stock)).toBe(Number(rice.stock) - 2);   // not deducted twice
    const changed = { ...body, lines: [{ ...body.lines[0], qty: 3 }], payments: [{ payment_method: 'CASH', amount: 13500 }] };
    const bad = await post(cashier, '/api/sales', changed);
    expect(bad.statusCode).toBe(409); expect(bad.json().code).toBe('OFFLINE_UUID_REUSED');
  });
  it('splits a payment between cash and a wallet; the server picks the ledger accounts', async () => {
    const r = await post(cashier, '/api/sales', saleBody({ shift_id: shiftId, date, lines: [{ item: item('1002'), qty: 5 }], payments: [{ payment_method: 'CASH', amount: 2000 }, { payment_method: 'JAIB', amount: 4000 }] }));
    expect(r.statusCode).toBe(201);
  });
  it('refuses payments that do not equal the total, and leaves nothing behind', async () => {
    const before = (await get(cashier, `/api/shifts/${shiftId}/sales`)).json().length;
    const r = await post(cashier, '/api/sales', saleBody({ shift_id: shiftId, date, lines: [{ item: item('1002'), qty: 1 }], payments: [{ payment_method: 'CASH', amount: 1 }] }));
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('ACCOUNTING_VIOLATION');
    expect((await get(cashier, `/api/shifts/${shiftId}/sales`)).json().length).toBe(before);
  });
  it('credit sale needs a customer', async () => {
    const r = await post(cashier, '/api/sales', saleBody({ shift_id: shiftId, date, lines: [{ item: item('1007'), qty: 1 }], payments: [{ payment_method: 'CREDIT', amount: 500 }] }));
    expect(r.statusCode).toBe(409);
  });
});

describe('sync conflicts (S48)', () => {
  let conflictId = '';
  it('an out-of-stock receipt is kept as a conflict, not lost and not an error', async () => {
    const soap = item('1012');           // 3 in stock
    const r = await post(cashier, '/api/sales', saleBody({ shift_id: shiftId, date, lines: [{ item: soap, qty: 5 }], payments: [{ payment_method: 'CASH', amount: 5500 }] }));
    expect(r.statusCode).toBe(202); expect(r.json().sync_status).toBe('SYNC_CONFLICT'); conflictId = r.json().invoice_id;
    expect(r.json().conflict_reason).toMatch(/INSUFFICIENT_STOCK|stock/i);
    const list = (await get(mgr, '/api/sync-conflicts')).json();
    expect(list.conflicts.map((c: any) => c.id)).toContain(conflictId);
    expect(list.conflicts.find((c: any) => c.id === conflictId).lines[0].qty).toBe(5);
  });
  it('an open conflict blocks closing the shift', async () => {
    const r = await post(cashier, `/api/shifts/${shiftId}/close`, { counted_cash: 0, date });
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('SHIFT_HAS_PENDING_INVOICES');
  });
  it('RETRY keeps the conflict while stock is missing; after a restock it posts', async () => {
    const r1 = await post(cashier, `/api/sync-conflicts/${conflictId}/resolve`, { action: 'RETRY' });
    expect(r1.json().sync_status).toBe('SYNC_CONFLICT');
    sqlAdmin("UPDATE stock_balances SET qty_on_hand = qty_on_hand + 10 WHERE item_id = (SELECT id FROM items WHERE item_code = '1012')");
    const r2 = await post(cashier, `/api/sync-conflicts/${conflictId}/resolve`, { action: 'RETRY' });
    expect(r2.statusCode).toBe(200); expect(r2.json().sync_status).toBe('SYNCED');
    expect((await get(mgr, '/api/sync-conflicts')).json().conflicts.map((c: any) => c.id)).not.toContain(conflictId);
  });
  it('a cashier cannot reject; a manager can, with a reason', async () => {
    const soap = item('1012');
    sqlAdmin("UPDATE stock_balances SET qty_on_hand = 0 WHERE item_id = (SELECT id FROM items WHERE item_code = '1012')");
    const r = await post(cashier, '/api/sales', saleBody({ shift_id: shiftId, date, lines: [{ item: soap, qty: 1 }], payments: [{ payment_method: 'CASH', amount: 1100 }] }));
    const id = r.json().invoice_id; expect(r.json().sync_status).toBe('SYNC_CONFLICT');
    expect((await post(cashier, `/api/sync-conflicts/${id}/resolve`, { action: 'REJECT', reason: 'x' })).statusCode).toBe(403);
    expect((await post(mgr, `/api/sync-conflicts/${id}/resolve`, { action: 'REJECT' })).statusCode).toBe(409);   // reason is mandatory
    const ok = await post(mgr, `/api/sync-conflicts/${id}/resolve`, { action: 'REJECT', reason: 'الصنف غير متوفر' });
    expect(ok.statusCode).toBe(200); expect(ok.json().sync_status).toBe('REJECTED');
  });
});

describe('credit limit', () => {
  it('over the limit becomes a conflict; only a manager approves; then RETRY posts', async () => {
    const c2 = boot.customers.find((c: any) => c.code === 'C002');      // limit 20,000
    const flour = item('1004');                                          // 5,200 each
    const r = await post(cashier, '/api/sales', saleBody({ shift_id: shiftId, date, customer_id: c2.id, lines: [{ item: flour, qty: 4 }], payments: [{ payment_method: 'CREDIT', amount: 20800 }] }));
    expect(r.statusCode).toBe(202); expect(r.json().conflict_reason).toMatch(/CREDIT_LIMIT_EXCEEDED/);
    const id = r.json().invoice_id;
    expect((await post(cashier, `/api/sales/${id}/credit-override`, { reason: 'x' })).statusCode).toBe(403);
    expect((await post(cashier, `/api/sync-conflicts/${id}/resolve`, { action: 'RETRY' })).json().sync_status).toBe('SYNC_CONFLICT');
    expect((await post(mgr, `/api/sales/${id}/credit-override`, { reason: 'عميل موثوق' })).statusCode).toBe(200);
    expect((await get(mgr, '/api/sync-conflicts')).json().conflicts.find((c: any) => c.id === id).credit_approved).toBe(true);
    expect((await post(cashier, `/api/sync-conflicts/${id}/resolve`, { action: 'RETRY' })).json().sync_status).toBe('SYNCED');
    const after = (await bootstrap()).customers.find((c: any) => c.code === 'C002');
    expect(Number(after.balance)).toBe(20800);
  });
  it('a customer without a limit can always buy on credit', async () => {
    const c3 = boot.customers.find((c: any) => c.code === 'C003');
    const r = await post(cashier, '/api/sales', saleBody({ shift_id: shiftId, date, customer_id: c3.id, lines: [{ item: item('1004'), qty: 3 }], payments: [{ payment_method: 'CREDIT', amount: 15600 }] }));
    expect(r.statusCode).toBe(201);
  });
});

describe('shift ownership', () => {
  it("a cashier cannot post onto someone else's shift, a manager can", async () => {
    const other = (await login(app, 'mgr')).token;
    // the cashier's shift is open from the earlier tests: the manager may post to it, a second cashier may not
    const forged = (await login(app, 'cashier2')).token;
    const r = await post(forged, '/api/sales', saleBody({ shift_id: shiftId, date, lines: [{ item: item('1009'), qty: 1 }], payments: [{ payment_method: 'CASH', amount: 200 }] }));
    expect(r.statusCode).toBe(403);
    const ok = await post(other, '/api/sales', saleBody({ shift_id: shiftId, date, lines: [{ item: item('1009'), qty: 1 }], payments: [{ payment_method: 'CASH', amount: 200 }] }));
    expect(ok.statusCode).toBe(201);
  });
});

describe('Z-report and closing', () => {
  it('report matches the documents, and the shift closes with zero variance when the count is right', async () => {
    const blind = (await get(cashier, `/api/shifts/${shiftId}/report`)).json();
    expect(blind).toMatchObject({ blind: true, expected_cash: null, net_cash_sales: null });   // the cashier counts without being told the answer
    const rep = (await get(mgr, `/api/shifts/${shiftId}/report`)).json();
    const expected = Number(rep.expected_cash);
    expect(expected).toBe(1000 + 9000 + 2000 + 5500 + 200);          // float + cash sales (soap sale of 5,500 posted after restock)
    const r = await post(cashier, `/api/shifts/${shiftId}/close`, { counted_cash: expected, date });
    expect(r.statusCode).toBe(200); expect(Number(r.json().variance)).toBe(0);
    expect((await bootstrap()).shift).toBeNull();
  });
  it("a cashier cannot read another user's shift; a manager can", async () => {
    const m = await post(mgr, '/api/shifts/open', { opening_float: 0, date });
    expect(m.statusCode).toBe(201);
    expect((await get(cashier, `/api/shifts/${m.json().shift_id}/report`)).statusCode).toBe(403);
    expect((await get(mgr, `/api/shifts/${m.json().shift_id}/report`)).statusCode).toBe(200);
    expect((await post(mgr, `/api/shifts/${m.json().shift_id}/close`, { counted_cash: 0, date })).statusCode).toBe(200);
  });
});
