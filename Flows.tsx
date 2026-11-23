import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, FileText, Plus, Trash2 } from 'lucide-react';
import { CodeNamePicker } from './CodeNamePicker';
import { pickerRecords, restrictionFor } from './pickerCatalog';
import { type Screen, type Role } from './catalog';
import { accounts, backupRows, company, items } from './fixtures';
import { Confirm, DoneMessage } from './Confirm';
import { Action, Badge, demoDate, downloadCsv, Field, Money, Notice, num, useFields, type FieldSpec } from './ui';

type JournalLine = { id: number; account: string; debit: string; credit: string; text: string; party: string; center: string };
const emptyLine = {account:'',debit:'',credit:'',text:'',party:'',center:'الفرع الرئيسي'};
const journalDefaults: JournalLine[] = [{ ...emptyLine,id:1,account:accounts[0],debit:'12500',text:'تحصيلات الصندوق' },{ ...emptyLine,id:2,account:accounts[6],credit:'12500',text:'إيراد الفرع' }];
const journalDraft = 'rifd.design.draft.journal';
function loadJournal(): { date: string; lines: JournalLine[] } | null { try { const json = JSON.parse(localStorage.getItem(journalDraft) ?? 'null'); return json && typeof json.date === 'string' && Array.isArray(json.lines) && json.lines.length >= 2 && json.lines.every((line: JournalLine) => line && Object.keys(emptyLine).every((key) => typeof line[key as keyof JournalLine] === 'string')) ? {date:json.date,lines:json.lines.map((line: JournalLine,index: number) => ({...line,id:index+1,party:line.party === '—' ? '' : line.party}))} : null; } catch { return null; } }
function cents(value: string) { return Math.round(Number(value || 0) * 100) || 0; }
export function Journal({ role }: { role: Role }) {
  const [draft] = useState(loadJournal);
  const [date,setDate] = useState(draft?.date ?? demoDate);
  const [lines,setLines] = useState(draft?.lines ?? journalDefaults);
  const formRef = useRef<HTMLFormElement>(null);
  const lastId = useRef(lines.length);
  function focusAccount(id: number) {
    requestAnimationFrame(() => (formRef.current?.elements.namedItem(`الحساب ${id}`) as HTMLElement | null)?.focus());
  }
  function addLine() {
    const id = ++lastId.current;
    setDirty(true); setError(''); setSaved(false); setLines((list) => [...list,{...emptyLine,id}]);
    focusAccount(id);
  }
  const [dirty,setDirty] = useState(false);
  const [hideRestore,setHideRestore] = useState(false);
  const [error,setError] = useState('');
  const [done,setDone] = useState<string | null>(null);
  const [preview,setPreview] = useState(false);
  const [saved,setSaved] = useState(false);
  const debit = lines.reduce((sum,line) => sum + cents(line.debit),0);
  const credit = lines.reduce((sum,line) => sum + cents(line.credit),0);
  const difference = debit-credit;
  const locked = !/^2026-11-(0[1-9]|[12][0-9]|30)$/.test(date);
  const permitted = role === 'owner' || role === 'accountant';
  const clear = () => { try { localStorage.removeItem(journalDraft); } catch { /* Optional storage in preview. */ } };
  const save = () => { try { localStorage.setItem(journalDraft,JSON.stringify({date,lines})); setSaved(true); } catch { setError('يتعذّر حفظ المسودة على هذا الجهاز. اترك الشاشة مفتوحة.'); } };
  useEffect(() => { if (dirty && !done) try { localStorage.setItem(journalDraft,JSON.stringify({date,lines})); } catch { /* Optional storage in preview. */ } }, [date,lines,dirty,done]);
  function edit(index: number, key: keyof JournalLine, value: string) { setDirty(true); setError(''); setSaved(false); setLines((current) => current.map((line,i) => i === index ? {...line,[key]:value} : line)); }
  if (done) return <div className="e-stack"><DoneMessage title="رُحّل القيد رقم 187 في المعاينة" onReset={() => { setDirty(false); setDone(null); setHideRestore(true); setLines(journalDefaults); setDate(demoDate); }}><Badge status="posted" /> · القيد متوازن بتاريخ <bdi dir="ltr">{done}</bdi>.</DoneMessage><div><Action href="#/accounting/journal-detail" icon={FileText}>اعرض مثال قيد مرحّل</Action></div></div>;
  return <><form ref={formRef} className="e-panel e-form" noValidate onSubmit={(event) => {
    event.preventDefault(); if (!permitted) return;
    if (locked) { setError('يجب أن يقع تاريخ القيد في الفترة المفتوحة: نوفمبر 2026.'); (event.currentTarget.elements.namedItem('تاريخ القيد') as HTMLElement)?.focus(); return; }
    const invalidAccount = lines.find((line) => !pickerRecords.account.some((record) => record.value === line.account && !restrictionFor(record,{role})));
    if (invalidAccount) { setError('اختر حسابًا تحليليًا متاحًا قبل الترحيل.'); (event.currentTarget.elements.namedItem(`الحساب ${invalidAccount.id}`) as HTMLElement)?.focus(); return; }
    const bad = lines.findIndex((line) => cents(line.debit) < 0 || cents(line.credit) < 0 || (cents(line.debit) > 0) === (cents(line.credit) > 0));
    if (bad >= 0) { setError(`أدخل مبلغًا موجبًا في طرف واحد فقط للسطر ${bad+1}.`); (event.currentTarget.elements.namedItem(`مدين ${lines[bad].id}`) as HTMLElement)?.focus(); return; }
    if (difference || debit === 0) { setError('لا يمكن الترحيل حتى يتساوى مجموع المدين والدائن ويكونا أكبر من صفر.'); (event.currentTarget.elements.namedItem(`دائن ${lines.at(-1)?.id}`) as HTMLElement)?.focus(); return; }
    setPreview(true);
  }}>
    <div className="e-panel-head e-no-padding"><div><h2>بيانات القيد</h2><p>يُخصّص رقم القيد تلقائيًا بعد الترحيل.</p></div><Badge status="draft" /></div>
    {draft && !hideRestore && <Notice title="استعدنا مسودتك"><button className="e-text-action" type="button" onClick={() => { clear(); setHideRestore(true); setDirty(false); setLines(journalDefaults); setDate(demoDate); }}>تجاهل المسودة</button></Notice>}
    <div className="e-field-grid"><Field spec={{label:'تاريخ القيد',type:'date'}} value={date} set={(v) => { setDate(v); setDirty(true); setError(''); }} /><Field spec={{label:'المرفقات',type:'file',optional:true}} /></div>
    {locked && <Notice tone="warn"><Badge status="locked" /> الفترة المتاحة للترحيل في المعاينة هي نوفمبر 2026.</Notice>}
    <div className="e-ledger-lines">{lines.map((line,index) => <section className="e-ledger-line e-picker-line" aria-label={`السطر ${index+1}`} key={line.id}>
      <div className="e-picker-line-title"><strong>سطر {index+1}</strong>{lines.length > 2 && <button className="e-icon-button" type="button" aria-label={`أزل السطر ${index+1}`} onClick={() => { setDirty(true); setLines((list) => list.filter((row) => row.id !== line.id)); }}><Trash2 size={17} aria-hidden="true" /></button>}</div>
      <CodeNamePicker kind="account" label={`الحساب ${line.id}`} value={line.account} onChange={(v) => edit(index,'account',v)} context={{role}} nextField={`مدين ${line.id}`} />
      <div className="e-picker-line-fields" onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229 || !(event.target instanceof HTMLInputElement) || event.target.type !== 'number') return;
        event.preventDefault();
        if (!line.account) focusAccount(line.id);
        else if ((cents(line.debit) > 0) !== (cents(line.credit) > 0)) { if (index === lines.length-1) addLine(); else focusAccount(lines[index+1].id); }
        else if (!cents(line.debit) && event.target.name === `مدين ${line.id}`) (formRef.current?.elements.namedItem(`دائن ${line.id}`) as HTMLElement)?.focus();
      }}><Field spec={{label:`مدين ${line.id}`,type:'number',min:0}} value={line.debit} set={(v) => edit(index,'debit',v)} /><Field spec={{label:`دائن ${line.id}`,type:'number',min:0}} value={line.credit} set={(v) => edit(index,'credit',v)} /></div>
      <Field spec={{label:`بيان السطر ${line.id}`,optional:true}} value={line.text} set={(v) => edit(index,'text',v)} /><Field spec={{label:`الطرف ${line.id}`,picker:'party',optional:true}} value={line.party} set={(v) => edit(index,'party',v)} /><Field spec={{label:`مركز التكلفة ${line.id}`,options:['الفرع الرئيسي','المبيعات','التوزيع'],optional:true}} value={line.center} set={(v) => edit(index,'center',v)} />
    </section>)}</div>
    <div><Action icon={Plus} onClick={addLine}>أضف سطرًا</Action></div>
    <div className="e-totals" aria-live="polite"><span>إجمالي المدين <Money value={debit/100} digits={2} /></span><span>إجمالي الدائن <Money value={credit/100} digits={2} /></span><span><strong className={difference ? 'e-field-error' : 'e-good-text'}>{difference ? 'الفرق' : 'متوازن · الفرق'}</strong><Money value={difference/100} digits={2} /></span></div>
    {error && <Notice tone="danger">{error}</Notice>}{saved && <p role="status" className="e-good-text">حُفظت مسودة القيد على هذا الجهاز.</p>}{!permitted && <Notice tone="warn">يلزم إذن ترحيل القيود.</Notice>}
    <div className="e-form-actions"><button className="e-button primary" type="submit" aria-disabled={permitted ? undefined : true}>رحّل القيد</button><Action onClick={save}>احفظ كمسودة</Action></div>
  </form>
  {preview && <Confirm title="رحّل قيد تحصيلات الصندوق؟" label="رحّل القيد المتوازن" danger={false} onClose={() => setPreview(false)} onConfirm={() => { clear(); setPreview(false); setDirty(false); setDone(date); }}>بعد الترحيل لا يمكن تعديل القيد. يمكنك فقط عكسه بقيد مرتبط.</Confirm>}
  </>;
}

