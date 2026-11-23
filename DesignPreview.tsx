import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, CloudCheck, ShieldCheck, UserRound } from 'lucide-react';
import ErpWorkspace from './erp/Workspace';
import type { Role } from './erp/catalog';
import './erp/erp.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import type { Bootstrap, InvoiceDetail, SaleBody } from './api';
import { today } from './format';
import Workstation, { modules, useTab } from './Workstation';
import Invoices from './screens/Invoices';
import Login from './screens/Login';
import Pos from './screens/Pos';
import Shift from './screens/Shift';

const sample = [
  ['أرز بسمتي 5 كجم', 4500, 40], ['سكر ناعم 1 كجم', 1200, 80], ['زيت طبخ 1.5 لتر', 2600, 30], ['دقيق أبيض 10 كجم', 5200, 25],
  ['شاي أحمر 100 كيس', 1800, 50], ['حليب مجفف 900 جم', 3900, 20], ['معكرونة 400 جم', 500, 120], ['تونة معلبة', 900, 60],
  ['مياه معدنية 600 مل', 200, 200], ['عصير برتقال 1 لتر', 700, 70], ['صابون سائل', 1500, 35], ['منظف أرضيات', 1100, 3],
] as const;
const day = today();
const opened = `${day}T08:00:00+03:00`;
const fixture: Bootstrap = {
  branch: { id: 'demo-branch', name_ar: 'الفرع الرئيسي' }, warehouse: { id: 'demo-store', name_ar: 'المخزن الرئيسي' },
  user: { id: 'design-user', name: 'أحمد خالد', can_post: true, can_reverse: false },
  shift: { id: 'design-shift', opened_at: opened, opening_float: '15000' }, server_date: day,
  items: sample.map(([name_ar, price, stock], index) => ({ id: String(1001 + index), item_code: String(1001 + index), barcode: String(6281001 + index), name_ar, unit_id: 'unit', price: String(price), stock: String(stock) })),
  customers: [{ id: 'design-customer', code: 'C001', name_ar: 'مؤسسة النور التجارية', balance: '2200', credit_limit: '50000' }],
  methods: [{ method: 'CASH', label_ar: 'نقدًا' }, { method: 'JAIB', label_ar: 'محفظة جيب' }, { method: 'JAWALI', label_ar: 'محفظة جوالي' }, { method: 'CREDIT', label_ar: 'آجل (على الحساب)' }],
};
const initialCart = { '1001': 1, '1002': 2, '1003': 1 };
const seedInvoice: InvoiceDetail = {
  id: 'design-invoice-1042', invoice_no: 1042, invoice_date: day, net_total: '5200', created_at: `${day}T08:45:00+03:00`, customer: null,
  reversed: false, returned_total: '0', has_customer: false, returnable: true,
  lines: [{ id: 'line-1', item: 'دقيق أبيض 10 كجم', qty: '1', unit_price: '5200', returned_qty: '0', refund_price: 5200 }], payments: [{ method: 'CASH', amount: '5200' }],
};
const exampleShift = { status: 'OPEN', opening_float: '15000', net_cash_sales: '5200', cash_receipts: '0', cash_payments: '0', petty_cash: '0', expected_cash: '20200', counted_cash: null, variance: null, wallets: {}, credit_sales: '0' };

function subscribePath(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export default function DesignPreview() {
  const hash = useSyncExternalStore(subscribePath, () => window.location.hash);
  const [role, setRole] = useState<Role>('owner');
  const legacy = hash !== '' && !hash.startsWith('#/');
  const login = new URLSearchParams(window.location.search).get('screen') === 'login';
  return <>{!legacy && !login && <ErpWorkspace hash={hash} role={role} setRole={setRole} />}<div hidden={!legacy && !login}><SalesPreview visible={legacy || login} /></div></>;
}

function SalesPreview({ visible }: { visible: boolean }) {
  const [boot, setBoot] = useState(fixture);
  const [invoices, setInvoices] = useState<InvoiceDetail[]>([seedInvoice]);
  const tab = useTab();
  const login = new URLSearchParams(window.location.search).get('screen') === 'login';

  useEffect(() => { if (visible) document.title = `${login ? 'تسجيل الدخول' : modules[tab].title} | رِفد`; }, [login, tab, visible]);

  function exampleSale(sale: SaleBody) {
    const invoice_no = invoices[0].invoice_no + 1;
    const invoice: InvoiceDetail = {
      ...seedInvoice, id: sale.offline_uuid, invoice_no, invoice_date: sale.invoice_date, created_at: new Date().toISOString(),
      net_total: String(sale.lines.reduce((sum, line) => sum + line.qty * line.unit_price, 0)),
      customer: boot.customers.find((customer) => customer.id === sale.customer_id)?.name_ar ?? null,
      has_customer: !!sale.customer_id,
      lines: sale.lines.map((line) => ({ id: line.item_id, item: boot.items.find((item) => item.id === line.item_id)?.name_ar ?? 'صنف', qty: String(line.qty), unit_price: String(line.unit_price), returned_qty: '0', refund_price: line.unit_price })),
      payments: sale.payments.map((payment) => ({ method: payment.payment_method, amount: String(payment.amount) })),
    };
    setInvoices((rows) => [invoice, ...rows]);
    return invoice_no;
  }

  if (login) return <Login preview onDone={() => {}} />;
  return <Workstation boot={boot} tab={tab} offline={false} preview>
    <div hidden={tab !== 'pos'}><Pos boot={boot} setBoot={setBoot} active={visible && tab === 'pos'} initialCart={initialCart} onPreviewSale={exampleSale} /></div>
    {tab !== 'pos' && <div className="module-content">
      {tab === 'invoices' && <Invoices boot={boot} offline={false} previewRows={invoices} />}
      {tab === 'shift' && <Shift boot={boot} reload={async () => {}} example={exampleShift} />}
      {tab === 'conflicts' && <div className="card empty-module"><span className="panel-icon"><CloudCheck size={22} aria-hidden="true" /></span><h2>لا توجد إيصالات معلّقة</h2><p>تظهر هنا الإيصالات التي تحتاج المراجعة. لا ترسل المعاينة أي إيصالات إلى الخادم.</p></div>}
      {tab === 'account' && <div className="stack"><div className="card pad task-card"><div className="panel-title"><span className="panel-icon"><UserRound size={21} aria-hidden="true" /></span><div><h2>{boot.user.name}</h2><p>حساب للعرض فقط · {boot.branch.name_ar}</p></div></div></div><section className="card pad task-card"><div className="panel-title"><span className="panel-icon"><ShieldCheck size={21} aria-hidden="true" /></span><div><h2>أمان الحساب</h2><p>يمكن تعديل كلمة المرور والتحقق بخطوتين في النظام الفعلي فقط.</p></div></div><a className="btn ghost preview-login-link" href="/?screen=login">معاينة شاشة تسجيل الدخول <ArrowLeft size={17} aria-hidden="true" /></a></section></div>}
    </div>}
  </Workstation>;
}
