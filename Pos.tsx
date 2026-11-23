import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, CircleAlert, ShoppingBasket, X } from 'lucide-react';
import type { Bootstrap, Item, SaleBody } from '../api';
import { enqueue, failed, flush, sent } from '../offline';
import { money, receiptNo, reasonAr, today, uuid } from '../format';
import Modal from '../Modal';
import { Basket, Catalog, type CartLine } from './PosPanels';

type Outcome = { kind: 'ok' | 'wait' | 'conflict' | 'fail'; text: string };

export default function Pos({ boot, setBoot, active, initialCart, onPreviewSale }: {
  boot: Bootstrap; setBoot: (b: Bootstrap) => void; active: boolean; initialCart?: Record<string, number>; onPreviewSale?: (body: SaleBody) => number;
}) {
  const [cart, setCart] = useState<Record<string, number>>(() => initialCart ?? {});
  const [basketOpen, setBasketOpen] = useState(false);
  const [dialog, setDialog] = useState<'checkout' | 'clear' | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  if (!active && (basketOpen || dialog)) {
    setBasketOpen(false);
    setDialog(null);
  }
  const byId = useMemo(() => new Map(boot.items.map((i) => [i.id, i])), [boot.items]);
  const lines = Object.entries(cart).flatMap(([id, qty]) => { const item = byId.get(id); return item ? [{ item, qty }] : []; });
  const total = lines.reduce((sum, { item, qty }) => sum + Number(item.price) * qty, 0);
  const count = lines.reduce((sum, { qty }) => sum + qty, 0);

  function add(item: Item, change = 1) {
    setCart((current) => {
      const next = (current[item.id] ?? 0) + change;
      if (change > 0 && next > Number(item.stock)) return current;
      if (next > 0) return { ...current, [item.id]: next };
      const copy = { ...current }; delete copy[item.id]; return copy;
    });
  }

  async function finish(body: SaleBody) {
    if (!onPreviewSale) await enqueue(body);
    const quantities = new Map(body.lines.map((line) => [line.item_id, line.qty]));
    setBoot({ ...boot, items: boot.items.map((item) => quantities.has(item.id) ? { ...item, stock: String(Number(item.stock) - quantities.get(item.id)!) } : item) });
    setCart({}); setDialog(null); setBasketOpen(false);
    if (basketOpen) window.scrollTo({ top: 0, behavior: 'instant' });
    if (onPreviewSale) {
      setOutcome({ kind: 'ok', text: `اكتمل البيع التجريبي — فاتورة رقم ${onPreviewSale(body)}. لم تُرسل أي بيانات.` });
      return;
    }
    setOutcome({ kind: 'wait', text: 'حُفظ الإيصال على الجهاز وبانتظار المزامنة.' });
    void flush().then(() => {
      const receipt = sent().find((entry) => entry.receipt_no === body.receipt_no);
      if (receipt) setOutcome(receipt.sync_status === 'SYNCED' ? { kind: 'ok', text: `تم البيع — فاتورة رقم ${receipt.invoice_no}` } : { kind: 'conflict', text: `حُفظ الإيصال لكنه معلّق: ${reasonAr(receipt.reason)}. راجع المزامنة.` });
      else if (failed().some((entry) => entry.body.offline_uuid === body.offline_uuid)) setOutcome({ kind: 'fail', text: 'رفض الخادم الإيصال. راجع قائمة الإيصالات المرفوضة في شاشة الوردية.' });
    });
  }

  const basketProps = { lines, total, count, add, onCheckout: () => setDialog('checkout'), onClear: () => setDialog('clear') };

  return <>
    {outcome && <div className={`banner ${outcome.kind}`}><span role="status">{outcome.kind === 'ok' ? <CheckCircle2 size={19} aria-hidden="true" /> : <CircleAlert size={19} aria-hidden="true" />}{outcome.text}</span><button className="soft-icon" type="button" onClick={() => setOutcome(null)} aria-label="إخفاء الإشعار"><X size={17} aria-hidden="true" /></button></div>}
    <div className="pos-grid">
      <Catalog items={boot.items} cart={cart} add={add} />
      <Basket {...basketProps} />
    </div>
    <div className="basket-dock">
      <button className="mobile-basket" type="button" aria-haspopup="dialog" onClick={() => setBasketOpen(true)}>
        <span className="dock-icon"><ShoppingBasket size={21} aria-hidden="true" /></span>
        <span className="dock-copy"><strong>عرض السلة</strong><span><bdi>{money(count)}</bdi> وحدة في السلة</span></span>
        <span className="dock-total"><bdi>{money(total)}</bdi> <small>ر.ي</small></span>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      {!basketOpen && <span className="sr-only" role="status"><bdi>{money(count)}</bdi> وحدة في السلة</span>}
    </div>
    {basketOpen && <Modal title="سلة المبيعات" className="sheet-basket" onClose={() => setBasketOpen(false)}><Basket {...basketProps} inSheet /></Modal>}
    {dialog === 'checkout' && <Checkout boot={boot} lines={lines} total={total} onClose={() => setDialog(null)} onDone={finish} preview={!!onPreviewSale} />}
    {dialog === 'clear' && <Modal title="إفراغ سلة المبيعات؟" onClose={() => setDialog(null)}><p className="muted">ستُزال جميع الأصناف من هذه العملية.</p><div className="actions"><button className="btn ghost" type="button" onClick={() => setDialog(null)}>إبقاء السلة</button><button className="btn danger" type="button" onClick={() => { setCart({}); setDialog(null); }}>إفراغ السلة</button></div></Modal>}
  </>;
}