const restoreOptions = backupRows.map((row) => `${row.id} · ${row.title}`);
const warehouses = ['المخزن الرئيسي','مخزن عدن','مخزن تعز'];
const counts = [{item:items[0],system:40,key:'عدّ الأرز',barcode:'6281001',cost:3900},{item:items[1],system:30,key:'عدّ زيت الطبخ',barcode:'6281003',cost:2180},{item:items[2],system:80,key:'عدّ السكر',barcode:'6281002',cost:900}];
type Values = Record<string,string>;
type Step = { title: string; action: string; fields?: FieldSpec[]; view?: (data: Values) => ReactNode; validate?: (data: Values) => string; body?: 'stock' };
type Flow = { steps: Step[]; confirm?: (data: Values) => {title:string;label:string;body:string;danger?:boolean}; result: string; resultText: (data: Values) => ReactNode; next?: [string,string] };
const f = (label: string, type?: string, initial?: string): FieldSpec => ({label,type,initial,min:type === 'number' ? 0 : undefined});
const select = (label: string, options: string[], initial?: string): FieldSpec => ({label,options,initial});
export function flowFor(id: string, branch = 'الفرع الرئيسي', canCost = true, selectedBackup?: string): Flow {
  const warehouse = warehouses[branch === 'فرع عدن' ? 1 : branch === 'فرع تعز' ? 2 : 0];
  if (id === 'restore') return { steps: [
    { title:'اختر النسخة', action:'راجع أثر الاستعادة', fields:[select('النسخة الاحتياطية',restoreOptions,restoreOptions.find((option) => option.startsWith(`${selectedBackup} ·`)))], view:() => <Notice>اختر نسخة تم التحقق منها. لن يتصل هذا النموذج بمخزن النسخ الفعلي.</Notice> },
    { title:'راجع ما سيُستبدل', action:'انتقل إلى تأكيد الاسم', fields:[f('أنشئ نسخة أمان أولًا','checkbox','1')], view:(data) => <><Notice title="ستُستبدل بيانات الشركة" tone="danger">تعود جميع أرصدة الشركة ومستنداتها إلى حالة النسخة المختارة. تفقد العمليات اللاحقة إن لم تحتفظ بنسخة أمان.</Notice><dl className="e-details"><div><dt>النسخة</dt><dd>{data['النسخة الاحتياطية']}</dd></div><div><dt>مستندات أُنشئت بعدها</dt><dd>{data['النسخة الاحتياطية']?.startsWith('214') ? 24 : data['النسخة الاحتياطية']?.startsWith('213') ? 48 : 73} مستندًا</dd></div><div><dt>قيود أُنشئت بعدها</dt><dd>{data['النسخة الاحتياطية']?.startsWith('214') ? 18 : data['النسخة الاحتياطية']?.startsWith('213') ? 32 : 51} قيدًا</dd></div></dl></> },
    { title:'أكّد الاستعادة', action:'استعد النسخة التجريبية', fields:[f('اسم الشركة'),f('عبارة مرور تجريبية','password')], view:() => <Notice title="تأكيد مقصود" tone="danger">اكتب «{company}» كما هو. استخدم العبارة التجريبية <bdi dir="ltr">rifd-demo</bdi> فقط؛ لا تدخل كلمة مرور فعلية.</Notice>, validate:(data) => data['اسم الشركة']?.trim() !== company ? 'اسم الشركة غير مطابق. انسخ الاسم الظاهر في التنبيه.' : data['عبارة مرور تجريبية'] !== 'rifd-demo' ? 'استخدم عبارة المعاينة الموضّحة أعلاه.' : '' },
  ], confirm:(data) => ({title:`استعد النسخة ${data['النسخة الاحتياطية']?.split(' · ')[0]}؟`,label:'استعد بيانات المعاينة',body:data['أنشئ نسخة أمان أولًا'] === '1' ? 'ستنشأ نسخة أمان أولًا قبل الاستعادة التجريبية. لا تغلق الصفحة أثناء عرض التقدّم.' : 'لن تُنشأ نسخة أمان. تُستبدل بيانات العرض فقط. لا تغلق الصفحة أثناء عرض التقدّم.'}), result:'اكتملت الاستعادة التجريبية',resultText:(data) => data['أنشئ نسخة أمان أولًا'] === '1' ? 'حُوكيت نسخة الأمان والاستعادة. لم تُعدّل أي بيانات فعلية.' : 'حُوكيت الاستعادة دون نسخة أمان. لم تُعدّل أي بيانات فعلية.',next:['اعرض سجل الاستعادة','#/backup/restore-history'] };
  if (id === 'year-close') return { steps:[
    { title:'راجع السنة',action:'راجع الأرصدة الختامية',fields:[select('السنة المالية',['2026','2025'])],view:() => <><Notice title="حالة الإقفال">يُمنع الترحيل إلى الفترات المقفلة. راجع المسودات وميزان المراجعة قبل بدء الإقفال.</Notice><a className="e-text-action" href="#/accounting/trial">اعرض ميزان المراجعة</a></>,validate:(data) => data['السنة المالية'] === '2025' ? 'السنة المالية 2025 مقفلة مسبقًا. اختر 2026 لتجربة الإقفال.' : '' },
    { title:'راجع الترحيل للأمام',action:'انتقل إلى تأكيد الإقفال',fields:[{label:'حساب الأرباح المحتجزة',picker:'account',initial:'3101 · الأرباح المحتجزة'}],view:() => <dl className="e-details"><div><dt>المسودات غير المرحلة</dt><dd>0</dd></div><div><dt>فرق ميزان المراجعة</dt><dd><Money value={0} digits={2} /></dd></div><div><dt>السنة المستقبلة</dt><dd>2027</dd></div></dl> },
    { title:'أكّد الإقفال',action:'أقفل السنة في المعاينة',view:(data) => <Notice tone="danger" title={`السنة المالية ${data['السنة المالية']}`}>يُقفل الترحيل لهذه السنة ويُعرض أثر ترحيل الأرصدة للسنة التالية. هذا إجراء تجريبي.</Notice> },
  ],confirm:(data) => ({title:`أقفل السنة المالية ${data['السنة المالية']}؟`,label:'أقفل السنة المالية',body:'لن يقبل النظام الترحيل إلى تاريخ في سنة مقفلة. هذا التأكيد لا يغيّر النظام الفعلي.'}),result:'اكتمل إقفال السنة في المعاينة',resultText:() => 'ظهرت نتيجة الإقفال والترحيل إلى 2027 دون تغيير البيانات الفعلية.',next:['اعرض السنوات والفترات','#/admin/fiscal'] };
  if (id === 'goods') return { steps:[
    { title:'اختر مصدر الاستلام',action:'أدخل الكميات المستلمة',fields:[select('المصدر',['فاتورة مشتريات 305 · شركة اليمن للتوريدات','أمر شراء 152 · شركة اليمن للتوريدات','استلام مباشر']),select('المخزن',warehouses,warehouse),f('تاريخ الاستلام','date',demoDate)],validate:(data) => data['تاريخ الاستلام']?.startsWith('2026-11') ? '' : 'اختر تاريخ استلام في الفترة المفتوحة: نوفمبر 2026.' },
    { title:'أدخل الكميات',action:'راجع أثر الاستلام',fields:[{label:'الصنف',picker:'item'},select('الوحدة',['كرتون','وحدة','كيس']),f('الكمية المستلمة','number','8')],view:() => <Notice>الكمية المتوقعة: 12. أدخل الكمية التي وصلت فعليًا.</Notice>,validate:(data) => Number(data['الكمية المستلمة']) > 0 && (data['المصدر'] === 'استلام مباشر' || Number(data['الكمية المستلمة']) <= 12) ? '' : 'أدخل كميةً موجبة لا تتجاوز الكمية المتوقعة للمستند.' },
    { title:'راجع أثر الاستلام',action:'رحّل استلام البضاعة',view:(data) => <Notice title="سيزيد رصيد المخزون" tone="good">{data['الصنف']} · {data['الكمية المستلمة']} {data['الوحدة']} · {data['المخزن']}.{data['المصدر'] !== 'استلام مباشر' && Number(data['الكمية المستلمة']) < 12 ? ` يبقى ${12-Number(data['الكمية المستلمة'])} من الكمية المتوقعة.` : ''}</Notice> },
  ],confirm:() => ({title:'رحّل مستند استلام البضاعة؟',label:'رحّل الاستلام',body:'سيظهر المستند في سجل الحركة ويزاد الرصيد التجريبي للمخزن.',danger:false}),result:'رُحّل مستند الاستلام رقم 67 في المعاينة',resultText:() => 'أصبحت الحركة قابلة للتتبّع في نموذج سجل المخزون.',next:['اعرض حركة المخزون','#/inventory/movements'] };
  if (id === 'stock-count') return { steps:[
    { title:'أنشئ ورقة الجرد',action:'ابدأ عدّ الأصناف',fields:[select('المخزن',warehouses,warehouse),select('مجموعة الأصناف',['المواد الغذائية']),f('تاريخ الجرد','date',demoDate)],validate:(data) => data['تاريخ الجرد']?.startsWith('2026-11') ? '' : 'اختر تاريخ جرد في الفترة المفتوحة: نوفمبر 2026.' },
    { title:'عدّ الأصناف',action:'راجع فروقات الجرد',fields:counts.map(({key}) => f(key,'number')),body:'stock' },
    { title:'راجع الفروقات',action:'رحّل تسوية الجرد',view:(data) => <><div className="e-table-wrap"><table className="e-table"><thead><tr><th>الصنف</th><th>النظام</th><th>المعدود</th><th>الفرق</th></tr></thead><tbody>{counts.map((line) => <tr key={line.key}><th scope="row">{line.item}</th><td>{num(line.system)}</td><td>{num(Number(data[line.key]))}</td><td dir="ltr" className="e-numeric">{num(Number(data[line.key])-line.system)}</td></tr>)}</tbody></table></div><Notice tone="warn">ستتغير كميات {data['المخزن']} بعد ترحيل التسوية. {canCost && <>الأثر بالقيمة: <Money value={counts.reduce((sum,line) => sum + (Number(data[line.key])-line.system)*line.cost,0)} digits={2} />.</>}</Notice></> },
  ],confirm:(data) => ({title:`رحّل تسوية جرد ${data['المخزن']}؟`,label:'رحّل تسوية الجرد',body:'اعتمد الكميات المعدودة بعد مراجعة الفروقات. يُسجّل التعديل في نموذج حركة المخزون.'}),result:'رُحّلت تسوية الجرد رقم 33 في المعاينة',resultText:() => 'حُفظ مثال الفروقات وأثرها في سجل الجرد.',next:['اعرض فروقات الجرد','#/inventory/count-history'] };
  if (id === 'backup-now') return { steps:[{title:'أنشئ نسخة احتياطية',action:'أنشئ النسخة التجريبية',fields:[select('وجهة النسخة',['تخزين سحابي','تنزيل محلي'])],view:() => <Notice>تبدأ المعاينة بتهيئة نسخة آمنة ثم تعرض الحجم ووقت الإنشاء والتحقق.</Notice>}],result:'اكتمل إنشاء النسخة الاحتياطية التجريبية',resultText:() => <>النسخة <bdi>#214</bdi> · الحجم 64.8 ميغابايت · <bdi dir="ltr">2026-11-23 10:30</bdi><br/>بصمة تحقق توضيحية: <bdi dir="ltr">c42f9a8e…b17d</bdi></>,next:['اعرض النسخ المتاحة','#/backup/backups'] };
  if (id === 'opening') return { steps:[
    {title:'أرصدة الحسابات',action:'أضف أرصدة الأطراف',fields:[{label:'حساب الرصيد الافتتاحي',picker:'account',initial:accounts[0]},f('إجمالي المدين','number','125000'),f('إجمالي الدائن','number','125000')],validate:(data) => cents(data['إجمالي المدين']) === cents(data['إجمالي الدائن']) ? '' : 'يجب أن يتساوى إجمالي المدين والدائن.' },
    {title:'أرصدة العملاء والموردين',action:'أضف أرصدة المخزون',fields:[{label:'العميل',picker:'customer'},f('ذمم العملاء','number','2200'),{label:'المورد',picker:'supplier'},f('ذمم الموردين','number','42500')]},
    {title:'أرصدة المخزون',action:'احفظ الأرصدة التجريبية',fields:[select('المخزن',warehouses,warehouse),{label:'الصنف',picker:'item'},f('قيمة رصيد المخزون','number','78000')],view:() => <Notice tone="good">إجمالي القيد الافتتاحي متوازن.</Notice>},
  ],result:'حُفظ مثال الأرصدة الافتتاحية',resultText:()=>'تُراجع هذه الأرصدة قبل ترحيلها في النظام الفعلي.' };
  if (id === 'import') return {steps:[
    {title:'اختر المصدر',action:'اربط أعمدة الملف',fields:[select('نوع البيانات',['الأصناف','العملاء','الموردون','الأرصدة الافتتاحية']),f('الملف التوضيحي','file')]},
    {title:'طابق الأعمدة',action:'راجع نتيجة التحقق',fields:[select('عمود الاسم',['العمود 1 · الاسم','العمود 2 · المعرّف']),select('عمود المعرّف',['العمود 2 · المعرّف','العمود 1 · الاسم'])],validate:(data) => data['عمود الاسم'] === data['عمود المعرّف'] ? 'خصّص عمودًا مختلفًا لكل حقل.' : '' },
    {title:'راجع نتيجة التحقق',action:'اعتمد الصفوف السليمة',view:() => <><Notice title="صف تجريبي يحتاج تصحيحًا" tone="warn">الصف 4 بلا معرّف. لن يُدرج مع الصفوف السليمة. لا يقرأ العرض محتويات ملفك.</Notice><div><Action onClick={() => downloadCsv('أخطاء الاستيراد التوضيحية',[['الصف','المشكلة'],[4,'المعرّف مفقود']])}>نزّل تقرير الأخطاء</Action></div></>},
  ],result:'اكتمل نموذج الاستيراد',resultText:()=>'حُوكي اعتماد الصفوف السليمة فقط. لم يُرفع الملف أو تُرسل محتوياته.'};
  return {steps:[
    {title:'الشركة',action:'اضبط الفرع',fields:[f('اسم الشركة','text',company)]},{title:'الفرع',action:'اضبط المخزن',fields:[f('اسم الفرع','text',branch)]},{title:'المخزن',action:'اضبط السنة المالية',fields:[f('اسم المخزن','text',warehouse)]},{title:'السنة المالية',action:'اختر دليل الحسابات',fields:[f('بداية السنة','date','2026-01-01'),f('نهاية السنة','date','2026-12-31')],validate:(data) => data['بداية السنة'] > data['نهاية السنة'] ? 'تاريخ النهاية يجب أن يأتي بعد البداية.' : ''},{title:'دليل الحسابات',action:'اضبط حسابات النقد',fields:[select('قالب الدليل',['تجارة التجزئة','تجارة الجملة'])]},{title:'حسابات النقد',action:'أضف المستخدم الأول',fields:[{label:'حساب الصندوق',picker:'account',initial:accounts[0]}]},{title:'المستخدم الأول',action:'احفظ إعداد الشركة',fields:[f('اسم المستخدم','text','أحمد خالد')]},
  ],result:'اكتمل إعداد الشركة في المعاينة',resultText:()=>'جميع إعدادات الشركة هنا توضيحية ولا تُنشئ حسابًا فعليًا.'};
}

function CountFields({ form }: { form: ReturnType<typeof useFields> }) {
  const [chosen,setChosen] = useState('');
  const target = counts.find((line) => line.item === chosen);
  return <div className="e-stack"><CodeNamePicker kind="item" label="ابحث في ورقة الجرد" value={chosen} onChange={setChosen} optional options={counts.map((line) => line.item)} context={{hideStock:true}} nextField={target?.key} getNextField={(record) => counts.find((line) => line.item === record.value)?.key} />{counts.map((line) => <div className="e-ledger-line" key={line.key}><div><h3>{line.item}</h3><small><bdi dir="ltr">{line.barcode}</bdi></small></div><Field {...form.bind(f(line.key,'number'))} /></div>)}</div>;
}
function StepForm({ step, data, onNext, back, role }: { step: Step; data: Values; onNext: (data: Values) => void; back?: () => void; role: Role }) {
  const specs = (step.fields ?? []).map((field) => ({...field,initial:data[field.label] ?? field.initial}));
  const form = useFields(specs);
  const [error,setError] = useState('');
  return <form className="e-panel e-form" noValidate onSubmit={(event) => { event.preventDefault(); if (!form.validate(event.currentTarget,() => ({role}))) return; const values = {...data,...form.values}; const message = step.validate?.(values); if (message) { setError(message); const input = event.currentTarget.querySelector<HTMLInputElement>('input, select'); input?.focus(); return; } onNext(values); }}>
    <h2 tabIndex={-1} id="wizard-step">{step.title}</h2>{step.view?.(data)}
    {step.body === 'stock' ? <CountFields form={form} /> : specs.length > 0 && <div className="e-field-grid">{specs.map((field) => { const bound = form.bind(field); return <Field key={field.label} {...bound} pickerContext={{role,warehouse:form.values['المخزن'] || data['المخزن']}} set={(value) => { setError(''); bound.set(value); }} />; })}</div>}
    {error && <Notice tone="danger">{error}</Notice>}<div className="e-form-actions"><button className="e-button primary" type="submit">{step.action}</button>{back && <Action icon={ChevronRight} onClick={back}>ارجع للخطوة السابقة</Action>}</div>
  </form>;
}
export function Wizard({ screen, branch, role }: { screen: Screen; branch: string; role: Role }) {
  const [index,setIndex] = useState(0);
  const [data,setData] = useState<Values>({});
  const [confirmation,setConfirmation] = useState<Values | null>(null);
  const [phase,setPhase] = useState<'form'|'working'|'done'>('form');
  const stage = useRef<HTMLDivElement>(null);
  const selectedBackup = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('backup') ?? undefined;
  const flow = flowFor(screen.id, branch, role === 'owner' || role === 'accountant', selectedBackup);
  const progress = screen.id === 'restore' || screen.id === 'backup-now';
  const current = phase === 'form' ? index : flow.steps.length;
  const finished = (value: Values) => { const {'عبارة مرور تجريبية': _secret,...retained} = value; setData(retained); setConfirmation(null); setPhase(progress ? 'working' : 'done'); };
  useEffect(() => { if (phase !== 'working') return; const t = window.setTimeout(() => setPhase('done'),1450); return () => window.clearTimeout(t); },[phase]);
  useEffect(() => { if (index > 0 || phase !== 'form') stage.current?.querySelector<HTMLElement>('h2')?.focus(); },[index,phase]);
  const pending = confirmation && flow.confirm?.(confirmation);
  if (screen.id === 'year-close' && role !== 'owner') return <Notice tone="warn" title="يلزم إذن إدارة الفترات">يمكنك مراجعة ميزان المراجعة من التقارير.</Notice>;
  return <div className="e-stack"><ol className="e-step-list" aria-label="مراحل العملية">{[...flow.steps.map((step) => step.title),'النتيجة'].map((step,i) => <li key={step} aria-current={i === current ? 'step' : undefined}><span>{i < current ? <Check size={13} aria-label="مكتملة" /> : i+1}</span>{step}</li>)}</ol>
    <div ref={stage} className="e-stack">{phase === 'form' ? <StepForm key={index} step={flow.steps[index]} data={data} role={role} back={index ? () => setIndex(index-1) : undefined} onNext={(value) => { if (index < flow.steps.length-1) { setData(value); setIndex(index+1); } else if (flow.confirm) { const {'عبارة مرور تجريبية': _secret,...retained} = value; setConfirmation(retained); } else finished(value); }} /> : phase === 'working' ? <section className="e-panel e-form" aria-busy="true"><h2 tabIndex={-1}>{screen.id === 'restore' ? 'جارٍ تطبيق الاستعادة التجريبية' : 'جارٍ إنشاء النسخة التجريبية'}</h2><Notice tone="warn">لا تغلق هذه الصفحة أثناء عرض التقدّم.</Notice><div className="e-skeleton" aria-hidden="true"><i/><i/><i/></div></section> : <><DoneMessage title={flow.result} onReset={() => { setIndex(0); setData({}); setPhase('form'); }}>{flow.resultText(data)}</DoneMessage>{flow.next && <div><Action href={flow.next[1]}>{flow.next[0]}</Action></div>}</> }</div>
    {pending && confirmation && <Confirm title={pending.title} label={pending.label} danger={pending.danger} onClose={() => setConfirmation(null)} onConfirm={() => finished(confirmation)}>{pending.body}</Confirm>}
  </div>;
}
