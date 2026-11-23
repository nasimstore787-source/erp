import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { deviceInfo } from '../app.js';
import { HttpError } from '../errors.js';

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Open = z.object({ opening_float: z.number().min(0), date: Date_.optional() });
const Close = z.object({ counted_cash: z.number().min(0), date: Date_.optional() });

export async function shiftRoutes(app: FastifyInstance) {
  app.post('/shifts/open', { preHandler: app.authenticate }, async (req, reply) => {
    const s = req.user; const b = Open.parse(req.body);
    const id = await withTenant(app.pool, s.tid, async (c) => {
      const drawer = (await c.query("SELECT id FROM accounts WHERE code = '110102'")).rows[0];
      if (!drawer) throw new HttpError(409, 'SETTINGS_INCOMPLETE', 'حساب صندوق الكاشير غير موجود');
      const r = await c.query('SELECT open_shift($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8) AS id',
        [s.tid, s.branch, s.uid, drawer.id, b.opening_float, s.uid, b.date ?? null, deviceInfo(req)]);
      return r.rows[0].id as string;
    });
    return reply.status(201).send({ shift_id: id });
  });

  app.get('/shifts/:id/report', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(app.pool, s.tid, async (c) => {
      await assertCanSee(c, s, id);
      const r = (await c.query('SELECT fn_shift_report($1,$2) AS r', [s.tid, id])).rows[0].r;
      // blind count: without can_view_cash_balance an OPEN shift does not reveal how much cash the drawer should hold
      if (!s.cashview && r.status === 'OPEN') {
        for (const k of ['net_cash_sales', 'cash_receipts', 'cash_payments', 'petty_cash', 'expected_cash']) r[k] = null;
        r.blind = true;
      }
      return r;
    });
  });

  app.post('/shifts/:id/close', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = Close.parse(req.body);
    return withTenant(app.pool, s.tid, async (c) => {
      await assertCanSee(c, s, id);
      return (await c.query('SELECT close_shift($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6) AS r',
        [s.tid, id, s.uid, b.counted_cash, b.date ?? null, deviceInfo(req)])).rows[0].r;
    });
  });

  app.get('/shifts/:id/sales', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(app.pool, s.tid, async (c) => {
      await assertCanSee(c, s, id);
      return (await c.query(
        `SELECT id, invoice_no, offline_receipt_no, invoice_date, net_total, status, sync_status, is_return
           FROM sales_invoices WHERE shift_id = $1 ORDER BY created_at DESC LIMIT 100`, [id])).rows;
    });
  });
}

// a cashier sees only their own shifts; a manager (can_reverse) sees all
async function assertCanSee(c: import('../db.js').Client, s: { uid: string; reverse: boolean }, shiftId: string) {
  const r = (await c.query('SELECT cashier_user_id FROM pos_shifts WHERE id = $1', [shiftId])).rows[0];
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'الوردية غير موجودة');
  if (!s.reverse && r.cashier_user_id !== s.uid) throw new HttpError(403, 'PERMISSION_DENIED', 'ليست ورديتك');
}
