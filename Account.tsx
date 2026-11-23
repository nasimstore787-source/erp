import { useEffect, useState } from 'react';
import { api, ApiError, setToken, type Me } from '../api';

const msg = (x: unknown) => (x instanceof ApiError ? (x.status === 0 ? 'لا يوجد اتصال بالخادم' : x.message) : 'خطأ');

export default function Account({ forced, onChanged, onLogout }: { forced: boolean; onChanged: () => void; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [off, setOff] = useState({ password: '', code: '' });

  const refresh = () => api<Me>('/me').then(setMe).catch((x) => setErr(msg(x)));
  useEffect(() => { refresh(); }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(''); setOk('');
    try { await fn(); } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  }
  const startSetup = () => run(async () => setSetup(await api('/auth/2fa/setup', { method: 'POST', body: {} })));
  const enable = () => run(async () => {
    const r = await api<{ token: string; recovery_codes: string[] }>('/auth/2fa/enable', { body: { code: code.trim() } });
    setToken(r.token); setRecovery(r.recovery_codes); setSetup(null); setCode(''); await refresh();
  });
  const disable = () => run(async () => {
    const r = await api<{ token: string }>('/auth/2fa/disable', { body: { password: off.password, code: off.code.trim() } });
    setToken(r.token); setOff({ password: '', code: '' }); setOk('أُوقفت المصادقة الثنائية'); await refresh();
  });
  const changePassword = () => run(async () => {
    const r = await api<{ token: string }>('/auth/password', { body: pw });
    setToken(r.token); setPw({ current: '', next: '' }); setOk('تم تغيير كلمة المرور، وانتهت الجلسات الأخرى.');
  });
  const logoutAll = () => run(async () => {
    if (!confirm('سيُسجَّل خروجك من كل الأجهزة، بما فيها هذا الجهاز. متابعة؟')) return;
    await api('/auth/logout-all', { method: 'POST', body: {} }); onLogout();
  });

  // the recovery codes are shown exactly once: nothing else on the screen until the user confirms they saved them
  if (recovery) return (
    <div className="stack pad">
      <h2>رموز الاسترداد</h2>
      <p className="warnbox">احفظ هذه الرموز الآن في مكان آمن. كل رمز يعمل مرة واحدة إذا فقدت هاتفك، ولن تظهر مرة أخرى.</p>
      <ul className="codes" dir="ltr">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
      <button className="btn" onClick={() => navigator.clipboard?.writeText(recovery.join('\n'))}>نسخ الرموز</button>
      <button className="btn primary big" onClick={() => { setRecovery(null); onChanged(); }}>حفظتُها، متابعة</button>
    </div>
  );

  return (
    <div className="stack">
      <h2 className="sr-only">إعدادات الأمان</h2>
      {forced && <p className="warnbox">سياسة المنشأة تُلزم حسابك بالمصادقة الثنائية. فعّلها لتتمكن من استخدام النظام.</p>}
      {err && <p className="error" role="alert">{err}</p>}{ok && <p className="okbox" role="status">{ok}</p>}
      {me && (
        <section className="card pad">
          <h3>المصادقة الثنائية <span className={'chip ' + (me.two_fa_enabled ? 'ok' : 'warn')}>{me.two_fa_enabled ? 'مفعّلة' : 'غير مفعّلة'}</span></h3>
          {!me.two_fa_enabled && !setup && (<>
            <p className="muted">تضيف رمزًا يتغير كل 30 ثانية من تطبيق على هاتفك، فلا تكفي كلمة المرور وحدها لدخول حسابك.</p>
            <button className="btn primary" onClick={startSetup} disabled={busy}>تفعيل المصادقة الثنائية</button>
          </>)}
          {setup && (<>
            <p>١. افتح تطبيق مصادقة (Google Authenticator أو Microsoft Authenticator) وامسح الرمز:</p>
            <div className="qr" role="img" aria-label="رمز QR لإعداد المصادقة الثنائية. يمكن إدخال المفتاح يدويًا أدناه." dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
            <p className="muted">أو أدخل هذا المفتاح يدويًا:</p>
            <code className="secret" dir="ltr">{setup.secret}</code>
            <label>٢. اكتب الرمز الظاهر في التطبيق<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" dir="ltr" /></label>
            <button className="btn primary" onClick={enable} disabled={busy || code.trim().length !== 6}>تأكيد وتفعيل</button>
          </>)}
          {me.two_fa_enabled && !me.two_fa_required && (<>
            <p className="muted">لإيقافها أدخل كلمة المرور ورمزًا حاليًا.</p>
            <label>كلمة المرور<input type="password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} autoComplete="current-password" /></label>
            <label>الرمز<input value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} inputMode="numeric" dir="ltr" /></label>
            <button className="btn danger" onClick={disable} disabled={busy || !off.password || off.code.trim().length < 6}>إيقاف المصادقة الثنائية</button>
          </>)}
          {me.two_fa_enabled && me.two_fa_required && <p className="muted">إيقافها غير متاح بسبب سياسة المنشأة.</p>}
        </section>
      )}
      {!forced && (<>
        <section className="card pad">
          <h3>تغيير كلمة المرور</h3>
          <label>كلمة المرور الحالية<input name="current-password" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
          <label>كلمة المرور الجديدة (10 أحرف على الأقل، حروف وأرقام)<input name="new-password" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn primary" onClick={changePassword} disabled={busy || !pw.current || !pw.next}>تغيير كلمة المرور</button>
        </section>
        <section className="card pad">
          <h3>الأجهزة</h3>
          <p className="muted">إن ضاع هاتف أو شككت بوجود من يستخدم حسابك، أنهِ كل الجلسات.</p>
          <button className="btn danger" onClick={logoutAll} disabled={busy}>تسجيل الخروج من كل الأجهزة</button>
        </section>
      </>)}
      {forced && <button className="btn ghost" onClick={onLogout}>تسجيل الخروج</button>}
    </div>
  );
}
