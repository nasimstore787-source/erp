import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { startApp, login, auth, saleBody } from './helpers.js';
import type { Pool } from '../src/db.js';

let app: FastifyInstance; let pool: Pool;
let cashier = ''; let mgr = ''; let boot: any; let shiftId = ''; let date = '';
let A = ''; let B = ''; let C = ''; let lineA = ''; let lineB = '';
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload as any });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });
const bootstrap = async () => (await get(cashier, '/api/pos/bootstrap')).json();
const item = (code: string) => boot.items.find((i: any) => i.item_code === code);
const stock = async (code: string) => Number((await bootstrap()).items.find((i: any) => i.item_code === code).stock);
const balance = async (code: string) => Number((await bootstrap()).customers.find((c: any) => c.code === code).balance);
const sell = async (o: Parameters<typeof saleBody>[0]) => (await post(cashier, '/api/sales', saleBody(o))).json();
const ret = (t: string, id: string, body: object) => post(t, `/api/invoices/${id}/return`, { request_id: randomUUID(), shift_id: shiftId, ...body });

beforeAll(async () => {
  ({ app, pool } = await startApp());
  cashier = (await login(app, 'cashier')).token; mgr = (await login(app, 'mgr')).token;
  boot = await bootstrap(); date = boot.server_date;
  shiftId = (await post(cashier, '/api/shifts/open', { opening_float: 500, date })).json().shift_id;
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('finding invoices', () => {
  it('creates the sales used below', async () => {
    const c3 = boot.customers.find((c: any) => c.code === 'C003');
    const a = await sell({ shift_id: shiftId, date, lines: [{ item: item('1001'), qty: 3 }], payments: [{ payment_method: 'CASH', amount: 13500 }] });
    const b = await sell({ shift_id: shiftId, date, customer_id: c3.id, lines: [{ item: item('1002'), qty: 2 }], payments: [{ payment_method: 'CREDIT', amount: 2400 }] });
    const c = await sell({ shift_id: shiftId, date, lines: [{ item: item('1005'), qty: 1 }], payments: [{ payment_method: 'CASH', amount: 1800 }] });
    [A, B, C] = [a.invoice_id, b.invoice_id, c.invoice_id];
    expect([a, b, c].map((x) => x.sync_status)).toEqual(['SYNCED', 'SYNCED', 'SYNCED']);
  });
  it('lists them, filters by number, and shows what is returnable', async () => {
    const list = (await get(cashier, '/api/invoices')).json();
    expect(list.map((i: any) => i.id)).toEqual(expect.arrayContaining([A, B, C]));
    const one = (await get(cashier, `/api/invoices?no=${list.find((i: any) => i.id === A).invoice_no}`)).json();
    expect(one.map((i: any) => i.id)).toEqual([A]);
    const d = (await get(cashier, `/api/invoices/${A}`)).json();
    expect(d).toMatchObject({ returnable: true, reversed: false, has_customer: false });
    lineA = d.lines[0].id; expect(Number(d.lines[0].returned_qty)).toBe(0); expect(d.lines[0].refund_price).toBe(4500);
    lineB = (await get(cashier, `/api/invoices/${B}`)).json().lines[0].id;
  });
  it("a cashier cannot open another cashier's invoice, a manager can", async () => {
    const forged = (await login(app, 'cashier2')).token;
    expect((await get(forged, `/api/invoices/${A}`)).statusCode).toBe(403);
    expect((await get(mgr, `/api/invoices/${A}`)).statusCode).toBe(200);
  });
});

describe('returns', () => {
  it('returns part of a sale in cash: stock comes back, quantities are tracked', async () => {
    const before = await stock('1001');
    const r = await ret(cashier, A, { lines: [{ original_line_id: lineA, qty: 1 }], payments: [{ payment_method: 'CASH', amount: 4500 }] });
    expect(r.statusCode).toBe(201); expect(r.json()).toMatchObject({ net_total: '4500.0000' }); expect(r.json().invoice_no).toBeGreaterThan(0);
    expect(await stock('1001')).toBe(before + 1);
    const d = (await get(cashier, `/api/invoices/${A}`)).json();
    expect(Number(d.lines[0].returned_qty)).toBe(1); expect(Number(d.returned_total)).toBe(4500);
  });
  it('the same request_id is a replay: same document, nothing counted twice', async () => {
    const body = { request_id: randomUUID(), shift_id: shiftId, lines: [{ original_line_id: lineA, qty: 1 }], payments: [{ payment_method: 'CASH', amount: 4500 }] };
    const first = await post(cashier, `/api/invoices/${A}/return`, body); expect(first.statusCode).toBe(201);
    const stockAfter = await stock('1001');
    const again = await post(cashier, `/api/invoices/${A}/return`, body);
    expect(again.statusCode).toBe(200); expect(again.json()).toMatchObject({ return_id: first.json().return_id, invoice_no: first.json().invoice_no, replayed: true });
    expect(await stock('1001')).toBe(stockAfter);
    expect(Number((await get(cashier, `/api/invoices/${A}`)).json().lines[0].returned_qty)).toBe(2);
  });
  it('cannot return more than was sold (cumulative) and nothing is left behind', async () => {
    const r = await ret(cashier, A, { lines: [{ original_line_id: lineA, qty: 2 }], payments: [{ payment_method: 'CASH', amount: 9000 }] });
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('RETURN_EXCEEDS_SOLD');
    expect(Number((await get(cashier, `/api/invoices/${A}`)).json().lines[0].returned_qty)).toBe(2);
  });
  it('refund must equal the value, and a credit refund needs a customer on the invoice', async () => {
    const wrong = await ret(cashier, A, { lines: [{ original_line_id: lineA, qty: 1 }], payments: [{ payment_method: 'CASH', amount: 100 }] });
    expect(wrong.statusCode).toBe(409); expect(wrong.json().code).toBe('ACCOUNTING_VIOLATION');
    const noCust = await ret(cashier, A, { lines: [{ original_line_id: lineA, qty: 1 }], payments: [{ payment_method: 'CREDIT', amount: 4500 }] });
    expect(noCust.statusCode).toBe(409); expect(noCust.json().code).toBe('PAYMENT_INVALID');
    expect(Number((await get(cashier, `/api/invoices/${A}`)).json().lines[0].returned_qty)).toBe(2);
  });
  it("a credit sale is returned to the customer's account", async () => {
    const before = await balance('C003');
    const r = await ret(cashier, B, { lines: [{ original_line_id: lineB, qty: 1 }], payments: [{ payment_method: 'CREDIT', amount: 1200 }] });
    expect(r.statusCode).toBe(201);
    expect(await balance('C003')).toBe(before - 1200);
  });
  it('the cash refunds reduce the expected cash of the shift', async () => {
    const rep = (await get(mgr, `/api/shifts/${shiftId}/report`)).json();
    expect(Number(rep.expected_cash)).toBe(500 + 13500 + 1800 - 2 * 4500);
  });
});

describe('reversing a sale', () => {
  it('only a manager; and not while it has posted returns', async () => {
    expect((await post(cashier, `/api/invoices/${C}/reverse`, { reason: 'x' })).statusCode).toBe(403);
    const r = await post(mgr, `/api/invoices/${A}/reverse`, { reason: 'خطأ في الإدخال' });
    expect(r.statusCode).toBe(409); expect(r.json().detail).toMatch(/posted returns/);
    expect((await post(mgr, `/api/invoices/${C}/reverse`, {})).statusCode).toBe(400);   // reason is mandatory
  });
  it('a manager cancels a cash sale: stock and cash are restored, and it cannot be cancelled or returned again', async () => {
    const stockBefore = await stock('1005');
    const expectedBefore = Number((await get(mgr, `/api/shifts/${shiftId}/report`)).json().expected_cash);
    const r = await post(mgr, `/api/invoices/${C}/reverse`, { reason: 'العميل ألغى الطلب' });
    expect(r.statusCode).toBe(200); expect(r.json().shift_id).toBe(shiftId);
    expect(await stock('1005')).toBe(stockBefore + 1);
    expect(Number((await get(mgr, `/api/shifts/${shiftId}/report`)).json().expected_cash)).toBe(expectedBefore - 1800);
    expect((await get(mgr, `/api/invoices/${C}`)).json()).toMatchObject({ reversed: true, returnable: false });
    expect((await post(mgr, `/api/invoices/${C}/reverse`, { reason: 'again' })).statusCode).toBe(409);
    const lineC = (await get(mgr, `/api/invoices/${C}`)).json().lines[0].id;
    const back = await ret(cashier, C, { lines: [{ original_line_id: lineC, qty: 1 }], payments: [{ payment_method: 'CASH', amount: 1800 }] });
    expect(back.statusCode).toBe(409); expect(back.json().code).toBe('RETURN_INVALID');
  });
  it('the shift still closes with zero variance after returns and a cancellation', async () => {
    const expected = Number((await get(mgr, `/api/shifts/${shiftId}/report`)).json().expected_cash);
    const r = await post(cashier, `/api/shifts/${shiftId}/close`, { counted_cash: expected, date });
    expect(r.statusCode).toBe(200); expect(Number(r.json().variance)).toBe(0);
  });
});

describe('discounted sales', () => {
  it('a return refunds what was really paid per unit (invoice discount share removed)', async () => {
    const sh = (await post(cashier, '/api/shifts/open', { opening_float: 0, date })).json().shift_id;
    const body = { ...saleBody({ shift_id: sh, date, lines: [{ item: item('1001'), qty: 2 }], payments: [{ payment_method: 'CASH', amount: 8100 }] }), discount_amount: 900 };
    const s1 = await post(cashier, '/api/sales', body); expect(s1.statusCode).toBe(201);
    const d = (await get(cashier, `/api/invoices/${s1.json().invoice_id}`)).json();
    expect(d.lines[0].refund_price).toBe(4050);
    const r = await post(cashier, `/api/invoices/${s1.json().invoice_id}/return`, { request_id: randomUUID(), shift_id: sh, lines: [{ original_line_id: d.lines[0].id, qty: 2 }], payments: [{ payment_method: 'CASH', amount: 8100 }] });
    expect(r.statusCode).toBe(201); expect(Number(r.json().net_total)).toBe(8100);       // full return refunds exactly what was paid, not 9,000
    const rep = (await get(mgr, `/api/shifts/${sh}/report`)).json();
    expect(Number(rep.expected_cash)).toBe(0);
    expect((await post(cashier, `/api/shifts/${sh}/close`, { counted_cash: 0, date })).statusCode).toBe(200);
  });
});
