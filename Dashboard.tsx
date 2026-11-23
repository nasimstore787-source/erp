import { useState } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowUpLeft, Banknote, CalendarDays, ChevronLeft, CircleAlert, DatabaseBackup, FileText, PackageSearch, Plus, ReceiptText, ShoppingBag, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { modules, moduleHref, screens, screenHref, visible, type Module, type Role } from './catalog';
import { Action, Badge, Empty, Money, Notice, SearchBox } from './ui';

const week = [['الثلاثاء',38800],['الأربعاء',51700],['الخميس',46000],['الجمعة',74800],['السبت',57300],['الأحد',69000],['الاثنين',84650]] as const;
const month = [['1–7',244500],['8–14',311400],['15–21',284100],['22–28',369750]] as const;
export function SalesChart() {
  const [table, setTable] = useState(false);
  const [period, setPeriod] = useState('آخر 7 أيام');
  const rows = period === 'آخر 7 أيام' ? week : month;
  const max = period === 'آخر 7 أيام' ? 90000 : 400000;
  return <section className="e-panel e-chart" aria-labelledby="sales-chart-title">
    <div className="e-panel-head"><div><h2 id="sales-chart-title">حركة المبيعات</h2><p>صافي المبيعات بالريال اليمني</p></div><label className="e-select"><span className="sr-only">فترة الرسم البياني</span><select value={period} onChange={(e) => setPeriod(e.target.value)}><option>آخر 7 أيام</option><option>هذا الشهر</option></select></label></div>
    {table ? <table className="e-chart-table"><thead><tr><th>الفترة</th><th>صافي المبيعات</th></tr></thead><tbody>{rows.map(([day, value]) => <tr key={day}><td>{day}</td><td><Money value={value} /></td></tr>)}</tbody></table> : <div className="e-chart-body" aria-hidden="true"><div className="e-axis"><span>{max / 1000} ألف</span><span>{Math.round(max / 2000)} ألف</span><span>0</span></div><div className="e-plot">{rows.map(([day, value], index) => <div key={day} className="e-bar-slot"><div className={index === rows.length - 1 ? 'e-bar current' : 'e-bar'} style={{ height: `${value / max * 100}%` }} title={`${day}: ${value.toLocaleString('en-US')} ر.ي`} /><span>{day}</span></div>)}</div></div>}
    <div className="e-chart-foot"><span><i /> صافي المبيعات</span><button className="e-text-action" type="button" aria-pressed={table} onClick={() => setTable(!table)}>{table ? 'اعرض الرسم' : 'اعرض جدول القيم'}</button></div>
  </section>;
}
const stats: { title: string; value: number; icon: LucideIcon; foot: string; tone: string; href: string }[] = [
  { title: 'صافي المبيعات اليوم', value: 84650, icon: TrendingUp, foot: 'أعلى بـ 12.4% من أمس', tone: 'indigo', href: '#/sales/net-sales' },
  { title: 'النقد الداخل', value: 52300, icon: ArrowDownLeft, foot: '14 حركة قبض اليوم', tone: 'green', href: '#/accounting/treasury' },
  { title: 'النقد الخارج', value: 28750, icon: ArrowUpLeft, foot: '6 حركات صرف اليوم', tone: 'amber', href: '#/accounting/treasury' },
  { title: 'مستحقات العملاء', value: 128400, icon: Wallet, foot: 'من 18 عميلًا', tone: 'indigo', href: '#/sales/receivables' },
  { title: 'مستحقات الموردين', value: 96400, icon: ShoppingBag, foot: '3 فواتير تستحق هذا الأسبوع', tone: 'amber', href: '#/purchases/dues' },
  { title: 'أصناف قاربت النفاد', value: 7, icon: PackageSearch, foot: 'في المخزن الرئيسي', tone: 'amber', href: '#/inventory/low-stock' },
];
export function Summary({ role, expanded = false }: { role: Role; expanded?: boolean }) {
  const selected = stats.filter((stat, index) => (expanded || index < 4) && screens.some((screen) => screenHref(screen) === stat.href && visible(screen, role)));
  return selected.length ? <div className="e-kpis">{selected.map(({ title, value, icon: Icon, foot, tone, href }) => <a className="e-kpi e-panel" key={title} href={href}><div className="e-kpi-top"><span className={`e-icon-box ${tone}`}><Icon size={18} aria-hidden="true" /></span><ChevronLeft className="e-kpi-arrow" size={16} aria-hidden="true" /></div><span className="e-kpi-label">{title}</span><strong>{title === 'أصناف قاربت النفاد' ? <bdi>{value}</bdi> : <Money value={value} />}</strong><small>{foot}</small></a>)}</div> : null;
}
const attentions: { title: string; description: string; icon: LucideIcon; href: string; tone: string; detail: string }[] = [
  { title: 'إيصالات تحتاج مراجعة', description: 'بانتظار موافقة المدير', icon: ReceiptText, href: '#/admin/approvals', tone: 'amber', detail: '3' },
  { title: 'أصناف قاربت النفاد', description: 'في المخزن الرئيسي', icon: PackageSearch, href: '#/inventory/low-stock', tone: 'amber', detail: '7' },
  { title: 'آخر نسخة احتياطية', description: '23 نوفمبر 2026 · 02:00', icon: DatabaseBackup, href: '#/backup/backups', tone: 'green', detail: 'ناجحة' },
];
export function Dashboard({ role, branch }: { role: Role; branch: string }) {
  const tasks = attentions.filter((entry) => screens.some((screen) => screenHref(screen) === entry.href && visible(screen, role)));
  const canSell = screens.some((screen) => screen.id === 'quick-sale' && visible(screen, role));
  const canReport = screens.some((screen) => screen.pattern === 'report' && visible(screen, role));
  return <div className="e-stack e-dashboard">
    <div className="e-dash-heading"><div><div className="e-kicker"><span />مساحة العمل</div><h1 id="erp-title">نظرة عامة</h1><p>تابع أداء متجرك وأهم الأعمال التي تحتاج انتباهك.</p></div><span className="e-date"><CalendarDays size={17} aria-hidden="true" />23 نوفمبر 2026</span></div>
    <section className="e-hero" aria-label="مرحبًا بك في مساحة العمل"><div className="e-ledger-art" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div><div className="e-hero-content"><div className="e-hero-kicker"><span />{branch}</div><h2>أهلًا بك، أحمد</h2><p>مبيعاتك وحساباتك ومخزونك، كلّها في دفتر واحد.</p><div className="e-hero-actions">{canSell && <Action href="#pos" kind="primary" icon={Plus}>ابدأ عملية بيع</Action>}{canReport && <Action href="#/reports" kind={canSell ? 'secondary' : 'primary'} icon={ArrowLeft}>اعرض التقارير</Action>}</div></div></section>
    <Summary role={role} />
    {((canSell && canReport) || tasks.length > 0) && <div className="e-dashboard-grid">{canSell && canReport && <SalesChart />}{tasks.length > 0 && <section className="e-panel e-attention"><div className="e-panel-head"><div><h2>يحتاج إلى انتباهك</h2><p>المهام التي تستحق المتابعة اليوم</p></div><span className="e-icon-box amber"><CircleAlert size={18} aria-hidden="true" /></span></div><div>{tasks.map(({ title, description, icon: Icon, href, tone, detail }) => <a className="e-attention-row" href={href} key={title}><span className={`e-icon-box ${tone}`}><Icon size={17} aria-hidden="true" /></span><div><strong>{title}</strong><small>{description}</small></div><bdi className={tone === 'green' ? 'e-good-text' : ''}>{detail}</bdi><ChevronLeft size={16} aria-hidden="true" /></a>)}</div></section>}</div>}
    <section><div className="e-section-title"><div><h2>اختصارات العمل</h2><p>مهامك اليومية دون خطوات إضافية</p></div></div><div className="e-quick-grid">{([
      ['receipt', 'سجّل سند قبض', Plus], ['payment', 'سجّل سند صرف', Banknote], ['journal', 'أنشئ قيد يومية', FileText], ['stock-count', 'ابدأ جرد المخزون', PackageSearch], ['supplier-payment', 'سدّد موردًا', ShoppingBag], ['backup-now', 'أنشئ نسخة احتياطية', DatabaseBackup],
    ] as const).map(([id, label, Icon]) => { const screen = screens.find((row) => row.id === id)!; return visible(screen, role) && <a className="e-panel e-quick" key={id} href={screenHref(screen)}><span className="e-icon-box"><Icon size={18} aria-hidden="true" /></span><strong>{label}</strong><ChevronLeft size={16} aria-hidden="true" /></a>; })}{role === 'cashier' && <Action href="#invoices" icon={ReceiptText}>اعرض الفواتير</Action>}</div></section>
  </div>;
}
const moduleHighlights: Partial<Record<Module, { numbers: [string,string,string][]; actions: string[]; attention?: string }>> = {
  sales: { numbers: [['فواتير اليوم','24','منها 3 مرتجعات'],['ورديات مفتوحة','2','في الفرع الرئيسي وفرع عدن']], actions: ['quick-sale','sales-invoices','shift-history','customers'], attention:'sales-pending' },
  accounting: { numbers: [['سندات اليوم','20','14 قبضًا و6 صرفًا'],['مسودات بانتظار المراجعة','2','الفترة المفتوحة: نوفمبر 2026']], actions: ['receipt','payment','journal','ledger'], attention:'period-requests' },
  inventory: { numbers: [['أصناف نشطة','126','المخزن الرئيسي'],['أصناف قاربت النفاد','7','بحاجة إلى إعادة طلب']], actions: ['items','stock','goods','stock-count'], attention:'low-stock' },
  purchases: { numbers: [['أوامر شراء مفتوحة','3','من موردين نشطين'],['فواتير تستحق قريبًا','3','خلال هذا الأسبوع']], actions: ['purchase-invoices','purchase-invoice','supplier-payment','suppliers'], attention:'dues' },
  admin: { numbers: [['حسابات المستخدمين','8','على 3 فروع'],['إيصالات معلّقة','3','تحتاج موافقة المدير']], actions: ['users','permissions','fiscal','audit'], attention:'approvals' },
  backup: { numbers: [['آخر نسخة ناجحة','02:00','23 نوفمبر 2026'],['النسخ المحفوظة','14','الجدولة يومية']], actions: ['backup-now','backups','restore','schedule'], attention:'backup-log' },
};
function ModuleHighlights({ module, role }: { module: Module; role: Role }) {
  const data = moduleHighlights[module];
  if (!data) return null;
  const actions = data.actions.map((id) => screens.find((screen) => screen.id === id)).filter((screen) => !!screen && visible(screen, role));
  const attention = screens.find((screen) => screen.id === data.attention && visible(screen, role));
  return <>
    {role !== 'cashier' && <div className="e-kpis e-module-kpis">{data.numbers.map(([label,value,description]) => <div className="e-kpi e-panel" key={label}><span className="e-kpi-label">{label}</span><strong><bdi dir="ltr">{value}</bdi></strong><small>{description}</small></div>)}</div>}
    <section className="e-panel e-form"><div><h2>عمليات متكررة</h2><p className="e-caption">ابدأ من الإجراء الذي تحتاجه الآن.</p></div><div className="e-actions">{actions.map((screen, index) => <Action href={screenHref(screen!)} key={screen!.id} kind={index === 0 ? 'primary' : 'secondary'}>{screen!.title}</Action>)}</div>{attention && <Notice tone="info" title="للمتابعة"><a href={screenHref(attention)}>{attention.title} <ChevronLeft size={15} aria-hidden="true" /></a></Notice>}</section>
  </>;
}
export function ModuleDirectory({ module, role, favorites, recent, onFavorite }: { module: Module; role: Role; favorites: string[]; recent: string[]; onFavorite: (id: string) => void }) {
  const [section, setSection] = useState<null | string>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'all' | 'recent' | 'favorites'>('all');
  const isReports = module === 'reports';
  const entries = screens.filter((row) => (isReports ? row.pattern === 'report' : row.module === module) && visible(row, role));
  const labels = isReports ? modules.filter((group) => entries.some((row) => row.module === group.id)).map((group) => [group.id, group.title]) : ['العمليات','الإعدادات','التقارير'].filter((s) => entries.some((row) => row.section === s)).map((s) => [s,s]);
  const results = entries.filter((row) => (!section || (isReports ? row.module : row.section) === section) && (view === 'all' || (view === 'favorites' ? favorites : recent).includes(row.id)) && row.title.includes(search.trim())).sort((a,b) => view === 'recent' ? recent.indexOf(a.id) - recent.indexOf(b.id) : 0);
  return <div className="e-stack">{isReports ? <><Summary role={role} expanded />{(role === 'owner' || role === 'accountant') && <div className="e-dashboard-grid"><SalesChart /><section className="e-panel e-attention"><div className="e-panel-head"><div><h2>الأصناف الأكثر مبيعًا</h2><p>اليوم في الفرع الرئيسي</p></div></div>{[['أرز بسمتي 5 كجم',28],['زيت طبخ 1.5 لتر',19],['سكر ناعم 1 كجم',17]].map(([name, value]) => <div className="e-attention-row" key={name}><span className="e-icon-box"><ShoppingBag size={16} aria-hidden="true" /></span><strong>{name}</strong><bdi>{value}</bdi></div>)}</section></div>}</> : module === 'backup' ? <Notice title="آخر نسخة ناجحة" tone="good">23 نوفمبر 2026 · 02:00 · النسخ التلقائي يعمل حسب الجدول.</Notice> : module === 'admin' ? <Notice title="آخر نسخة ناجحة" tone="good">23 نوفمبر 2026 · 02:00 <a href="#/backup/backups">اعرض النسخ المتاحة</a></Notice> : module === 'inventory' ? <Notice title="7 أصناف قاربت النفاد" tone="warn"><a href="#/inventory/low-stock">راجع النواقص وإعادة الطلب</a></Notice> : null}
    {!isReports && <ModuleHighlights module={module} role={role} />}
    <section className="e-panel e-directory"><div className="e-panel-head"><div><h2>{isReports ? 'دليل التقارير' : 'شاشات الوحدة'}</h2><p>{entries.length} شاشة متاحة لهذا الدور</p></div>{isReports && <div className="e-segments" aria-label="نوع قائمة التقارير"><button type="button" onClick={() => setView('all')} aria-pressed={view === 'all'}>كل التقارير</button><button type="button" onClick={() => setView('recent')} aria-pressed={view === 'recent'}>فُتحت مؤخرًا</button><button type="button" onClick={() => setView('favorites')} aria-pressed={view === 'favorites'}>المفضلة</button></div>}</div>
    <div className="e-list-tools"><SearchBox value={search} set={setSearch} label={isReports ? 'ابحث عن تقرير' : 'ابحث عن شاشة'} /><div className="e-segments"><button type="button" aria-pressed={section === null} onClick={() => setSection(null)}>الكل</button>{labels.map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}</div></div>
    {results.length === 0 ? <Empty title="لا توجد نتائج" action={<Action onClick={() => { setSection(null); setView('all'); setSearch(''); }}>امسح كل الفلاتر</Action>}>ابحث باسم آخر أو اعرض الشاشات المتاحة.</Empty> : <div className="e-directory-grid">{labels.map(([id,label]) => { const rows = results.filter((row) => (isReports ? row.module : row.section) === id); if (!rows.length) return null; return <section key={id}><h3>{label}</h3>{rows.map((row) => <div className="e-directory-row" key={row.id}><a href={screenHref(row)}><FileText size={17} aria-hidden="true" />{row.title}<ChevronLeft size={16} aria-hidden="true" /></a>{isReports && <button type="button" className="e-icon-button e-favorite" aria-label={`المفضلة: ${row.title}`} aria-pressed={favorites.includes(row.id)} onClick={() => onFavorite(row.id)}>{favorites.includes(row.id) ? '★' : '☆'}</button>}</div>)}</section>; })}</div>}
    </section>
  </div>;
}

export const records = [
  ['سند قبض', '128', 'مؤسسة النور التجارية', 18400, 'posted', '#/accounting/vouchers'],
  ['فاتورة مشتريات', '305', 'شركة اليمن للتوريدات', 42500, 'posted', '#/purchases/purchase-detail'],
  ['قيد يومية', '186', 'تحصيلات الفرع الرئيسي', 12500, 'posted', '#/accounting/journal-detail'],
  ['استلام بضاعة', '67', 'المخزن الرئيسي', 21600, 'pending', '#/inventory/goods'],
] as const;
export function RecentRecords() { return <section className="e-panel"><div className="e-panel-head"><div><h2>أحدث المستندات</h2><p>الحركات المسجلة في الفرع الرئيسي</p></div><Action href="#/accounting/vouchers">اعرض السجل</Action></div>{records.map(([type, id, party, value, status, href]) => <a className="e-attention-row" key={id} href={href}><span className="e-icon-box"><FileText size={17} aria-hidden="true" /></span><div><strong>{type} <bdi>#{id}</bdi></strong><small>{party}</small></div><Money value={value} /><Badge status={status} /></a>)}</section>; }
