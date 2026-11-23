import { useSyncExternalStore, type ReactNode } from 'react';
import { ChevronLeft, Clock3, FlaskConical, LayoutGrid, LogOut, ReceiptText, RefreshCw, Store, UserRound, Wifi, WifiOff } from 'lucide-react';
import type { Bootstrap } from './api';

export const modules = {
  pos: { title: 'نقطة البيع', description: 'أضف الأصناف إلى السلة وأتمم عملية البيع من مكان واحد.', icon: LayoutGrid },
  invoices: { title: 'الفواتير', description: 'ابحث في الفواتير الصادرة وراجع تفاصيل المبيعات والمرتجعات.', icon: ReceiptText },
  shift: { title: 'الوردية', description: 'راجع العهدة النقدية وحركة المبيعات في ورديتك الحالية.', icon: Clock3 },
  conflicts: { title: 'المزامنة', description: 'تابع حالة الإيصالات وعالج عمليات البيع المعلّقة.', icon: RefreshCw },
  account: { title: 'حسابي', description: 'أدر إعدادات الأمان وكلمة المرور وجلسات تسجيل الدخول.', icon: UserRound },
} as const;
export type Tab = keyof typeof modules;

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
function currentTab(): Tab {
  const value = window.location.hash.slice(1);
  return Object.hasOwn(modules, value) ? value as Tab : 'pos';
}
export function useTab() { return useSyncExternalStore(subscribe, currentTab); }

export function Brand({ className = '' }: { className?: string }) {
  return <div className={`identity ${className}`}>
    <span className="brand-mark"><Store size={23} aria-hidden="true" /></span>
    <span><strong>رِفد</strong><small>نظام إدارة المبيعات</small></span>
  </div>;
}

export default function Workstation({ boot, tab, offline, pending = 0, problems = 0, preview = false, onLogout, children }: {
  boot: Bootstrap; tab: Tab; offline: boolean; pending?: number; problems?: number; preview?: boolean; onLogout?: () => void; children: ReactNode;
}) {
  const active = modules[tab];
  const today = new Intl.DateTimeFormat('ar-YE-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Aden' }).format(new Date(boot.server_date + 'T12:00:00+03:00'));
  const initials = boot.user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
  return <div className="workstation">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>انتقل إلى المحتوى</a>
    <aside className="rail">
      <Brand />
      <div className="workplace"><span className="rail-symbol"><Store size={17} aria-hidden="true" /></span><span><strong>{boot.branch.name_ar}</strong><small>{boot.warehouse?.name_ar ?? 'لم يُحدد مخزن'}</small></span></div>
      <nav aria-label="القائمة الرئيسية" className="navigation">
        <p className="rail-label">مساحة العمل</p>
        {(Object.keys(modules) as Tab[]).map((key) => {
          const { icon: Icon, title } = modules[key];
          return <a key={key} href={`#${key}`} aria-current={tab === key ? 'page' : undefined}><Icon size={19} aria-hidden="true" /><span>{title}</span>{key === 'conflicts' && problems > 0 && <b className="rail-count">{problems}</b>}</a>;
        })}
      </nav>
      <div className="rail-end">
        <div className="rail-shift"><span className={boot.shift ? 'status-dot' : 'status-dot inactive'} /><span><strong>{boot.shift ? 'الوردية مفتوحة' : 'لا توجد وردية مفتوحة'}</strong><small>{boot.shift ? 'الصندوق جاهز للبيع' : 'افتح وردية لبدء البيع'}</small></span></div>
        {onLogout && <button className="rail-logout" type="button" onClick={onLogout}><LogOut size={17} aria-hidden="true" />تسجيل الخروج</button>}
      </div>
    </aside>
    <div className="work-area">
      <header className="toolbar">
        <Brand className="mobile-brand" />
        <div className="breadcrumb"><span>مساحة العمل</span><ChevronLeft size={14} aria-hidden="true" /><strong>{active.title}</strong></div>
        <div className="toolbar-actions">
          {preview && <a className="erp-return-link" href="#/" aria-label="العودة إلى لوحة رِفد"><LayoutGrid size={16} aria-hidden="true" /><span>لوحة رِفد</span></a>}
          {preview && <span className="toolbar-badge preview-badge"><FlaskConical size={14} aria-hidden="true" />معاينة التصميم</span>}
          <span className={`toolbar-badge ${offline ? 'offline' : 'online'}`} role="status">{offline ? <WifiOff size={15} aria-hidden="true" /> : <Wifi size={15} aria-hidden="true" />}{offline ? 'دون اتصال' : preview ? 'وضع تجريبي' : 'متصل'}{pending > 0 && <span> · {pending} بانتظار الإرسال</span>}</span>
          <a className="profile" href="#account" aria-label={`الحساب: ${boot.user.name}`}><span className="avatar" aria-hidden="true">{initials}</span><span className="profile-text"><strong>{boot.user.name}</strong><small>{boot.branch.name_ar}</small></span></a>
        </div>
      </header>
      <main className="workspace" data-module={tab} id="main-content" tabIndex={-1}>
        <div className="page-intro">
          <div className="intro-copy"><div className="eyebrow"><span /> {tab === 'pos' ? 'عمليات المبيعات' : 'إدارة المتجر'}</div><h1>{active.title}</h1><p>{active.description}</p></div>
          <div className="work-date"><Clock3 size={18} aria-hidden="true" /><span><small>تاريخ العمل</small><strong>{today}</strong></span></div>
        </div>
        {children}
      </main>
    </div>
  </div>;
}
