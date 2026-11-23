import { useCallback, useEffect, useState } from 'react';
import { CloudCheck } from 'lucide-react';
import { api, ApiError, type Bootstrap, type Conflict } from '../api';
import { money, reasonAr, time } from '../format';

const METHOD: Record<string, string> = { CASH: 'نقدًا', CREDIT: 'آجل', JAIB: 'جيب', JAWALI: 'جوالي', ONECASH: 'ون كاش', KURAIMI: 'الكريمي' };
type Panel = null | 'override' | 'reject' | 'move';

export default function Conflicts({ boot, reload }: { boot: Bootstrap; reload: () => Promise<void> }) {
  const [data, setData] = useState<{ conflicts: Conflict[]; open_shifts: { id: string; opened_at: string }[] } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setData(await api('/sync-conflicts')); setErr(''); } catch (e) { setErr(e instanceof ApiError && e.status === 0 ? 'لا يوجد اتصال بالخادم.' : 'تعذّر التحميل'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack">
      <div className="card pad"><h2>الإيصالات المعلّقة</h2>
        <p className="muted">استلم الخادم هذه الإيصالات ولم يرحّلها. راجع سبب التعارض واختر الإجراء المناسب.</p></div>
      {err && <div className="card pad"><p className="error" role="alert">{err}</p><button className="btn ghost" type="button" onClick={load}>إعادة المحاولة</button></div>}
      {!data && !err && <p className="center muted" role="status">جارٍ تحميل الإيصالات…</p>}
      {data?.conflicts.length === 0 && <div className="card empty-module"><span className="panel-icon"><CloudCheck size={22} aria-hidden="true" /></span><h2>لا توجد إيصالات معلّقة</h2><p>ستظهر هنا الإيصالات التي تحتاج إلى مراجعة.</p></div>}
      {data?.conflicts.map((c) => <Card key={c.id} c={c} boot={boot} shifts={data.open_shifts} done={async () => { await load(); await reload(); }} />)}
    </div>
  );
}

function Card({ c, boot, shifts, done }: { c: Conflict; boot: Bootstrap; shifts: { id: string; opened_at: string }[]; done: () => Promise<void> }) {
  const mgr = boot.user.can_reverse;
  const [panel, setPanel] = useState<Panel>(null); const [reason, setReason] = useState(''); const [shift, setShift] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const isCredit = /^CREDIT_LIMIT/.test(c.reason); const isShift = /^SHIFT_CLOSED/.test(c.reason);

  async function run(fn: () => Promise<unknown>, okText?: string) {
    setBusy(true); setMsg('');
    try { await fn(); if (okText) setMsg(okText); await done(); } catch (e) { setMsg(e instanceof ApiError ? e.message + (e.detail ? ` (${e.detail.slice(0, 120)})` : '') : 'خطأ'); }
    finally { setBusy(false); }
  }
  const resolve = (body: object) => api<{ sync_status: string }>(`/sync-conflicts/${c.id}/resolve`, { body });
  const retry = () => run(async () => {
    const r = await resolve({ action: 'RETRY' });
    if (r.sync_status !== 'SYNCED') throw new ApiError(409, 'STILL', 'ما زال معلّقًا: السبب لم يُعالَج بعد.');
  });

  return (
    <div className="card pad conflict">
      <div className="row"><b>{c.offline_receipt_no}</b><span className="chip warn">{reasonAr(c.reason)}</span></div>
      <p className="muted">{c.cashier}{c.customer ? ` · العميل: ${c.customer}` : ''} · {time(c.created_at)} · {c.invoice_date}</p>
      <ul className="plain small">{c.lines.map((l, i) => <li key={i}>{l.item} × {l.qty} @ {money(l.unit_price)}</li>)}</ul>
      <p>الإجمالي <b>{money(c.net_total)} ر.ي</b> · {c.payments.map((p) => `${METHOD[p.method] ?? p.method} ${money(p.amount)}`).join(' + ')}</p>
      {mgr && <details className="tech"><summary>تفاصيل فنية</summary><code dir="ltr">{c.reason}</code></details>}
      {c.credit_approved && <p className="ok">تمت موافقة المدير على تجاوز السقف — أعد المحاولة.</p>}

      {panel === null && (
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={retry}>إعادة المحاولة</button>
          {mgr && isCredit && !c.credit_approved && <button className="btn" onClick={() => setPanel('override')}>موافقة على تجاوز السقف</button>}
          {mgr && isShift && <button className="btn" onClick={() => setPanel('move')}>نقل لوردية مفتوحة</button>}
          {mgr && <button className="btn danger" onClick={() => setPanel('reject')}>رفض الإيصال</button>}
        </div>
      )}
      {panel && (
        <div className="panel">
          {panel === 'move' && <label>الوردية الهدف<select value={shift} onChange={(e) => setShift(e.target.value)}><option value="">اختر…</option>{shifts.map((s) => <option key={s.id} value={s.id}>وردية فُتحت {time(s.opened_at)}</option>)}</select></label>}
          <label>السبب (مطلوب)<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="actions">
            <button className={`btn ${panel === 'reject' ? 'danger' : 'primary'}`} disabled={busy || !reason.trim() || (panel === 'move' && !shift)} onClick={() => run(async () => {
              if (panel === 'override') { await api(`/sales/${c.id}/credit-override`, { body: { reason } }); setPanel(null); setReason(''); await retry(); }
              if (panel === 'reject') await resolve({ action: 'REJECT', reason });
              if (panel === 'move') await resolve({ action: 'REASSIGN_SHIFT', reason, shift_id: shift });
            })}>{panel === 'override' ? 'موافقة ثم ترحيل' : panel === 'reject' ? 'تأكيد الرفض' : 'نقل وترحيل'}</button>
            <button className="btn ghost" onClick={() => setPanel(null)}>تراجع</button>
          </div>
        </div>
      )}
      {msg && <p className="error" role="alert">{msg}</p>}
      {!mgr && <p className="muted small">الرفض والموافقات والنقل من صلاحية المدير.</p>}
    </div>
  );
}