interface Payment { id: number; method: string; amount: string }
function Checkout({ boot, lines, total, onClose, onDone, preview }: { boot: Bootstrap; lines: CartLine[]; total: number; onClose: () => void; onDone: (sale: SaleBody) => Promise<void>; preview: boolean }) {
  const nextPaymentId = useRef(1);
  const saveLock = useRef(false);
  const [payments, setPayments] = useState<Payment[]>([{ id: 0, method: boot.methods.find((method) => method.method === 'CASH')?.method ?? boot.methods[0]?.method ?? '', amount: String(total) }]);
  const [customer, setCustomer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const used = new Set(payments.map(({ method }) => method));
  const paid = payments.reduce((sum, { amount }) => sum + (Number(amount) || 0), 0);
  const rest = Math.round((total - paid) * 100) / 100;
  const hasCredit = used.has('CREDIT');
  const credit = payments.filter(({ method }) => method === 'CREDIT').reduce((sum, { amount }) => sum + (Number(amount) || 0), 0);
  const selected = boot.customers.find((entry) => entry.id === customer);
  const overLimit = selected && Number(selected.credit_limit) > 0 && Number(selected.balance) + credit > Number(selected.credit_limit);
  const isValid = lines.length > 0 && rest === 0 && payments.every(({ method, amount }) => method && Number.isFinite(Number(amount)) && Number(amount) > 0) && (!hasCredit || !!selected);
  const setPay = (id: number, patch: Partial<Payment>) => setPayments((current) => current.map((p) => p.id === id ? { ...p, ...patch } : p));

  async function submit() {
    if (!isValid || !boot.shift || saveLock.current) return;
    saveLock.current = true; setBusy(true); setError('');
    try {
      await onDone({
        offline_uuid: uuid(), receipt_no: receiptNo(), invoice_date: today(), shift_id: boot.shift.id, customer_id: hasCredit ? customer : null,
        lines: lines.map(({ item, qty }) => ({ item_id: item.id, unit_id: item.unit_id, qty, unit_price: Number(item.price) })),
        payments: payments.map(({ method, amount }) => ({ payment_method: method, amount: Number(amount) })),
      });
    } catch {
      setError('تعذّر حفظ الإيصال على الجهاز. السلة ما زالت محفوظة في هذه الشاشة؛ جرّب مرة أخرى.');
      setBusy(false); saveLock.current = false;
    }
  }

  return <Modal title="إتمام البيع" onClose={onClose} locked={busy}>
    <p className="muted">راجع الإجمالي واختر طريقة الدفع.</p>
    {preview && <p className="warnbox">هذه عملية تجريبية ولن تُرسل إلى النظام الفعلي.</p>}
    <div className="checkout-total"><span>المبلغ الإجمالي</span><strong><bdi>{money(total)}</bdi> <small>ر.ي</small></strong></div>
    <fieldset className="payment-fields" disabled={busy}><legend>طرق الدفع</legend>
      {payments.map(({ id, method, amount }, index) => <div className="payrow" key={id}>
        <label>طريقة الدفع {payments.length > 1 ? index + 1 : ''}<select value={method} onChange={(event) => setPay(id, { method: event.target.value })}>
          {!boot.methods.length && <option value="">لا تتوفر طرق دفع</option>}
          {boot.methods.map((m) => <option key={m.method} value={m.method} disabled={used.has(m.method) && m.method !== method}>{m.label_ar}</option>)}
        </select></label>
        <label>المبلغ (ر.ي)<input name={`amount-${id}`} inputMode="decimal" dir="ltr" autoComplete="off" value={amount} onChange={(event) => setPay(id, { amount: event.target.value.replace(/[^\d.]/g, '') })} /></label>
        {payments.length > 1 && <button className="soft-icon" type="button" onClick={() => setPayments((entries) => entries.filter((p) => p.id !== id))} aria-label={`حذف طريقة الدفع ${index + 1}`}><X size={18} aria-hidden="true" /></button>}
      </div>)}
      {payments.length < boot.methods.length && <button className="btn ghost" type="button" onClick={() => { const method = boot.methods.find((m) => !used.has(m.method)); if (method) { const id = nextPaymentId.current++; setPayments((entries) => [...entries, { id, method: method.method, amount: String(Math.max(rest, 0)) }]); } }}>+ إضافة طريقة دفع</button>}
      {rest !== 0 && <p className="error" role="status">{rest > 0 ? `المتبقي ${money(rest)} ر.ي` : `زيادة ${money(-rest)} ر.ي`}</p>}
      {hasCredit && <><label>العميل (للبيع الآجل)<select value={customer} onChange={(event) => setCustomer(event.target.value)}><option value="">اختر العميل…</option>{boot.customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name_ar}</option>)}</select></label>
        {selected && <p className={overLimit ? 'warnbox' : 'muted'}>الرصيد الحالي {money(selected.balance)} · {Number(selected.credit_limit) > 0 ? `السقف ${money(selected.credit_limit)}` : 'بلا سقف'}{overLimit && ' — سيُعلّق الإيصال حتى موافقة المدير.'}</p>}</>}
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="btn primary big" type="button" disabled={!isValid || busy} onClick={submit}>{busy ? 'جارٍ حفظ الإيصال…' : preview ? 'تأكيد البيع التجريبي' : 'تأكيد البيع'}</button>
  </Modal>;
}
