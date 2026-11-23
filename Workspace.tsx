import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Bell, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, DatabaseBackup, LayoutDashboard, Menu, Plus, Search, ShieldCheck, ShoppingBag, Store, Wifi, X } from 'lucide-react';
import { Dashboard, ModuleDirectory } from './Dashboard';
import { moduleHref, modules, roles, screenHref, screens, visible, type Module, type Role } from './catalog';
import { ScreenView } from './Screens';
import { DesignGuide } from './Guide';
import { PickerGuide } from './PickerGuide';
import { Action, Empty, PageIntro } from './ui';

const quick = [
  { id: 'receipt', label: 'سند قبض', href: '#/accounting/receipt', icon: ArrowDownToLine },
  { id: 'payment', label: 'سند صرف', href: '#/accounting/payment', icon: ArrowUpFromLine },
  { id: 'quick-sale', label: 'المبيعات', href: '#pos', icon: Store },
  { id: 'supplier-payment', label: 'سداد الموردين', href: '#/purchases/supplier-payment', icon: ShoppingBag },
  { id: 'reports', label: 'التقارير', href: '#/reports', icon: LayoutDashboard },
];
export default function ErpWorkspace({ hash, role, setRole }: { hash: string; role: Role; setRole: (role: Role) => void }) {
  const [branch, setBranch] = useState('الفرع الرئيسي');
  const [recentReports, setRecentReports] = useState<string[]>([]);
  const [favoriteReports, setFavoriteReports] = useState<string[]>([]);
  const drawer = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  const [rawModule = '', rawScreen = '', extra] = hash.slice(2).split('?')[0].split('/');
  const module = modules.find((group) => group.id === (rawModule || 'home'));
  const route = module && rawScreen ? screens.find((row) => row.module === module.id && row.id === rawScreen) : undefined;
  const anyReports = screens.some((row) => row.pattern === 'report' && visible(row, role));
  const shortcuts = quick.filter((item) => item.id === 'reports' ? anyReports : screens.some((screen) => screen.id === item.id && visible(screen, role)));
  const available = (id: Module) => id === 'home' || id === 'design' || (id === 'reports' ? anyReports : screens.some((row) => row.module === id && visible(row, role)));
  const navGroup = (ids: Module[]) => modules.filter((m) => ids.includes(m.id) && available(m.id)).map(({ id, title, icon: Icon }) => <a key={id} href={moduleHref(id)} aria-current={module?.id === id ? 'page' : undefined} onClick={() => drawer.current?.close()}><Icon size={19} aria-hidden="true" /><span>{title}</span>{module?.id === id && <ChevronLeft className="e-nav-arrow" size={15} aria-hidden="true" />}</a>);
  const pickerGuide = module?.id === 'design' && rawScreen === 'picker';
  const unknown = !module || !!extra || (!!rawScreen && !route && !pickerGuide);
  const denied = !unknown && (!available(module.id) || (!!route && !visible(route, role)));
  const pageTitle = pickerGuide ? 'الاختيار بالرقم أو الاسم' : route?.title;
  const parts = [module?.title, pageTitle].filter(Boolean);
  const subtitle = unknown ? 'صفحة غير موجودة' : denied ? 'الوصول غير المصرّح' : pageTitle || module?.title || 'نظرة عامة';
  const reportId = !unknown && !denied && route?.pattern === 'report' ? route.id : null;
  useEffect(() => {
    if (reportId) setRecentReports((ids) => [reportId, ...ids.filter((id) => id !== reportId)].slice(0, 10));
  }, [reportId]);
  useEffect(() => {
    document.title = `${subtitle} | رِفد`;
    drawer.current?.close();
    if (!firstRoute.current) {
      window.scrollTo(0, 0);
      content.current?.focus({ preventScroll: true });
    }
    firstRoute.current = false;
  }, [hash, subtitle]);
  return <div className="erp" lang="ar" dir="rtl">
    <a className="skip-link" href="#erp-main" onClick={(event) => { event.preventDefault(); content.current?.focus(); }}>انتقل إلى المحتوى</a>
    <aside className="e-rail" aria-label="القائمة الجانبية">
      <a className="e-brand" href="#/"><span><Store size={23} aria-hidden="true" /></span><div><strong>رِفد</strong><small>نظام إدارة الأعمال</small></div></a>
      <nav className="e-nav" aria-label="القائمة الرئيسية"><p>مساحة العمل</p>{navGroup(['home','sales','accounting','inventory','purchases','reports'])}<p>النظام والإعدادات</p>{navGroup(['admin','backup','profile'])}</nav>
      <details className="e-nav e-rail-shortcuts"><summary>اختصارات العمليات</summary>{shortcuts.map(({id,label,href,icon:Icon}) => <a href={href} key={id}><Icon size={17} aria-hidden="true" />{label}</a>)}</details>
      <div className="e-rail-bottom"><a href="#/design"><CircleHelp size={18} aria-hidden="true" /> دليل التصميم <ChevronLeft size={15} aria-hidden="true" /></a><div className="e-rail-note"><span><ShieldCheck size={15} aria-hidden="true" /></span><div><strong>بيئة المعاينة</strong><small>لا تغيّر بياناتك الفعلية</small></div></div></div>
    </aside>
    <div className="e-work">
      <header className="e-topbar"><div className="e-top-start"><button type="button" className="e-icon-button e-menu" aria-label="افتح القائمة" onClick={() => drawer.current?.showModal()}><Menu size={21} aria-hidden="true" /></button><a className="e-mobile-brand" href="#/" aria-label="رِفد، الصفحة الرئيسية"><Store size={20} aria-hidden="true" />رِفد</a><div className="e-breadcrumb"><a href="#/">مساحة العمل</a>{parts.map((part, index) => <span key={part}><ChevronLeft size={14} aria-hidden="true" />{index === 0 && route && module ? <a href={moduleHref(module.id)}>{part}</a> : <strong>{part}</strong>}</span>)}</div></div>
      <div className="e-top-end"><label className="e-branch"><Store size={17} aria-hidden="true" /><span className="sr-only">فرع المعاينة</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option>الفرع الرئيسي</option><option>فرع عدن</option><option>فرع تعز</option></select><ChevronDown size={14} aria-hidden="true" /></label><a className="e-icon-button e-top-search" aria-label="البحث العام" href="#/profile/search"><Search size={19} aria-hidden="true" /></a><a className="e-icon-button e-bell" aria-label="الإشعارات" href="#/profile/notifications"><Bell size={20} aria-hidden="true" /><i /></a><a className="e-avatar" href="#/profile" aria-label="حساب أحمد خالد">أخ</a></div></header>
      <main ref={content} className="e-content" tabIndex={-1} id="erp-main" aria-labelledby="erp-title">
        {unknown || denied ? <div className="e-stack"><PageIntro title={subtitle} description={unknown ? 'قد يكون الرابط تغيّر أو كُتب بشكل غير صحيح.' : 'هذه الشاشة ليست متاحة لدور المعاينة الحالي.'} /><section className="e-panel"><Empty title={unknown ? 'تعذّر العثور على الشاشة' : 'يلزم دور مخوّل'} action={<Action href="#/" kind="primary" icon={ChevronRight}>عُد إلى مساحة العمل</Action>}>{unknown ? 'افتح القائمة لاختيار شاشة من الوحدات المتاحة.' : 'جرّب تغيير دور المعاينة من القائمة الجانبية.'}</Empty></section></div> : module.id === 'home' ? <Dashboard role={role} branch={branch} /> : module.id === 'design' ? pickerGuide ? <PickerGuide /> : <DesignGuide role={role} onRole={setRole} /> : route ? <ScreenView key={route.id} screen={route} role={role} branch={branch} /> : <div className="e-stack"><PageIntro title={module.title} description={module.about} parent={{ href: '#/', label: 'مساحة العمل' }}>{module.id === 'sales' ? <Action href="#pos" kind="primary" icon={Plus}>ابدأ عملية بيع</Action> : module.id === 'backup' ? <Action href="#/backup/backup-now" kind="primary" icon={DatabaseBackup}>أنشئ نسخة احتياطية</Action> : null}</PageIntro><ModuleDirectory key={`${module.id}-${role}`} module={module.id} role={role} favorites={favoriteReports} recent={recentReports} onFavorite={(id) => setFavoriteReports((ids) => ids.includes(id) ? ids.filter((key) => key !== id) : [...ids, id])} /></div>}
        <footer className="e-footer"><Wifi size={15} aria-hidden="true" /> معاينة تفاعلية · بيانات توضيحية فقط <a href="#/design">دليل التصميم</a></footer>
      </main>
    </div>
    <nav className="e-bottom" aria-label="اختصارات الهاتف">{shortcuts.map(({ id, label, href, icon: Icon }) => <a key={id} href={href} className={id === 'quick-sale' ? 'e-bottom-main' : undefined} aria-current={hash === href ? 'page' : undefined}><span><Icon size={20} aria-hidden="true" /></span>{label}</a>)}</nav>
    <dialog className="e-drawer" ref={drawer} aria-labelledby="erp-drawer-title" onClick={(event) => { if (event.target === event.currentTarget) drawer.current?.close(); }}><div><div className="e-drawer-head"><h2 id="erp-drawer-title">مساحة رِفد</h2><button type="button" className="e-icon-button" onClick={() => drawer.current?.close()} aria-label="أغلق القائمة"><X size={20} aria-hidden="true" /></button></div><nav className="e-nav" aria-label="القائمة الكاملة"><p>مساحة العمل</p>{navGroup(['home','sales','accounting','inventory','purchases','reports'])}<p>النظام والإعدادات</p>{navGroup(['admin','backup','profile','design'])}</nav><label className="e-field e-drawer-role">دور المعاينة<select value={role} onChange={(event) => setRole(event.target.value as Role)}>{Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div></dialog>
  </div>;
}
