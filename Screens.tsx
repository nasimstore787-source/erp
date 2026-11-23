import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronLeft, Download, LockKeyhole, Plus, Printer } from 'lucide-react';
import { moduleHref, modules, patterns, roles, screens, screenHref, visible, type Role, type Screen } from './catalog';
import { company, fieldSpecs, items, rowsFor, type Sample } from './fixtures';
import { Action, Badge, demoDate, downloadCsv, Empty, Field, Money, Notice, PageIntro, useFields } from './ui';
import { InvoiceLines, invoiceLineName, invoiceSeed } from './InvoiceLines';
import { Confirm, DoneMessage, PanelDialog } from './Confirm';
import { csvRecords, RecordRows, Records, Report } from './Records';
import { Journal, Wizard } from './Flows';

const links: Record<string,string> = { items: '#/inventory/item-edit', stock: '#/inventory/stock-count', suppliers: '#/purchases/supplier-edit', vouchers: '#/accounting/receipt', backups: '#/backup/backup-now', 'purchase-invoices': '#/purchases/purchase-invoice' };
const editableDetails: Record<string,[string,string,string]> = {
  'journal-detail': ['القيد رقم 186','اعكس القيد','#/accounting/journal'],
  'purchase-detail': ['فاتورة المشتريات رقم 305','اعكس الفاتورة','#/purchases/purchase-invoice'],
};
const capabilities = ['ترحيل المستندات', 'عكس المستندات', 'عرض التكلفة والربح', 'عرض رصيد الصندوق', 'منح الخصم', 'إدارة المستخدمين'];
const defaultCapabilities: boolean[][] = [[true,true,true,true,true],[true,true,false,false,false],[true,true,false,false,false],[true,true,false,false,false],[true,false,false,false,false],[true,false,false,false,false]];
function PermissionMatrix() {
  const [matrix, setMatrix] = useState(defaultCapabilities);
  const [preview, setPreview] = useState<Role>('cashier');
  const [saved, setSaved] = useState(false);
  const roleIndex = Object.keys(roles).indexOf(preview);
  function toggle(capability: number, role: number) {
    if (role === 0) return;
    setSaved(false);
    setMatrix((value) => value.map((line, index) => index === capability ? line.map((checked, j) => j === role ? !checked : checked) : line));
  }
  return <div className="e-stack"><section className="e-panel"><div className="e-panel-head"><div><h2>مصفوفة الصلاحيات</h2><p>عدّل القدرات المتاحة لكل دور ثم راجع ما سيظهر له.</p></div><Action kind="primary" onClick={() => setSaved(true)}>احفظ مصفوفة الصلاحيات</Action></div><div className="e-mobile-only"><div className="e-panel-head"><label className="e-field">الدور المراد تعديله<select value={preview} onChange={(event) => setPreview(event.target.value as Role)}>{Object.entries(roles).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label></div>{capabilities.map((c,i) => <label className="e-attention-row e-permission-toggle" key={c}><strong>{c}</strong><input type="checkbox" checked={matrix[i][roleIndex]} disabled={roleIndex === 0} onChange={() => toggle(i,roleIndex)} /></label>)}</div><div className="e-table-wrap e-desktop-only" tabIndex={0} role="region" aria-label="جدول صلاحيات الأدوار"><table className="e-table e-matrix"><thead><tr><th>الصلاحية</th>{Object.values(roles).map((r) => <th key={r} scope="col">{r}</th>)}</tr></thead><tbody>{capabilities.map((c,i) => <tr key={c}><th scope="row">{c}</th>{Object.values(roles).map((r,j) => <td key={r}><label className="e-matrix-check"><span className="sr-only">{c} · {r}</span><input type="checkbox" checked={matrix[i][j]} disabled={j === 0} onChange={() => toggle(i,j)} /></label></td>)}</tr>)}</tbody></table></div></section><section className="e-panel e-form"><h2>ماذا يرى هذا الدور؟</h2><label className="e-field">الدور<select value={preview} onChange={(event) => setPreview(event.target.value as Role)}>{Object.entries(roles).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label><div className="e-segments">{capabilities.map((c,i) => <span className={`e-badge ${matrix[i][roleIndex] ? 'good' : 'neutral'}`} key={c}>{matrix[i][roleIndex] ? <Check size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}{c}</span>)}</div>{saved && <p role="status" className="e-good-text">حُفظ نموذج المصفوفة للعرض فقط. لم تتغيّر صلاحيات النظام.</p>}</section></div>;
}

export function EntityForm({ screen, branch, role, onDone, compact }: { screen: Screen; branch: string; role: Role; onDone?: (value: Record<string,string>) => void; compact?: boolean }) {
  const canCost = role === 'owner' || role === 'accountant' || role === 'buyer';
  const specs = fieldSpecs(screen.fields, branch, canCost);
  const purchase = screen.id === 'purchase-invoice';
  const invoice = purchase || screen.id === 'sales-invoice';
  const [paymentLines, setPaymentLines] = useState([0,0]);
  const [invoiceLines, setInvoiceLines] = useState(() => invoiceSeed(purchase));
  const [lineError, setLineError] = useState('');
  const [statement, setStatement] = useState([true,false,false]);
  const [done, setDone] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draftKey = `rifd.design.draft.${screen.id}`;
  const draftEnabled = !compact && !specs.some((spec) => spec.type === 'password') && specs.length >= 5;
  const [restored] = useState<Record<string,string> | null>(() => { if (!draftEnabled) return null; try { const data: unknown = JSON.parse(localStorage.getItem(draftKey) ?? 'null'); return data && typeof data === 'object' && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([key,value]) => typeof value === 'string' && specs.some((spec) => spec.label === key && spec.type !== 'file'))) : null; } catch { return null; } });
  const blank = Object.fromEntries(specs.map((spec) => [spec.label,spec.initial ?? spec.options?.[0] ?? '']));
  const formState = useFields(specs.map((spec) => ({...spec, initial: restored?.[spec.label] ?? spec.initial})));
  const { values } = formState;
  function pickerContext({ label }: { label: string }) {
    const other = screen.id !== 'cash-transfer' ? undefined : label === 'الحساب الوجهة' ? 'الحساب المصدر' : label === 'الحساب المصدر' ? 'الحساب الوجهة' : undefined;
    return { role, warehouse:values['المخزن'] || values['من مخزن'], accountUse:label === 'الحساب الأب' ? 'parent' as const : 'posting' as const, blockedValue:other ? values[other] : undefined, conflictLabel:other };
  }
  const allocation = screen.id === 'supplier-payment' || screen.id === 'collections';
  const payable = screen.id === 'supplier-payment';
  const amount = Number(values['المبلغ']) || 0;
  const openAmounts = payable ? [42500,34900] : [2200,1800];
  const autoValues = [Math.min(amount,openAmounts[0]),Math.min(Math.max(amount-openAmounts[0],0),openAmounts[1])];
  const allocated = paymentLines.reduce((sum,p) => sum + p,0);
  const eligible = !(screen.id === 'discounts' && role !== 'owner');
  useEffect(() => { if (!draftEnabled || !dirty || done) return; try { localStorage.setItem(draftKey, JSON.stringify(Object.fromEntries(Object.entries(values).filter(([key]) => !specs.some((field) => field.label === key && field.type === 'file'))))); } catch { /* The demo still works if the browser blocks storage. */ } }, [values, dirty, done, draftKey, draftEnabled]);
  function clearDraft() { if (draftEnabled) try { localStorage.removeItem(draftKey); } catch { /* Storage is optional for this preview. */ } }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eligible || !formState.validate(event.currentTarget,pickerContext)) return;
    if (invoice) {
      const invalid = invoiceLines.find((line) => !line.item || !(Number(line.qty) > 0) || !(Number(line.price) > 0) || Number(line.discount) < 0 || Number(line.discount) > Number(line.price) * Number(line.qty));
      if (invalid) {
        setLineError('اختر صنفًا وأدخل كمية وسعرًا موجبين، وخصمًا لا يتجاوز قيمة السطر.');
        (event.currentTarget.elements.namedItem(invoiceLineName(invalid.item ? 'الكمية' : 'الصنف',invalid.id)) as HTMLElement)?.focus();
        return;
      }
    }
    if (allocation && (allocated > amount || paymentLines.some((entry,index) => entry < 0 || entry > openAmounts[index]))) { setLineError('وزّع مبلغًا لا يتجاوز قيمة الدفعة أو الرصيد المفتوح لكل مستند.'); event.currentTarget.querySelector<HTMLInputElement>('[name="المبلغ المخصص 1"]')?.focus(); return; }
    const documentDate = values['تاريخ السند'] || values['التاريخ'];
    if (screen.pattern === 'form' && documentDate && !documentDate.startsWith('2026-11') && !['reminders','barcode'].includes(screen.id)) { setLineError('هذه الفترة ليست مفتوحة في المعاينة. اختر تاريخًا في نوفمبر 2026.'); event.currentTarget.querySelector<HTMLInputElement>('input[type=date]')?.focus(); return; }
    if (screen.id === 'export') { downloadCsv('بيانات توضيحية', [['الوحدة','نوع الملف'],[values['الوحدة'],values['نوع الملف']]]); }
    if (screen.id === 'barcode') window.print();
    clearDraft();
    if (onDone) { onDone(values); return; }
    setDone(screen.id === 'shift-close' ? 'سُجّل النقد المعدود قبل إظهار الرصيد المتوقع.' : 'سُجّلت العملية في المعاينة فقط. لم تتغير البيانات الفعلية.');
  }
  if (done) return <DoneMessage title="اكتملت العملية التجريبية" onReset={() => { setDirty(false); setDismissed(true); setDone(''); formState.setValues(blank); setInvoiceLines(invoiceSeed(purchase)); }}>{done}{screen.id === 'shift-close' && (role === 'owner' || role === 'accountant') && <> المتوقع <Money value={20200} /> · الفرق <Money value={Number(values['النقد المعدود']) - 20200} />.</>}</DoneMessage>;
  const hints: Record<string,ReactNode> = {
    payment: <>عند دفع مبلغ أكبر من الرصيد المستحق، يظهر الباقي كدفعة مقدّمة.</>,
    schedule: 'احتفظ بعبارة التشفير في مكان آمن. لا يمكن للنظام استعادتها إذا فقدتها.',
    'shift-close': 'عدّ النقد أولًا وأدخل المبلغ. لا يُعرض النقد المتوقع قبل تسجيل العدّ، ولا يظهر لأمين الصندوق.',
    tax: 'الضريبة غير مفعّلة افتراضيًا. لن تظهر في المستندات ما لم تفعّلها وتحدّد حسابها ونسبتها.',
    'account-profile': 'هذه معلومات توضيحية. إعدادات الأمان متاحة كشاشات مستقلة في المعاينة.',
  };
  const isReconcile = screen.id === 'reconcile';
  const difference = [18400,-3500,12500].reduce((sum,value,index) => sum + (statement[index] ? value : 0),0) - 27400;
  return <form noValidate className={compact ? 'e-stack' : 'e-panel e-form'} onSubmit={submit}>
    {restored && !dismissed && <Notice title="استعدنا مسودتك"><button className="e-text-action" type="button" onClick={() => { clearDraft(); setDirty(false); setDismissed(true); formState.setValues(blank); }}>تجاهل المسودة</button></Notice>}
    {hints[screen.id] && <Notice>{hints[screen.id]}</Notice>}
    {specs.length > 0 && <div className="e-field-grid">{specs.map((spec) => { if (screen.id === 'tax' && spec.type !== 'checkbox' && values['فعّل احتساب الضريبة'] !== '1') return null; if (screen.id === 'payment' && (spec.label === 'المورد' && values['الجهة'] !== 'مورد' || spec.label === 'حساب المصروف' && values['الجهة'] !== 'حساب مصروف')) return null; const bound = formState.bind(spec); return <Field key={spec.label} {...bound} pickerContext={pickerContext(spec)} set={(value) => { setDirty(true); setLineError(''); bound.set(value); }} />; })}</div>}
    {isReconcile && <><div><h2>طابق الحركات مع كشف البنك</h2><p>رصيد الكشف: <Money value={27400} /></p></div>{['سند قبض 128 · 18,400 ر.ي','سند صرف 84 · -3,500 ر.ي','قيد 186 · 12,500 ر.ي'].map((r,i) => <label key={r} className="e-check-inline"><input type="checkbox" checked={statement[i]} onChange={(e) => setStatement((v) => v.map((v,k) => k === i ? e.target.checked : v))} />{r}</label>)}<Notice tone={difference ? 'warn' : 'good'}><span aria-live="polite">فرق التسوية: <Money value={difference} /></span></Notice></>}
    {invoice && <InvoiceLines lines={invoiceLines} setLines={setInvoiceLines} warehouse={values['المخزن']} purchase={purchase} onEdit={() => setLineError('')} />}
    {purchase && <Notice>{values['الدفع'] === 'آجل' ? 'يزيد المخزون · يزيد المستحق للمورد' : 'يزيد المخزون · ينخفض رصيد حساب الدفع'}</Notice>}
    {allocation && <section className="e-stack"><div className="e-panel-head e-no-padding"><div><h2>وزّع الدفعة على الفواتير</h2><p>يمكنك توزيعها على الأقدم أو تعديلها يدويًا.</p></div><Action onClick={() => { setLineError(''); setPaymentLines(autoValues); }}>وزّع على الأقدم</Action></div><div className="e-field-grid">{openAmounts.map((open,i) => <div className="e-ledger-line" key={i}><div><strong>فاتورة <bdi>#{payable ? 305-i : 1042-i}</bdi></strong><p><Money value={open} /> {payable ? 'له' : 'عليه'}</p></div><Field spec={{label:`المبلغ المخصص ${i+1}`,type:'number',min:0}} value={String(paymentLines[i])} set={(v) => { setLineError(''); setPaymentLines((data) => data.map((n,k) => k === i ? Number(v) : n)); }} /></div>)}</div><Notice tone={allocated > amount ? 'warn' : 'info'}><span aria-live="polite">المخصص <Money value={allocated} /> · {amount >= allocated ? 'دفعة مقدّمة' : 'تجاوز التخصيص'} <Money value={Math.abs(amount-allocated)} /></span></Notice></section>}
    {lineError && <Notice tone="danger">{lineError}</Notice>}
    {!eligible && <Notice tone="warn">يلزم إذن منح الخصم لتغيير هذه القاعدة.</Notice>}
    <div className="e-form-actions"><button className="e-button primary" type="submit" aria-disabled={eligible ? undefined : true}>{screen.action}</button>{!compact && draftEnabled && <Action onClick={() => { setDirty(true); setDismissed(false); setLineError('حُفظت مسودة الحقول على هذا الجهاز.'); }}>احفظ كمسودة</Action>}</div>
  </form>;
}

function PrintPreview() {
  const [format, setFormat] = useState('A4');
  return <div className="e-stack"><div className="e-panel e-panel-head e-print-hidden"><label className="e-field">قالب الطباعة<select value={format} onChange={(e) => setFormat(e.target.value)}><option value="A4">فاتورة A4</option><option value="80">إيصال حراري 80 ملم</option></select></label><Action icon={Printer} onClick={() => window.print()}>اطبع المستند</Action></div><article className={`e-panel e-form e-print-doc ${format === '80' ? 'thermal' : ''}`}><h2>{company}</h2><p>الفرع الرئيسي · صنعاء<br/>فاتورة مبيعات <bdi dir="ltr">#1042</bdi> · <bdi>{demoDate}</bdi></p><dl className="e-details"><div><dt>دقيق أبيض 10 كجم · 1</dt><dd><Money value={5200} /></dd></div><div><dt>الإجمالي المدفوع نقدًا</dt><dd><Money value={5200} /></dd></div></dl><p className="e-caption">شكرًا لتسوّقكم معنا.</p></article></div>;
}
const detailRows: Record<string, [string,string][]> = {
  sequences: [['سند القبض التالي','129'],['سند الصرف التالي','85'],['قيد اليومية التالي','187'],['تسلسل الفواتير','حسب نوع المستند والسنة المالية']],
  'item-card': [['الصنف',items[0]],['الباركود','6281001'],['الكمية الحالية','40 كيسًا'],['آخر حركة','استلام 8 أكياس · الاستلام 67']],
  'supplier-detail': [['المورد','شركة اليمن للتوريدات'],['رقم الهاتف','771023456'],['مدة السداد','30 يومًا'],['الرصيد','42,500.00 ر.ي له'],['الحساب الرقابي','2101 · ذمم الموردين']],
  'customer-detail': [['العميل','مؤسسة النور التجارية'],['رقم الهاتف','777903561'],['سقف الائتمان','50,000.00 ر.ي'],['الرصيد','2,200.00 ر.ي عليه'],['السداد','أجل 15 يومًا']],
};
function Details({ screen, role }: { screen: Screen; role: Role }) {
  const [confirm, setConfirm] = useState(false);
  const [reverse, setReverse] = useState('');
  const document = editableDetails[screen.id];
  const errors: Record<string, [string,string,string,string]> = {
    offline: ['أنت دون اتصال','يمكنك متابعة البيع في نقطة البيع. تحتاج بقية الوحدات إلى اتصال لإظهار بياناتها الحالية.','افتح نقطة البيع','#pos'],
    forbidden: ['لا تملك إذنًا لهذه الشاشة','اطلب من مدير النظام مراجعة دورك.','عُد إلى مساحة العمل','#/'],
    'not-found': ['لم نعثر على الصفحة','قد يكون الرابط قديمًا أو غير مكتمل.','عُد إلى مساحة العمل','#/'],
    maintenance: ['النظام قيد الصيانة','توقف العمل لفترة قصيرة لتحديث النظام.','ارجع إلى مساحة العمل','#/'],
    'global-empty': ['لا توجد سجلات حتى الآن','ابدأ بإضافة سجل ليظهر هنا وتتمكن من متابعته.','أضف صنفًا','#/inventory/item-edit'],
    'global-error': ['تعذّر تحميل المحتوى','تحقق من الاتصال ثم أعد فتح مساحة العمل.','أعد فتح مساحة العمل','#/'],
  };
  if (errors[screen.id]) { const [title,copy,action,href] = errors[screen.id]; return <section className="e-panel"><Empty title={title} action={<Action href={href} kind="primary">{action}</Action>}>{copy}</Empty></section>; }
  if (screen.id === 'pdf') return <PrintPreview />;
  if (document) return <div className="e-stack"><section className="e-panel"><div className="e-panel-head"><div><h2>{document[0]}</h2><p>2026-11-23 · الفرع الرئيسي</p></div><Badge status={reverse ? 'reversed' : 'posted'} /></div><dl className="e-details"><div><dt>المصدر</dt><dd><a className="e-text-action" href={screen.id === 'journal-detail' ? '#/accounting/vouchers' : '#/purchases/purchase-invoices'}>{screen.id === 'journal-detail' ? 'تحصيلات الصندوق · سند 128' : 'شركة اليمن للتوريدات'}</a></dd></div><div><dt>المبلغ</dt><dd><Money value={screen.id === 'journal-detail' ? 12500 : 42500} digits={2} /></dd></div><div><dt>التدقيق</dt><dd>رحّله أحمد خالد · 10:30</dd></div></dl></section><Notice title="المستند المرحّل لا يُعدّل">استخدم العكس ثم أنشئ مستندًا جديدًا عند الحاجة.</Notice>{reverse ? <Notice tone="good" title="عُكس المستند في المعاينة">السبب: {reverse} · <a href="#/accounting/reversals">القيد العكسي رقم 187</a></Notice> : role === 'owner' || role === 'accountant' ? <div className="e-actions"><Action kind="danger" onClick={() => setConfirm(true)}>{document[1]}</Action><Action href="#/profile/pdf" icon={Printer}>اعرض الطباعة</Action></div> : <Notice tone="warn">يلزم إذن عكس المستندات.</Notice>}{confirm && <Confirm title={`هل تريد عكس ${document[0]}؟`} label={document[1]} reason onClose={() => setConfirm(false)} onConfirm={(reason) => { setReverse(reason); setConfirm(false); }}>سيظل المستند الأصلي في السجل بحالة ملغى، ويُربط به قيد عكسي.</Confirm>}</div>;
  return <section className="e-panel"><div className="e-panel-head"><h2>{screen.title}</h2><Badge status={screen.id === 'sequences' ? 'locked' : 'active'} /></div><dl className="e-details">{(detailRows[screen.id] ?? [['آخر تحديث',demoDate],['الفرع','الفرع الرئيسي']]).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}{screen.id === 'item-card' && (role === 'owner' || role === 'accountant') && <div><dt>متوسط تكلفة الوحدة</dt><dd><Money value={3900} digits={2} /></dd></div>}</dl><div className="e-panel-head">{screen.id === 'supplier-detail' && <Action href="#/purchases/supplier-statement" icon={ArrowLeft}>اعرض كشف المورد</Action>}{screen.id === 'customer-detail' && <Action href="#/accounting/customer-statement" icon={ArrowLeft}>اعرض كشف العميل</Action>}{screen.id === 'item-card' && <Action href="#/inventory/movements" icon={ArrowLeft}>اعرض تقرير الحركة</Action>}</div></section>;
}

function Listing({ screen, role, branch }: { screen: Screen; role: Role; branch: string }) {
  const [rows, setRows] = useState(() => rowsFor(screen, role));
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<Sample | null>(null);
  const [decision, setDecision] = useState<{title:string;label:string;danger:boolean}|null>(null);
  const [flash, setFlash] = useState('');
  const href = links[screen.id];
  const primary = href ? <Action icon={Plus} kind="primary" href={href}>{screen.action}</Action> : screen.fields.length ? <Action icon={Plus} kind="primary" onClick={() => setEditing(true)}>{screen.action}</Action> : screen.action.startsWith('صدّر') ? <Action icon={Download} onClick={() => csvRecords(screen,rows,rows.some((r) => r.value !== undefined))}>{screen.action}</Action> : undefined;
  const editable = screen.fields.length > 0 && detail?.status !== 'locked';
  const mutate = screen.id === 'approvals' || screen.id === 'sessions' || screen.id === 'backups' || screen.id === 'period-requests';
  const makeDecision = (label: string, danger = true) => { if (!detail) return; setDecision({ title: `${label} «${detail.title}»؟`, label, danger }); };
  return <div className="e-stack">{flash && <div role="status"><Notice tone="good">{flash}</Notice></div>}<Records screen={screen} role={role} rows={rows} branch={branch} primary={primary} onOpen={(row) => setDetail(row)} />
  {editing && <PanelDialog title={detail ? `عدّل ${detail.title}` : screen.action} onClose={() => { setEditing(false); setDetail(null); }}><EntityForm compact screen={{...screen, action:detail ? 'احفظ التغييرات' : screen.action}} branch={branch} role={role} onDone={(value) => { const [title,...rest] = Object.values(value); const next = {id:detail?.id ?? `D${rows.length+1}`, title, about:rest.filter(Boolean).join(' · '),date:demoDate,status:'active' as const}; setRows((list) => detail ? list.map((r) => r.id === detail.id ? next : r) : [next,...list]); setEditing(false); setDetail(null); setFlash('حُفظ السجل في المعاينة فقط.'); }} /><Action onClick={() => { setEditing(false); setDetail(null); }}>تراجع</Action></PanelDialog>}
  {detail && !editing && !decision && <PanelDialog title={detail.title} onClose={() => setDetail(null)}><p>{detail.about}</p><RecordRows rows={[detail]} amounts={detail.value !== undefined} />{detail.status === 'locked' && <Notice title="هذا السجل مقفل">لا يمكن تغيير حساب نظام أو فترة مالية مقفلة.</Notice>}<div className="e-actions">{detail.href && <Action href={screen.id === 'backups' ? `${detail.href}?backup=${encodeURIComponent(detail.id)}` : detail.href} icon={ChevronLeft}>{screen.id === 'backups' ? 'استعد النسخة' : 'افتح الشاشة المرتبطة'}</Action>}{editable && <Action onClick={() => setEditing(true)}>عدّل السجل</Action>}{screen.id === 'backups' && <><Action onClick={() => { setDetail(null); csvRecords(screen,[detail],false); }}>نزّل بيان النسخة</Action><Action onClick={() => { setDetail(null); setFlash(`تم التحقق من النسخة ${detail.id} في المعاينة.`); }}>تحقّق من النسخة</Action></>}{mutate && (role === 'owner' ? <>{screen.id === 'approvals' && <Action kind="primary" onClick={() => makeDecision('اعتمد الإيصال',false)}>اعتمد الإيصال</Action>}<Action kind="danger" onClick={() => makeDecision(screen.id === 'sessions' ? 'ألغِ الجلسة' : screen.id === 'backups' ? 'احذف نسخة العرض' : 'ارفض الطلب')}>{screen.id === 'sessions' ? 'ألغِ الجلسة' : screen.id === 'backups' ? 'احذف نسخة العرض' : 'ارفض الطلب'}</Action></> : <Notice tone="warn">يلزم إذن إدارة هذه العملية.</Notice>)}<Action onClick={() => setDetail(null)}>أغلق التفاصيل</Action></div></PanelDialog>}
  {detail && decision && <Confirm title={decision.title} label={decision.label} danger={decision.danger} reason={screen.id === 'approvals' || screen.id === 'period-requests'} onClose={() => { setDecision(null); setDetail(null); }} onConfirm={(reason) => { setRows((list) => screen.id === 'backups' ? list.filter((row) => row.id !== detail.id) : list.map((row) => row.id === detail.id ? {...row,about:reason ? `${row.about} · ${reason}` : row.about,status:decision.danger ? 'reversed' : 'posted'} : row)); setFlash('تغيّرت حالة هذا السجل في المعاينة فقط.'); setDetail(null); setDecision(null); }}>سيُسجّل هذا الإجراء في نسخة العرض فقط.</Confirm>}
  </div>;
}
export function ScreenView({ screen, role, branch }: { screen: Screen; role: Role; branch: string }) {
  const module = modules.find((group) => group.id === screen.module)!;
  return <div className="e-stack"><PageIntro title={screen.title} description={`${patterns[screen.pattern]} · بيانات توضيحية للفرع المحدد`} parent={{ href: moduleHref(screen.module), label: module.title }} />
    {screen.id === 'journal' ? <Journal role={role} /> : screen.id === 'permissions' ? <PermissionMatrix /> : screen.id === 'print' ? <PrintPreview /> : screen.pattern === 'wizard' ? <Wizard screen={screen} branch={branch} role={role} /> : screen.pattern === 'report' ? <Report screen={screen} role={role} branch={branch} /> : screen.pattern === 'list' || screen.pattern === 'inbox' ? <Listing screen={screen} role={role} branch={branch} /> : screen.pattern === 'detail' ? <Details screen={screen} role={role} /> : screen.pattern === 'form' || screen.pattern === 'settings' ? <EntityForm screen={screen} role={role} branch={branch} /> : <Empty title="اختر شاشة من هذه الوحدة" action={<Action href={moduleHref(screen.module)}>اعرض شاشات الوحدة</Action>}>{screen.title}</Empty>}
    {screen.href && visible(screen, role) && <Action href={screenHref(screen)} kind="primary">{screen.action}</Action>}
  </div>;
}
