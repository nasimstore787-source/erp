import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, CodeXml, ListChecks, ReceiptText, ScanBarcode } from 'lucide-react';
import { CodeNamePicker, type CatalogState } from './CodeNamePicker';
import { pickerRecords, type PickerKind } from './pickerCatalog';
import { Action, Field, PageIntro } from './ui';

const types = { account:'حساب', customer:'عميل', supplier:'مورد', item:'صنف' } as const;
type GuideKind = keyof typeof types;
type Scenario = 'empty' | 'recent' | 'search' | 'selected' | 'missing' | 'group' | 'inactive' | 'system' | 'restricted' | 'loading' | 'offline' | 'stale' | 'error';
const scenarios: [Scenario,string][] = [['empty','فارغ'],['recent','التركيز والمفضّلة'],['search','كتابة واقتراحات'],['selected','مطابقة واختيار'],['missing','رقم غير موجود'],['group','حساب رئيسي'],['inactive','سجل غير نشط'],['system','حساب نظام'],['restricted','غير مصرّح'],['loading','تحميل متدرّج'],['offline','دون اتصال'],['stale','نسخة أقدم من يوم'],['error','خطأ التحميل وإعادة المحاولة']];
const presets: Partial<Record<Scenario,string>> = {missing:'1199',group:'1100',inactive:'1103',system:'1119',restricted:'1198'};
const examples: [string,string,string,typeof ReceiptText][] = [
  ['سند قبض','اختر العميل ثم أدخل المبلغ.','#/accounting/receipt',ReceiptText],
  ['قيد يومية','جرّب حسابًا تحليليًا، ثم أضف سطرًا من لوحة المفاتيح.','#/accounting/journal',ListChecks],
  ['فاتورة مشتريات','اختر الأصناف أو امسح الباركود. جرّب 6281001 مرتين.','#/purchases/purchase-invoice',ScanBarcode],
];

export function PickerGuide() {
  const [kind,setKind] = useState<GuideKind>('account');
  const [scenario,setScenario] = useState<Scenario>('empty');
  const [version,reset] = useState(0);
  const forcedAccount = !!presets[scenario] && scenario !== 'missing';
  const actualKind = forcedAccount ? 'account' : kind;
  return <div className="e-stack">
    <PageIntro title="الاختيار بالرقم أو الاسم" description="حقلان مترابطان لاختيار الحسابات والعملاء والموردين والأصناف. جرّب المكوّن وحالاته باتجاه عربي من اليمين إلى اليسار." parent={{href:'#/design',label:'دليل التصميم'}} />
    <div className="e-picker-guide-grid">
      <section className="e-panel e-form e-picker-lab" aria-labelledby="picker-lab-title">
        <header className="e-picker-guide-heading"><span className="e-icon-box"><CodeXml size={20} aria-hidden="true" /></span><div><h2 id="picker-lab-title">مساحة التجربة</h2><p>غيّر النوع أو الحالة. تبقى الأرقام والأسماء ظاهرة معًا بعد الاختيار.</p></div></header>
        <div className="e-field-grid">
          <label className="e-field">نوع السجل<select value={actualKind} onChange={(event) => { setKind(event.target.value as GuideKind); setScenario('empty'); }}>
            {Object.entries(types).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label className="e-field">حالة العرض<select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>{scenarios.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <PickerDemo key={`${actualKind}-${scenario}-${version}`} kind={actualKind} scenario={scenario} />
        <div><Action kind="quiet" onClick={() => reset(version+1)}>أعد ضبط المثال</Action></div>
      </section>
      <section className="e-panel e-form e-picker-reference" aria-labelledby="picker-spec-title">
        <header className="e-picker-guide-heading"><span className="e-icon-box"><BookOpen size={20} aria-hidden="true" /></span><div><h2 id="picker-spec-title">مواصفة التفاعل</h2><p>السلوك نفسه في النماذج والتقارير.</p></div></header>
        <dl>
          <div><dt>الرقم أو الاسم</dt><dd>تُحسم المطابقة التامة بعد 250 مللي ثانية دون نقل التركيز. يقبل الاسم البحث الجزئي وتُتجاهل الحركات وفروق كتابة الألف والياء والتاء المربوطة.</dd></div>
          <div><dt><kbd dir="ltr">↑</kbd> <kbd dir="ltr">↓</kbd> <kbd dir="ltr">Enter</kbd></dt><dd>تنقّل بين الاقتراحات، ثم اختر وانقل التركيز إلى الحقل التالي. في القيد والفاتورة، يفتح Enter بعد المبلغ أو الكمية سطرًا جديدًا عند نهاية القائمة.</dd></div>
          <div><dt><kbd dir="ltr">Tab</kbd> <kbd dir="ltr">Esc</kbd></dt><dd>يتحقق Tab من المطابقة وينتقل بترتيب الحقول. يغلق Esc القائمة دون مسح الإدخال. زر «غيّر» يمسح القيمتين ويعيد التركيز للرقم.</dd></div>
          <div><dt>عند تعذّر الاختيار</dt><dd>للرقم غير الموجود رسالة وزر «ابحث بالاسم». تظهر السجلات غير المتاحة ضمن الاقتراحات مع السبب، ولا يمكن اختيارها.</dd></div>
        </dl>
      </section>
    </div>
    <section className="e-stack" aria-labelledby="picker-examples-title">
      <div className="e-section-title"><h2 id="picker-examples-title">أمثلة داخل النماذج</h2><p>ثلاثة استخدامات للمكوّن في مساحة عمل رِفد.</p></div>
      <div className="e-guide-cards">{examples.map(([title,copy,href,Icon],index) => <article className="e-panel e-form e-picker-example" key={href}>
        <div><span className="e-icon-box"><Icon size={18} aria-hidden="true" /></span><small><bdi dir="ltr">0{index+1}</bdi></small></div>
        <h3>{title}</h3><p>{copy}</p><div><Action href={href} icon={ArrowLeft}>افتح {title}</Action></div>
      </article>)}</div>
    </section>
  </div>;
}

function PickerDemo({ kind, scenario }: { kind: PickerKind; scenario: Scenario }) {
  const [value,setValue] = useState(scenario === 'selected' ? pickerRecords[kind][0].value : '');
  const [amount,setAmount] = useState('');
  const [state,setState] = useState<CatalogState>(scenario === 'error' ? 'error' : scenario === 'offline' || scenario === 'stale' ? 'offline' : scenario === 'loading' ? 'loading' : 'ready');
  const demoQuery = presets[scenario] ?? (scenario === 'search' ? ({account:'11',customer:'مؤسسه',supplier:'اليمن',item:'ابيض',party:'مؤسسه'})[kind] : '');
  useEffect(() => {
    if (state !== 'loading') return;
    const timer = window.setTimeout(() => setState('ready'),2600);
    return () => window.clearTimeout(timer);
  }, [state]);
  return <form className="e-picker-demo" onSubmit={(event) => event.preventDefault()}>
    <CodeNamePicker kind={kind} label={kind === 'party' ? 'الطرف' : types[kind]} value={value} onChange={setValue} context={{role:'accountant'}} demo={{query:demoQuery,side:scenario === 'search' && kind !== 'account' ? 'name' : 'code',focus:!!demoQuery || scenario === 'recent' || scenario === 'loading'}} catalogState={state} cacheAgeDays={scenario === 'stale' ? 2 : 0} onRetry={() => setState('loading')} />
    <Field spec={{ label:kind === 'item' ? 'الكمية' : 'المبلغ',type:'number' }} value={amount} set={setAmount} />
  </form>;
}
