import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Client } from '../db.js';
import { deviceInfo } from '../app.js';
import { HttpError } from '../errors.js';
import { METHODS } from './pos.js';
import { accountResolver } from '../accounts.js';

const Id = z.object({ id: z.string().uuid() });
const Return = z.object({
  request_id: z.string().uuid(),                       // makes a double tap / retry harmless
  shift_id: z.string().uuid(),
  reason: z.string().max(300).optional(),
  lines: z.array(z.object({ original_line_id: z.string().uuid(), qty: z.number().positive() })).min(1).max(200),
  payments: z.array(z.object({ payment_method: z.enum(METHODS.map((m) => m.method) as [string, ...string[]]), amount: z.number().positive() })).min(1).max(10),
});

const LIST_SQL = `
  SELECT i.id, i.invoice_no, i.invoice_date, i.net_total, i.created_at, p.name_ar AS customer, i.shift_id,
         EXISTS (SELECT 1 FROM document_reversals d WHERE d.source_type = 'SALES_INVOICE' AND d.source_id = i.id) AS reversed,
         COALESCE((SELECT SUM(r.net_total) FROM sales_invoices r WHERE r.original_invoice_id = i.id AND r.status = 'POSTED'
                     AND NOT EXISTS (SELECT 1 FROM document_reversals d WHERE d.source_type = 'SALES_INVOICE' AND d.source_id = r.id)), 0) AS returned_total
    FROM sales_invoices i LEFT JOIN parties p ON p.id = i.customer_id
   WHERE i.status = 'POSTED' AND NOT i.is_return`;

/** what the customer actually paid per unit (line discount and the invoice-level discount share removed); floored so a refund never exceeds the payment */
export function refundPrice(unitPrice: number, lineDiscount: number, qty: number, subtotal: number, discount: number): number {
  const factor = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
  return Math.floor((unitPrice - lineDiscount / qty) * factor * 10000) / 10000;
}

async function ownsShiftOrManager(c: Client, s: { uid: string; reverse: boolean }, shiftId: string | null) {
  if (s.reverse) return;
  const r = shiftId ? (await c.query('SELECT cashier_user_id FROM pos_shifts WHERE id = $1', [shiftId])).rows[0] : null;
  if (!r || r.cashier_user_id !== s.uid) throw new HttpError(403, 'PERMISSION_DENIED', 'ليست ورديتك');
}

