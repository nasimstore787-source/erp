const TOKEN = 'erp.token';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: string) { super(message); }
}
export const getToken = () => localStorage.getItem(TOKEN);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN));

/** status 0 = the phone could not reach the server (offline). Anything else is an answer from the server. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}), 'x-device': navigator.userAgent.slice(0, 120) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'لا يوجد اتصال بالخادم');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && (data?.code === 'UNAUTHORIZED' || data?.code === 'SESSION_ENDED')) { setToken(null); window.dispatchEvent(new Event('erp:logout')); }
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? 'حدث خطأ', data?.detail);
  return data as T;
}

export interface Item { id: string; item_code: string; barcode: string | null; name_ar: string; unit_id: string; price: string; stock: string }
export interface Customer { id: string; code: string; name_ar: string; credit_limit: string; balance: string }
export interface Bootstrap {
  user: { id: string; name: string; can_post: boolean; can_reverse: boolean };
  branch: { id: string; name_ar: string }; warehouse: { id: string; name_ar: string };
  shift: { id: string; opened_at: string; opening_float: string } | null;
  items: Item[]; customers: Customer[]; methods: { method: string; label_ar: string }[]; server_date: string;
}
export interface SaleBody {
  offline_uuid: string; receipt_no: string; invoice_date: string; shift_id: string; customer_id: string | null;
  lines: { item_id: string; unit_id: string; qty: number; unit_price: number }[];
  payments: { payment_method: string; amount: number }[];
}
export interface SaleResult { invoice_id: string; invoice_no: number | null; sync_status: string; replayed: boolean; conflict_reason: string | null; net_total: string }
export interface Conflict {
  id: string; offline_receipt_no: string; invoice_date: string; net_total: string; reason: string; shift_id: string | null; created_at: string;
  cashier: string; customer: string | null; credit_approved: boolean;
  lines: { item: string; qty: number; unit_price: string }[]; payments: { method: string; amount: string }[];
}

export interface InvoiceRow { id: string; invoice_no: number; invoice_date: string; net_total: string; created_at: string; customer: string | null; reversed: boolean; returned_total: string }
export interface InvoiceDetail extends InvoiceRow {
  lines: { id: string; item: string; qty: string; unit_price: string; returned_qty: string; refund_price: number }[];
  payments: { method: string; amount: string }[]; has_customer: boolean; returnable: boolean;
}

export interface Me { two_fa_enabled: boolean; two_fa_required: boolean; lim?: boolean; name: string }
export interface LoginResult { token?: string; needs_2fa?: boolean; challenge?: string }
