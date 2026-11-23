import { useState } from 'react';
import { ChevronDown, ChevronLeft, Download, FileText, Printer, SlidersHorizontal, X } from 'lucide-react';
import { moduleHref, type Role, type Screen } from './catalog';
import { accounts, rowsFor, type Sample } from './fixtures';
import { CodeNamePicker } from './CodeNamePicker';
import type { PickerKind } from './pickerCatalog';
import { Action, Badge, demoDate, downloadCsv, Empty, Money, Notice, SearchBox, statusTypes, type Status } from './ui';

export const listHeaders = ['الرقم', 'السجل', 'البيان', 'التاريخ', 'الحالة', 'المبلغ', 'اتجاه الرصيد'];
export const csvRecords = (screen: Screen, rows: Sample[], amounts = true) => downloadCsv(screen.title, [amounts ? listHeaders : listHeaders.slice(0,5), ...rows.map((r) => [r.id,r.title,r.about,r.date,statusTypes[r.status][0],...(amounts ? [r.value ?? '',r.direction ?? ''] : [])])]);
export function RecordRows({ rows, onOpen, total, amounts, valueLabel = 'المبلغ', statusLabels }: { rows: Sample[]; onOpen?: (row: Sample) => void; total?: number; amounts: boolean; valueLabel?: string; statusLabels?: Partial<Record<Status,string>> }) {
  const status = (row: Sample) => statusLabels?.[row.status] ? <span className="e-badge good">{statusLabels[row.status]}</span> : <Badge status={row.status} />;
  return <><div className="e-table-wrap e-desktop-only"><table className="e-table"><thead><tr><th scope="col">المستند / السجل</th><th scope="col">البيان</th><th scope="col">التاريخ</th><th scope="col">الحالة</th>{amounts && <th scope="col" className="e-numeric">{valueLabel}</th>}{onOpen && <th scope="col"><span className="sr-only">الإجراءات</span></th>}</tr></thead><tbody>{rows.map((r) => <tr key={`${r.title}-${r.id}`}><th scope="row"><strong>{r.title}</strong><br/><small dir="ltr">#{r.id}</small></th><td>{r.about}</td><td><bdi dir="ltr">{r.date}</bdi></td><td>{status(r)}</td>{amounts && <td className="e-numeric">{r.value === undefined ? '—' : <><Money value={r.value} digits={2} /> {r.direction && <small>{r.direction}</small>}</>}</td>}{onOpen && <td><button className="e-icon-button" aria-label={`اعرض ${r.title}`} onClick={() => onOpen(r)}><ChevronLeft size={18} aria-hidden="true" /></button></td>}</tr>)}</tbody>{total !== undefined && <tfoot><tr><td colSpan={4}>الإجمالي</td><td className="e-numeric"><Money value={total} digits={2} /></td>{onOpen && <td/>}</tr></tfoot>}</table></div><div className="e-rows e-mobile-only">{rows.map((r) => <article className="e-mobile-row" key={`${r.title}-${r.id}`}><div><strong>{r.title}</strong>{status(r)}</div><p>{r.about}</p><div><small><bdi dir="ltr">#{r.id}</bdi> · <bdi dir="ltr">{r.date}</bdi></small>{amounts && r.value !== undefined && <strong><Money value={r.value} /> {r.direction && <small>{r.direction}</small>}</strong>}</div>{onOpen && <div><button type="button" className="e-text-action" aria-label={`اعرض ${r.title}`} onClick={() => onOpen(r)}>اعرض التفاصيل <ChevronLeft size={15} aria-hidden="true" /></button></div>}</article>)}{total !== undefined && <div className="e-mobile-row"><div><strong>الإجمالي</strong><Money value={total} digits={2} /></div></div>}</div></>;
}

export function Records({ screen, role, rows, primary, onOpen, branch }: { screen: Screen; role: Role; rows: Sample[]; primary?: React.ReactNode; onOpen: (row: Sample) => void; branch: string }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState(false);
  const [tree, setTree] = useState<Record<string,boolean>>({});
  const [state, setState] = useState<'ready'|'loading'|'error'|'empty'>('ready');
  const list = rows.filter((r) => (!status || r.status === status) && `${r.title} ${r.about} ${r.id}`.includes(query.trim())).sort((a,b) => sort === 'recent' ? b.date.localeCompare(a.date) : sort === 'old' ? a.date.localeCompare(b.date) : a.title.localeCompare(b.title, 'ar'));
  const options = [...new Set(rows.map((row) => row.status))];
  const amounts = rows.some((row) => row.value !== undefined);
  const reset = () => { setQuery(''); setStatus(''); setPage(0); setState('ready'); };
  const run = () => { setState('loading'); window.setTimeout(() => setState('ready'), 450); };
  const displayRows = list.slice(page * 8,page * 8 + 8);
  const treeGroups = new Map<string, Sample[]>();
  for (const row of list) {
    const group = row.about.split(' · ')[0];
    const siblings = treeGroups.get(group) ?? [];
    siblings.push(row);
    treeGroups.set(group, siblings);
  }
  return <section className="e-panel" aria-busy={state === 'loading'}>
    <div className="e-panel-head"><div><h2>{screen.pattern === 'inbox' ? 'عناصر تحتاج مراجعة' : 'السجلات'}</h2><p>{list.length} سجل · {branch}</p></div>{primary}</div>
    <div className="e-list-tools"><SearchBox value={query} set={(v) => { setQuery(v); setPage(0); }} label={screen.id === 'search' ? 'ابحث برقم المستند أو باسم الصنف أو الطرف' : 'ابحث بالاسم أو الرقم'} /><Action icon={SlidersHorizontal} onClick={() => setFilter(!filter)}>{filter ? 'أخفِ الفلاتر' : 'اضبط الفلاتر'}</Action></div>
    {filter && <div className="e-list-tools"><label className="e-field">الحالة<select value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(0); }}><option value="">كل الحالات</option>{options.map((value) => <option key={value} value={value}>{statusTypes[value][0]}</option>)}</select></label><label className="e-field">ترتيب السجلات<select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}><option value="recent">الأحدث أولًا</option><option value="old">الأقدم أولًا</option><option value="name">الاسم</option></select></label><Action icon={X} onClick={reset}>امسح الفلاتر</Action></div>}
    {state === 'loading' ? <div className="e-skeleton" role="status" aria-label="جارٍ تحميل السجلات"><i/><i/><i/></div> : state === 'error' ? <Empty title="تعذّر تحميل السجلات" action={<Action onClick={run}>أعد تحميل السجلات</Action>}>تحقّق من الاتصال ثم جرّب التحميل مجددًا.</Empty> : state === 'empty' || list.length === 0 ? <Empty title={query || status ? 'لا توجد نتائج مطابقة' : 'لا توجد سجلات هنا'} action={query || status ? <Action onClick={reset}>امسح كل الفلاتر</Action> : primary || <Action onClick={run}>أعد تحميل السجلات</Action>}>{query || status ? 'جرّب البحث باسم آخر أو وسّع الفلاتر.' : `تظهر سجلات ${screen.title} هنا لتسهيل المتابعة.`}</Empty> : screen.id === 'accounts' ? <div>{[...treeGroups].map(([key, group], index) => <section key={key}><button type="button" className="e-attention-row e-tree-button" aria-expanded={tree[key] ?? index === 0} onClick={() => setTree((t) => ({...t,[key]: !(t[key] ?? index === 0)}))}>{(tree[key] ?? index === 0) ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronLeft size={17} aria-hidden="true" />}<strong>{key}</strong><small>مجموعة · لا تُرحّل مباشرة</small></button>{(tree[key] ?? index === 0) && <RecordRows rows={group ?? []} amounts={role === 'owner' || role === 'accountant'} onOpen={onOpen} />}</section>)}</div> : <RecordRows rows={displayRows} amounts={amounts} onOpen={onOpen} statusLabels={screen.id === 'backups' ? { posted: 'نسخة ناجحة' } : undefined} />}
    <div className="e-panel-head e-print-hidden"><small className="e-caption">{list.length > 8 ? `صفحة ${page + 1} من ${Math.ceil(list.length / 8)}` : 'بيانات العرض التوضيحي'}</small><div className="e-actions">{list.length > 8 && <><button className="e-button secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>الصفحة السابقة</button><button className="e-button secondary" type="button" disabled={(page+1)*8 >= list.length} onClick={() => setPage(page + 1)}>الصفحة التالية</button></>}<label className="e-caption e-state-select">حالة العرض <select value={state} onChange={(e) => e.target.value === 'loading' ? run() : setState(e.target.value as typeof state)}><option value="ready">السجلات</option><option value="loading">تحميل</option><option value="empty">فارغة</option><option value="error">خطأ</option></select></label></div></div>
  </section>;
}