export async function invoiceRoutes(app: FastifyInstance) {
  // recent POSTED sales (a cashier sees only their own shifts), optionally one invoice number
  app.get('/invoices', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { no } = z.object({ no: z.coerce.number().int().positive().optional() }).parse(req.query);
    return withTenant(app.pool, s.tid, async (c) => {
      const own = s.reverse ? '' : ' AND i.shift_id IN (SELECT id FROM pos_shifts WHERE cashier_user_id = $1)';
      const params: unknown[] = s.reverse ? [] : [s.uid]; let extra = '';
      if (no) { params.push(no); extra = ` AND i.invoice_no = $${params.length}`; }
      return (await c.query(`${LIST_SQL}${own}${extra} ORDER BY i.created_at DESC LIMIT 40`, params)).rows;
    });
  });

  // one sale with what can still be returned per line
  app.get('/invoices/:id', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { id } = Id.parse(req.params);
    return withTenant(app.pool, s.tid, async (c) => {
      const inv = (await c.query(`${LIST_SQL} AND i.id = $1`, [id])).rows[0];
      if (!inv) throw new HttpError(404, 'NOT_FOUND', 'الفاتورة غير موجودة');
      await ownsShiftOrManager(c, s, inv.shift_id);
      const lines = (await c.query(
        `SELECT l.id, it.name_ar AS item, l.qty, l.unit_price, l.line_discount,
                COALESCE((SELECT SUM(r.qty) FROM sales_invoice_lines r JOIN sales_invoices ri ON ri.id = r.invoice_id
                           WHERE r.original_line_id = l.id AND ri.status = 'POSTED'
                             AND NOT EXISTS (SELECT 1 FROM document_reversals d WHERE d.source_type = 'SALES_INVOICE' AND d.source_id = ri.id)), 0) AS returned_qty
           FROM sales_invoice_lines l JOIN items it ON it.id = l.item_id WHERE l.invoice_id = $1 ORDER BY it.name_ar`, [id])).rows;
      const payments = (await c.query('SELECT payment_method AS method, amount FROM invoice_payments WHERE invoice_id = $1', [id])).rows;
      const o = (await c.query('SELECT discount_amount, tax_amount, subtotal, customer_id FROM sales_invoices WHERE id = $1', [id])).rows[0];
      const priced = lines.map(({ line_discount, ...l }) => ({ ...l, refund_price: refundPrice(Number(l.unit_price), Number(line_discount), Number(l.qty), Number(o.subtotal), Number(o.discount_amount)) }));
      return { ...inv, lines: priced, payments, has_customer: !!o.customer_id, returnable: !inv.reversed && Number(o.tax_amount) === 0 };
    });
  });

  app.post('/invoices/:id/return', { preHandler: app.authenticate }, async (req, reply) => {
    const s = req.user; const { id } = Id.parse(req.params); const b = Return.parse(req.body);
    const out = await withTenant(app.pool, s.tid, async (c) => {
      const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
      // idempotent: the same request_id returns the same document
      const [dup] = await q('SELECT id, status FROM sales_invoices WHERE offline_uuid = $1', [b.request_id]);
      let retId: string;
      if (dup) retId = dup.id;
      else {
        const [shift] = await q('SELECT id, cash_account_id, cashier_user_id, status FROM pos_shifts WHERE id = $1', [b.shift_id]);
        if (!shift) throw new HttpError(404, 'NOT_FOUND', 'الوردية غير موجودة');
        if (shift.status !== 'OPEN') throw new HttpError(409, 'SHIFT_CLOSED', 'الوردية مغلقة');
        if (shift.cashier_user_id !== s.uid && !s.reverse) throw new HttpError(403, 'PERMISSION_DENIED', 'هذه الوردية ليست ورديتك');
        const [orig] = await q(`SELECT id, status, is_return, customer_id, warehouse_id, branch_id, subtotal, discount_amount, tax_amount,
                                       EXISTS (SELECT 1 FROM document_reversals d WHERE d.source_type = 'SALES_INVOICE' AND d.source_id = sales_invoices.id) AS reversed
                                  FROM sales_invoices WHERE id = $1`, [id]);
        if (!orig || orig.status !== 'POSTED' || orig.is_return) throw new HttpError(404, 'NOT_FOUND', 'الفاتورة غير موجودة');
        if (orig.reversed) throw new HttpError(409, 'RETURN_INVALID', 'الفاتورة ملغاة');
        if (Number(orig.tax_amount) !== 0) throw new HttpError(409, 'RETURN_INVALID', 'مرتجع الفواتير الضريبية غير مدعوم بعد');
        if (b.payments.some((p) => p.payment_method === 'CREDIT') && !orig.customer_id) throw new HttpError(409, 'PAYMENT_INVALID', 'لا يوجد عميل على الفاتورة للرد على حسابه');

        // the refund price of a line = what the customer actually paid per unit (line discount and the invoice discount share removed)
        const ol = await q('SELECT l.id, l.item_id, l.unit_id, l.qty, l.base_qty, l.unit_price, l.line_discount FROM sales_invoice_lines l WHERE l.invoice_id = $1', [id]);
        const byId = new Map(ol.map((l) => [l.id as string, l]));
        const lines = b.lines.map((l) => {
          const o = byId.get(l.original_line_id);
          if (!o) throw new HttpError(409, 'RETURN_INVALID', 'سطر لا يتبع هذه الفاتورة');
          const price = refundPrice(Number(o.unit_price), Number(o.line_discount), Number(o.qty), Number(orig.subtotal), Number(orig.discount_amount));
          return { original_line_id: o.id, item_id: o.item_id, unit_id: o.unit_id, qty: l.qty, price, total: Math.round(l.qty * price * 10000) / 10000 };
        });
        const total = Math.round(lines.reduce((a, l) => a + l.total, 0) * 10000) / 10000;
        const [{ d, fy }] = await q("SELECT to_char((now() AT TIME ZONE 'Asia/Riyadh')::date,'YYYY-MM-DD') AS d, fn_fiscal_year_for($1, (now() AT TIME ZONE 'Asia/Riyadh')::date) AS fy", [s.tid]);
        const [r] = await q(
          `INSERT INTO sales_invoices (tenant_id, branch_id, fiscal_year_id, sync_status, is_return, original_invoice_id, invoice_date, customer_id, warehouse_id, shift_id,
                                       subtotal, net_total, notes, created_by, device_info, offline_uuid)
           VALUES ($1,$2,$3,'SYNCED',true,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13) RETURNING id`,
          [s.tid, orig.branch_id, fy, id, d, orig.customer_id, orig.warehouse_id, shift.id, total, b.reason ?? null, s.uid, deviceInfo(req), b.request_id]);
        retId = r.id;
        for (const l of lines)
          await c.query(`INSERT INTO sales_invoice_lines (tenant_id, invoice_id, item_id, unit_id, qty, base_qty, unit_price, line_total, original_line_id)
                         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8)`, [s.tid, retId, l.item_id, l.unit_id, l.qty, l.price, l.total, l.original_line_id]);
        const accountFor = await accountResolver(c, shift);
        for (const p of b.payments)
          await c.query('INSERT INTO invoice_payments (tenant_id, invoice_id, payment_method, account_id, amount) VALUES ($1,$2,$3,$4,$5)',
            [s.tid, retId, p.payment_method, accountFor(p.payment_method), p.amount]);
      }
      const post = (await q('SELECT * FROM post_sales_invoice($1,$2,$3,$4)', [s.tid, retId, s.uid, deviceInfo(req)]))[0];
      const [inv] = await q('SELECT net_total FROM sales_invoices WHERE id = $1', [retId]);
      return { return_id: retId, invoice_no: post.out_invoice_no == null ? null : Number(post.out_invoice_no), net_total: inv.net_total, replayed: !!dup };
    });
    return reply.status(out.replayed ? 200 : 201).send(out);
  });

  // full cancellation of a sale (manager). The open shift on the invoice's cash drawer is picked automatically.
  app.post('/invoices/:id/reverse', { preHandler: app.authenticate }, async (req) => {
    const s = req.user; const { id } = Id.parse(req.params); const b = z.object({ reason: z.string().min(1).max(300) }).parse(req.body);
    return withTenant(app.pool, s.tid, async (c) => {
      const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
      const [cash] = await q("SELECT account_id FROM invoice_payments WHERE invoice_id = $1 AND payment_method = 'CASH' LIMIT 1", [id]);
      let shiftId: string | null = null;
      if (cash) {
        const [sh] = await q("SELECT id FROM pos_shifts WHERE status = 'OPEN' AND cash_account_id = $1", [cash.account_id]);
        if (!sh) throw new HttpError(409, 'SHIFT_CLOSED', 'لا توجد وردية مفتوحة على صندوق هذه الفاتورة لرد النقد منها');
        shiftId = sh.id;
      }
      const [{ d }] = await q("SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date AS d");
      const r = await q('SELECT reverse_sales_invoice($1,$2,$3,$4,$5,$6::date,$7) AS e', [s.tid, id, s.uid, b.reason, shiftId, d, deviceInfo(req)]);
      return { ok: true, reversal_entry_id: r[0].e, shift_id: shiftId };
    });
  });
}
