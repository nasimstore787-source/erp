import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { deviceInfo } from '../app.js';
import { HttpError } from '../errors.js';
import { METHODS } from './pos.js';
import { accountResolver } from '../accounts.js';

const Sale = z.object({
  offline_uuid: z.string().uuid(),
  receipt_no: z.string().min(1).max(60),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_id: z.string().uuid(),
  customer_id: z.string().uuid().nullish(),
  discount_amount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(z.object({
    item_id: z.string().uuid(), unit_id: z.string().uuid(),
    qty: z.number().positive(), unit_price: z.number().min(0), line_discount: z.number().min(0).optional(),
  })).min(1).max(200),
  payments: z.array(z.object({
    payment_method: z.enum(METHODS.map((m) => m.method) as [string, ...string[]]), amount: z.number().positive(),
  })).min(1).max(10),
});
const Id = z.object({ id: z.string().uuid() });

export async function salesRoutes(app: FastifyInstance) {
  /**
   * ONE sales path for online and offline: the phone always posts through submit_offline_sale (idempotent by offline_uuid).
   * The server derives branch, warehouse and payment accounts, so the client cannot pick ledger accounts.
   */
  app.post('/sales', { preHandler: app.authenticate }, async (req, reply) => {
    const s = req.user; const b = Sale.parse(req.body);
    const out = await withTenant(app.pool, s.tid, async (c) => {
      const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
      const [shift] = await q('SELECT id, cash_account_id, cashier_user_id FROM pos_shifts WHERE id = $1', [b.shift_id]);
      if (!shift) throw new HttpError(404, 'NOT_FOUND', 'الوردية غير موجودة');
      // a cashier rings sales only on their own shift (a queued receipt must not be re-attributed if another person logs in on the phone)
      if (shift.cashier_user_id !== s.uid && !s.reverse) throw new HttpError(403, 'PERMISSION_DENIED', 'هذه الوردية ليست ورديتك');
      const [wh] = await q('SELECT id FROM warehouses WHERE branch_id = $1 AND is_active ORDER BY is_default DESC, code LIMIT 1', [s.branch]);
      const accountFor = await accountResolver(c, shift);
      const payload = {
        offline_uuid: b.offline_uuid, receipt_no: b.receipt_no, invoice_date: b.invoice_date, branch_id: s.branch, warehouse_id: wh.id,
        shift_id: b.shift_id, customer_id: b.customer_id ?? null, discount_amount: b.discount_amount ?? 0, notes: b.notes ?? null,
        lines: b.lines.map((l) => ({ ...l, base_qty: l.qty, line_discount: l.line_discount ?? 0 })),   // base unit only for now
        payments: b.payments.map((p) => ({ payment_method: p.payment_method, account_id: accountFor(p.payment_method), amount: p.amount })),
      };
      const r = (await c.query('SELECT * FROM submit_offline_sale($1,$2::jsonb,$3,$4)', [s.tid, JSON.stringify(payload), s.uid, deviceInfo(req)])).rows[0];
      const inv = (await c.query('SELECT sync_status, sync_conflict_reason, net_total FROM sales_invoices WHERE id = $1', [r.out_invoice_id])).rows[0];
      return { invoice_id: r.out_invoice_id, invoice_no: r.out_invoice_no == null ? null : Number(r.out_invoice_no), sync_status: r.out_sync_status as string, replayed: r.out_replayed as boolean,
               conflict_reason: inv?.sync_conflict_reason ?? null, net_total: inv?.net_total };
    });
    return reply.status(out.sync_status === 'SYNCED' ? (out.replayed ? 200 : 201) : 202).send(out);
  });

  app.post('/sales/:id/credit-override', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { id } = Id.parse(req.params); const b = z.object({ reason: z.string().min(1).max(300) }).parse(req.body);
    await withTenant(app.pool, s.tid, (c) => c.query('SELECT approve_credit_override($1,$2,$3,$4,$5)', [s.tid, id, s.uid, b.reason, deviceInfo(req)]));
    return { ok: true };
  });
}