const reportPickers: Record<string,[PickerKind,string]> = {
  ledger:['account','الحساب'], 'customer-statement':['customer','العميل'], 'supplier-statement':['supplier','المورد'],
  'purchase-by-supplier':['supplier','المورد'], 'top-suppliers':['supplier','المورد'], 'sales-by-item':['item','الصنف'],
  'purchase-by-item':['item','الصنف'], 'item-profit':['item','الصنف'], 'stock-report':['item','الصنف'], 'low-stock':['item','الصنف'],
};

export function Report({ screen, role, branch }: { screen: Screen; role: Role; branch: string }) {
  const [period, setPeriod] = useState('اليوم');
  const [branchFilter, setBranchFilter] = useState(branch);
  const [from, setFrom] = useState(demoDate);
  const [to, setTo] = useState(demoDate);
  const reportPicker = reportPickers[screen.id];
  const [reportAccount, setReportAccount] = useState(screen.id === 'ledger' ? accounts[0] : '');
  const [center, setCenter] = useState('كل المراكز');
  const [chart, setChart] = useState(false);
  const [sort, setSort] = useState(false);
  const [hideZeros, setHideZeros] = useState(true);
  const [level, setLevel] = useState('الحسابات التحليلية');
  const [chosen, setChosen] = useState<Sample | null>(null);
  const invalid = period === 'نطاق مخصص' && (!from || !to || from > to);
  let rows = rowsFor(screen, role).filter((row,i) => (!invalid && (period !== 'نطاق مخصص' || row.date >= from && row.date <= to)) && (branchFilter === branch || branchFilter === 'كل الفروع' || row.title === branchFilter || row.about.includes(branchFilter)) && (center === 'كل المراكز' || i % 2 === (center === 'المبيعات' ? 0 : 1)));
  if (screen.id === 'ledger' && reportAccount && reportAccount !== accounts[0]) rows = [];
  if (reportPicker && screen.id !== 'ledger' && reportAccount) rows = rows.filter((row) => row.title.includes(reportAccount) || row.about.includes(reportAccount));
  if (screen.id === 'trial' && !hideZeros) rows = [...rows,{id:'1103',title:'صندوق فرع تعز',about:'بلا حركة',date:demoDate,value:0,status:'active'}];
  if (sort) rows = [...rows].sort((a,b) => (b.value ?? 0) - (a.value ?? 0));
  const amounts = rows.some((row) => row.value !== undefined);
  const total = rows.reduce((sum,r) => sum + (r.value ?? 0),0);
  const max = Math.max(...rows.map((r) => Math.abs(r.value ?? 0)),1);
  const customTotal = screen.id === 'ledger' ? undefined : ['ledger','trial','balance-sheet','income','treasury','cashflow'].includes(screen.id) ? undefined : amounts ? total : undefined;
  return <div className="e-stack"><section className="e-panel e-form e-print-hidden" aria-label="فلاتر التقرير"><div className="e-field-grid"><label className="e-field">الفترة<select value={period} onChange={(e) => setPeriod(e.target.value)}>{['اليوم','هذا الأسبوع','هذا الشهر','هذا الربع','هذا العام','نطاق مخصص'].map((v) => <option key={v}>{v}</option>)}</select></label><label className="e-field">الفرع<select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>{['كل الفروع','الفرع الرئيسي','فرع عدن','فرع تعز'].map((v) => <option key={v}>{v}</option>)}</select></label><label className="e-field">مركز التكلفة<select value={center} onChange={(e) => setCenter(e.target.value)}><option>كل المراكز</option><option>المبيعات</option><option>التوزيع</option></select></label>{reportPicker && <CodeNamePicker kind={reportPicker[0]} label={reportPicker[1]} value={reportAccount} onChange={(value) => { setReportAccount(value); setChosen(null); }} context={{role,accountUse:'report'}} optional />}{screen.id === 'trial' && <><label className="e-field">المستوى<select value={level} onChange={(e) => setLevel(e.target.value)}><option>الحسابات التحليلية</option><option>المستوى الأول</option></select></label><label className="e-check-inline"><input type="checkbox" checked={hideZeros} onChange={(e) => setHideZeros(e.target.checked)} /> أخفِ الأرصدة الصفرية</label></>}{period === 'نطاق مخصص' && <><label className="e-field">من تاريخ<input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={invalid} /></label><label className="e-field">إلى تاريخ<input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={invalid} /></label></>}</div>{invalid && <Notice tone="danger">أدخل نطاق تواريخ صالحًا؛ يجب أن يسبق تاريخ البداية تاريخ النهاية أو يساويه.</Notice>}</section>
  <div className="e-kpis"><div className="e-panel e-kpi"><small>السجلات المعروضة</small><strong><bdi>{rows.length}</bdi></strong><small>{period}</small></div>{screen.id === 'ledger' && <><div className="e-panel e-kpi"><small>الرصيد الافتتاحي</small><strong><Money value={0} /></strong></div><div className="e-panel e-kpi"><small>الرصيد الختامي</small><strong><Money value={rows.at(-1)?.value ?? 0} /></strong></div></>}{customTotal !== undefined && <div className="e-panel e-kpi"><small>إجمالي الفترة</small><strong><Money value={customTotal} /></strong></div>}</div>
  {chosen && <Notice title={chosen.title}>{chosen.about} {chosen.href && <a href={chosen.href}>افتح المستند المصدر</a>}</Notice>}
  <section className="e-panel"><div className="e-panel-head"><div><h2>نتائج التقرير</h2><p>كما في 23 نوفمبر 2026 · <bdi dir="ltr">10:30</bdi> · {level === 'المستوى الأول' && screen.id === 'trial' ? level : branchFilter}</p></div><div className="e-actions e-print-hidden"><Action icon={Download} onClick={() => csvRecords(screen,rows,amounts)}>صدّر البيانات</Action><Action icon={Printer} onClick={() => window.print()}>اطبع / احفظ بصيغة PDF</Action></div></div>
  {amounts && <div className="e-list-tools e-print-hidden"><div className="e-segments"><button type="button" aria-pressed={!chart} onClick={() => setChart(false)}>جدول النتائج</button><button type="button" aria-pressed={chart} onClick={() => setChart(true)}>الرسم البياني</button><button type="button" aria-pressed={sort} onClick={() => setSort(!sort)}>رتّب حسب المبلغ</button></div></div>}
  {!rows.length ? <Empty title="لا توجد نتائج لهذه الفلاتر" action={<Action onClick={() => { setPeriod('اليوم'); setCenter('كل المراكز'); setBranchFilter(branch); setReportAccount(screen.id === 'ledger' ? accounts[0] : ''); }}>امسح كل الفلاتر</Action>}>وسّع النطاق أو اختر حسابًا آخر.</Empty> : chart && amounts ? <div className="e-form" role="group" aria-label="المبالغ حسب السجل">{rows.map((r) => <div className="e-report-bar" key={r.id}><div><span>{r.title}</span><Money value={r.value ?? 0} /></div><meter min={0} max={max} value={Math.abs(r.value ?? 0)} aria-label={r.title} /></div>)}</div> : <RecordRows rows={rows} amounts={amounts} valueLabel={screen.id === 'ledger' ? 'الرصيد الجاري' : 'المبلغ'} total={customTotal} onOpen={(r) => r.href ? window.location.assign(r.href) : setChosen(r)} />}</section>
  <div className="e-print-hidden"><Action href={moduleHref('reports')} icon={FileText}>اعرض دليل التقارير</Action></div></div>;
}
