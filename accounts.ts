import type { Client } from './db.js';
import { METHODS } from './routes/pos.js';

/** payment method -> ledger account, decided by the SERVER (the phone never chooses a ledger account) */
export async function accountResolver(c: Client, shift: { cash_account_id: string }) {
  const codes = Object.fromEntries(METHODS.filter((m) => 'code' in m).map((m) => [m.method, (m as { code: string }).code]));
  const accs = Object.fromEntries((await c.query('SELECT code, id FROM accounts WHERE code = ANY($1)', [Object.values(codes)])).rows.map((r) => [r.code, r.id]));
  const ctl = (await c.query('SELECT customers_control_account_id AS id FROM tenant_accounting_settings')).rows[0];
  return (m: string): string => (m === 'CASH' ? shift.cash_account_id : m === 'CREDIT' ? ctl.id : accs[codes[m]]);
}
