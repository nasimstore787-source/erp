import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { deviceInfo } from '../app.js';

const Resolve = z.object({
  action: z.enum(['RETRY', 'REASSIGN_SHIFT', 'REJECT']),
  reason: z.string().max(300).optional(),
  shift_id: z.string().uuid().optional(),
});

export async function conflictRoutes(app: FastifyInstance) {
  // S48: receipts the server could not post (stock, closed shift, credit limit) - nothing was lost, a person decides.
  app.get('/sync-conflicts', { preHandler: app.authenticate }, async (req) => {
    const s = req.user;
    return withTenant(app.pool, s.tid, async (c) => {
      const conflicts = (await c.query(
        `SELECT i.id, i.offline_receipt_no, i.invoice_date, i.net_total, i.sync_conflict_reason AS reason, i.shift_id,
                i.created_at, u.full_name_ar AS cashier, p.name_ar AS customer, i.credit_override_by IS NOT NULL AS credit_approved,
                (SELECT jsonb_agg(jsonb_build_object('item', it.name_ar, 'qty', l.qty, 'unit_price', l.unit_price) ORDER BY it.name_ar)
                   FROM sales_invoice_lines l JOIN items it ON it.id = l.item_id WHERE l.invoice_id = i.id) AS lines,
                (SELECT jsonb_agg(jsonb_build_object('method', ip.payment_method, 'amount', ip.amount))
                   FROM invoice_payments ip WHERE ip.invoice_id = i.id) AS payments
           FROM sales_invoices i JOIN users u ON u.id = i.created_by LEFT JOIN parties p ON p.id = i.customer_id
          WHERE i.sync_status = 'SYNC_CONFLICT' ORDER BY i.created_at`)).rows;
      const shifts = (await c.query("SELECT id, opened_at, cash_account_id FROM pos_shifts WHERE status = 'OPEN' ORDER BY opened_at")).rows;
      return { conflicts, open_shifts: shifts };
    });
  });

  app.post('/sync-conflicts/:id/resolve', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = Resolve.parse(req.body);
    return withTenant(app.pool, s.tid, async (c) =>
      (await c.query('SELECT resolve_sync_conflict($1,$2,$3,$4,$5,$6,$7) AS r', [s.tid, id, s.uid, b.action, b.reason ?? null, b.shift_id ?? null, deviceInfo(req)])).rows[0].r);
  });
}
