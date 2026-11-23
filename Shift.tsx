import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Bootstrap } from '../api';
import { failed, flush, queue, dismissFailed, sent, total, type Failed } from '../offline';
import { money, reasonAr, time, today } from '../format';

interface Report {
  status: string; opening_float: string; net_cash_sales: string | null; cash_receipts: string | null; cash_payments: string | null; petty_cash: string | null;
  expected_cash: string | null; counted_cash: string | null; variance: string | null; wallets: Record<string, string>; credit_sales: string; blind?: boolean;
}
const WALLET: Record<string, string> = { JAIB: 'جيب', JAWALI: 'جوالي', ONECASH: 'ون كاش', KURAIMI: 'الكريمي', BANK_TRANSFER: 'تحويل بنكي' };

export default function Shift({ boot, reload, example }: { boot: Bootstrap; reload: () => Promise<void>; example?: Report }) {
  const shift = boot.shift;
  const [report, setRep] = useState<Report | null>(null);
  const rep = example ?? report;
  const [counted, setCounted] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const fails: Failed[] = failed();

  const load = useCallback(async () => {
    if (!shift || example) return;
    try { setRep(await api<Report>(`/shifts/${shift.id}/report`)); } catch { /* offline: keep what we have */ }
  }, [shift, example]);
  useEffect(() => { load(); const f = () => tick((n) => n + 1); window.addEventListener('erp:queue', f); return () => window.removeEventListener('erp:queue', f); }, [load]);

  async function close() {
    if (!shift) return;
    setBusy(true); setMsg(null);
    try {
      await flush();
      if (queue().length) { setMsg({ kind: 'error', text: `يوجد ${queue().length} إيصال لم يُرسل بعد. اتصل بالإنترنت ثم أعد المحاولة.` }); return; }
      const r = await api<{ variance: string }>(`/shifts/${shift.id}/close`, { body: { counted_cash: Number(counted), date: today() } });
      const v = Number(r.variance);
      setMsg({ kind: 'ok', text: v === 0 ? 'أُغلقت الوردية والعدّ مطابق تمامًا.' : `أُغلقت الوردية. ${v > 0 ? 'زيادة' : 'عجز'} قدره ${money(Math.abs(v))} ر.ي.` });
      await reload();
    } catch (x) { setMsg({ kind: 'error', text: x instanceof ApiError ? x.message + (x.detail && x.code === 'SHIFT_HAS_PENDING_INVOICES' ? '' : '') : 'خطأ' }); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {!shift && <div className="card pad"><p>لا توجد وردية مفتوحة.</p></div>}
      {shift && (
        <>
          <div className="card pad">
            <h2>تقرير الوردية</h2>
            <p className="muted">فُتحت {time(shift.opened_at)}</p>
            {rep ? (
              <dl className="kv">
                <dt>العهدة الافتتاحية</dt><dd>{money(rep.opening_float)}</dd>
                {rep.blind
                  ? <><dt>النقد المتوقع</dt><dd className="muted">مخفي (عدّ أعمى)</dd></>
                  : <><dt>مبيعات نقدية</dt><dd>{money(rep.net_cash_sales)}</dd><dt>النقد المتوقع</dt><dd><b>{money(rep.expected_cash)}</b></dd></>}
                {Object.entries(rep.wallets).map(([k, v]) => <><dt key={k}>{WALLET[k] ?? k}</dt><dd>{money(v)}</dd></>)}
                <dt>مبيعات آجلة</dt><dd>{money(rep.credit_sales)}</dd>
              </dl>
            ) : <p className="muted">التقرير غير متاح دون اتصال.</p>}
          </div>
          <div className="card pad">
            <h2>إغلاق الوردية</h2>
            {example ? <p className="muted">هذه وردية تجريبية للعرض فقط ولا يمكن إغلاقها.</p> : <>
              <label>النقد الفعلي في الدرج بعد العدّ (ر.ي)<input name="counted-cash" inputMode="decimal" autoComplete="off" dir="ltr" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))} /></label>
              {msg && <p className={msg.kind === 'ok' ? 'ok' : 'error'} role="status">{msg.text}</p>}
              <button className="btn primary" disabled={busy || counted === ''} onClick={close}>{busy ? 'جارٍ الإغلاق…' : 'إغلاق الوردية'}</button>
            </>}
          </div>
        </>
      )}
      {fails.length > 0 && (
        <div className="card pad">
          <h2>إيصالات رفضها الخادم</h2>
          <p className="muted">لم تُرحَّل ولم يُخصم لها مخزون. أبلغ المدير ثم أزلها من القائمة.</p>
          <ul className="plain">{fails.map((f) => (
            <li key={f.body.offline_uuid}><b>{f.body.receipt_no}</b> · {money(total(f.body))} ر.ي<br /><span className="error">{f.message}</span>
              <button className="btn ghost" onClick={() => { void dismissFailed(f.body.offline_uuid); }}>إزالة</button></li>))}
          </ul>
        </div>
      )}
      <div className="card pad">
        <h2>آخر الإيصالات المرسلة</h2>
        <ul className="plain">
          {sent().slice(0, 8).map((s) => (
            <li key={s.receipt_no}><bdi>{s.invoice_no ? `#${s.invoice_no}` : s.receipt_no}</bdi> · {money(s.total)} ر.ي · {time(s.at)}
              {s.sync_status !== 'SYNCED' && <span className="chip warn">معلّق: {reasonAr(s.reason)}</span>}</li>))}
          {sent().length === 0 && <li className="muted">لا شيء بعد.</li>}
        </ul>
      </div>
    </div>
  );
}
