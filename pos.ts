import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

export const METHODS = [
  { method: 'CASH',    label_ar: 'نقدًا' },
  { method: 'JAIB',    label_ar: 'محفظة جيب',  code: '110201' },
  { method: 'JAWALI',  label_ar: 'محفظة جوالي', code: '110202' },
  { method: 'ONECASH', label_ar: 'ون كاش',      code: '110203' },
  { method: 'KURAIMI', label_ar: 'بنك الكريمي', code: '110204' },
  { method: 'CREDIT',  label_ar: 'آجل (على الحساب)' },
] as const;

export async function posRoutes(app: FastifyInstance) {
  // Everything the cashier phone needs to sell, including offline: one call, cached by the client.
  app.get('/pos/bootstrap', { preHandler: app.authenticate }, async (req) => {
    const s = req.user;
    return withTenant(app.pool, s.tid, async (c) => {
      const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
      const [branch] = await q('SELECT id, name_ar FROM branches WHERE id = $1', [s.branch]);
      const [wh] = await q('SELECT id, name_ar FROM warehouses WHERE branch_id = $1 AND is_active ORDER BY is_default DESC, code LIMIT 1', [s.branch]);
      const [shift] = await q("SELECT id, opened_at, opening_float, cash_account_id FROM pos_shifts WHERE cashier_user_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1", [s.uid]);
      const items = await q(
        `SELECT i.id, i.item_code, i.barcode, i.name_ar, i.base_unit_id AS unit_id, i.default_sale_price AS price,
                COALESCE(b.qty_on_hand, 0) AS stock
           FROM items i LEFT JOIN stock_balances b ON b.item_id = i.id AND b.warehouse_id = $1
          WHERE i.is_active AND i.is_sellable ORDER BY i.name_ar`, [wh?.id ?? null]);
      const [ctl] = await q('SELECT customers_control_account_id AS id FROM tenant_accounting_settings');
      const customers = await q(
        `SELECT p.id, p.code, p.name_ar, p.credit_limit,
                fn_party_balance($1, p.id, $2, CURRENT_DATE) AS balance
           FROM parties p WHERE p.is_active AND p.party_type IN ('CUSTOMER','BOTH') ORDER BY p.name_ar`, [s.tid, ctl?.id ?? null]);
      const [{ d }] = await q("SELECT to_char((now() AT TIME ZONE 'Asia/Riyadh')::date, 'YYYY-MM-DD') AS d");
      return {
        user: { id: s.uid, name: s.name, can_post: s.post, can_reverse: s.reverse },
        branch, warehouse: wh, shift: shift ?? null, items, customers,
        methods: METHODS.map(({ method, label_ar }) => ({ method, label_ar })), server_date: d,
      };
    });
  });
}
