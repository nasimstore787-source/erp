import { useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, LayoutGrid, ShieldCheck } from 'lucide-react';
import { api, ApiError, setToken, type LoginResult } from '../api';
import { Brand } from '../Workstation';

const msg = (error: unknown) => error instanceof ApiError ? (error.status === 0 ? 'تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم أعد المحاولة.' : error.message) : 'تعذّر تسجيل الدخول. أعد المحاولة.';

export default function Login({ onDone, preview = false }: { onDone: () => void; preview?: boolean }) {
  const [tenant, setTenant] = useState(() => preview ? '' : localStorage.getItem('erp.tenant') ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || preview) return;
    setBusy(true); setErr('');
    try {
      if (challenge) {
        const r = await api<{ token: string }>('/auth/2fa', { body: { challenge, code: code.trim() } });
        setToken(r.token); localStorage.setItem('erp.tenant', tenant); onDone();
      } else {
        const r = await api<LoginResult>('/auth/login', { body: { tenant, username, password } });
        if (r.needs_2fa && r.challenge) { setChallenge(r.challenge); setCode(''); setPassword(''); }
        else if (r.token) { localStorage.setItem('erp.tenant', tenant); setToken(r.token); onDone(); }
        else { throw new Error('Missing session'); }
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CHALLENGE_EXPIRED') { setChallenge(null); setPassword(''); setCode(''); }
      setErr(msg(error));
    } finally { setBusy(false); }
  }

  return <div className="login-layout">
    <aside className="login-hero">
      <Brand />
      <div><div className="login-kicker"><span /> مساحة عمل رِفد</div><h2>مبيعات يومية، <em>بخطوات أوضح.</em></h2><p>نقطة البيع والفواتير والوردية، في مساحة عمل واحدة.</p></div>
      <div className="login-features"><span><LayoutGrid size={18} aria-hidden="true" /> كتالوج الأصناف</span><span><ShieldCheck size={18} aria-hidden="true" /> أمان الحساب</span></div>
    </aside>
    <main className="login-main">
      <form className="login card pad" onSubmit={submit}>
        <span className="panel-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
        <h1>{challenge ? 'التحقق بخطوتين' : 'تسجيل الدخول'}</h1>
        <p className="muted">{challenge ? 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة، أو استخدم رمز استرداد.' : 'أدخل بيانات حسابك للانتقال إلى نقطة البيع.'}</p>
        {preview && <p className="warnbox">هذه معاينة للشاشة فقط. لا تُدخل بيانات حسابك هنا.</p>}
        {challenge ? <label>رمز التحقق<input name="verification-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" spellCheck={false} dir="ltr" required /></label> : <>
          <label>رمز الشركة<input name="tenant" value={tenant} onChange={(event) => setTenant(event.target.value)} autoCapitalize="characters" autoComplete="organization" spellCheck={false} disabled={preview} required /></label>
          <label>اسم المستخدم<input name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoComplete="username" spellCheck={false} disabled={preview} required /></label>
          <label htmlFor="login-password">كلمة المرور</label>
          <div className="password-field"><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={preview} required /><button className="soft-icon" type="button" disabled={preview} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShowPassword((show) => !show)}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div>
        </>}
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary login-submit" disabled={preview || busy || (!!challenge && code.trim().length < 6)}>{busy ? (challenge ? 'جارٍ التحقق…' : 'جارٍ تسجيل الدخول…') : challenge ? 'تأكيد رمز التحقق' : 'دخول'} <ArrowLeft size={17} aria-hidden="true" /></button>
        {challenge && <button type="button" className="btn ghost" onClick={() => { setChallenge(null); setErr(''); setPassword(''); }}>الرجوع إلى تسجيل الدخول</button>}
        {preview && <a className="login-back" href="/#pos">العودة إلى معاينة نقطة البيع</a>}
      </form>
    </main>
  </div>;
}
