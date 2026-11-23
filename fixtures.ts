import type { Screen } from './catalog';
import { pickerRecords } from './pickerCatalog';
import { demoDate, type FieldSpec, type Status } from './ui';
export type Sample = { id: string; title: string; about: string; date: string; status: Status; value?: number; direction?: string; href?: string };
const row = (id: string, title: string, about: string, status: Status = 'active', value?: number, href?: string, direction?: string, date = demoDate): Sample => ({ id, title, about, status, value, href, direction, date });
export const company = 'مؤسسة روافد التجارية';
export const accounts = ['1101 · الصندوق الرئيسي','1102 · بنك الكريمي','1110 · محفظة جيب','1201 · ذمم العملاء','1301 · مخزون البضاعة','2101 · ذمم الموردين','4101 · إيراد المبيعات','5101 · مصروف التشغيل'];
export const items = pickerRecords.item.filter((record) => !record.restriction).map((record) => record.name);
export const suppliers = pickerRecords.supplier.map((record) => record.name);
export const clients = pickerRecords.customer.filter((record) => !record.restriction).map((record) => record.name);
const supplierRows = pickerRecords.supplier.map((record, i) => row(record.code, record.name, record.meta, i === 1 ? 'overdue' : 'active', record.balance, '#/purchases/supplier-detail', record.direction));
const clientRows = pickerRecords.customer.filter((record) => !record.restriction).map((record, i) => row(record.code, record.name, `سقف الائتمان ${(record.limit ?? 0).toLocaleString('en-US')} ر.ي`, i === 1 ? 'overdue' : 'active', record.balance, '#/sales/customer-detail', record.direction));
const itemRows = pickerRecords.item.filter((record) => !record.restriction).map((record, i) => row(record.code, record.name, `المخزن الرئيسي · ${record.stock?.[0]} ${record.meta}`, i === 4 ? 'low' : 'active', undefined, '#/inventory/item-card'));
const voucherRows = [row('128','سند قبض','مؤسسة النور التجارية', 'posted',18400,'#/accounting/receipt'), row('84','سند صرف','شركة اليمن للتوريدات','draft',23400,'#/accounting/payment'),row('186','قيد يومية','تحصيلات الفرع الرئيسي','posted',12500,'#/accounting/journal-detail'),row('185','عكس قيد يومية','مرتبط بالقيد رقم 185','reversed',10000,'#/accounting/journal-detail')];
export const backupRows = [row('214','نسخة 23 نوفمبر 2026','تلقائية · 64.8 ميغابايت · 02:00','posted',undefined,'#/backup/restore'), row('213','نسخة 22 نوفمبر 2026','يدوية · 63.2 ميغابايت · أحمد خالد','posted',undefined,'#/backup/restore',undefined,'2026-11-22'), row('212','نسخة 21 نوفمبر 2026','تلقائية · 63.0 ميغابايت · 02:00','posted',undefined,'#/backup/restore',undefined,'2026-11-21')];
const fiscalRows = [row('2026','السنة المالية 2026','2026-01-01 — 2026-12-31 · الفترة المفتوحة: نوفمبر','active',undefined,'#/admin/year-close'),row('2025','السنة المالية 2025','2025-01-01 — 2025-12-31 · أُقفلت نهاية السنة','locked')];
const adminRows = [row('001','أحمد خالد','المالك · الفرع الرئيسي · تحقّق بخطوتين'),row('002','سارة عادل','المحاسب · الفرع الرئيسي · تحقّق بخطوتين'),row('003','محمد الحداد','أمين الصندوق · فرع عدن · لم يُفعَّل التحقّق','pending')];
const purchaseRows = [row('305','فاتورة شركة اليمن للتوريدات','المخزن الرئيسي · على الحساب','posted',42500,'#/purchases/purchase-detail'),row('304','فاتورة الأمانة للمواد الغذائية','مخزن عدن · بنك الكريمي','draft',34900,'#/purchases/purchase-invoice'),row('303','فاتورة مؤسسة عدن للتجارة','المخزن الرئيسي · نقدًا','posted',19000,'#/purchases/purchase-detail')];
const approvals = [row('1043','إيصال بانتظار مراجعة المخزون','منظف أرضيات · المطلوب 5 والمتاح 3','pending',5500),row('1044','إيصال تجاوز حد الائتمان','مؤسسة النور التجارية · فرع عدن','pending',52700),row('1045','إيصال بانتظار المزامنة','جهاز الصندوق 02 · الفرع الرئيسي','pending',8700)];
const map: Record<string, Sample[]> = {
  branches: [row('01','الفرع الرئيسي','صنعاء · المخزن الرئيسي'),row('02','فرع عدن','عدن · مخزن عدن'),row('03','فرع تعز','تعز · مخزن تعز')],
  fiscal: fiscalRows, currencies: [row('01','الريال اليمني','العملة الأساسية · السعر 1'),row('02','الريال السعودي','آخر سعر مسجل: 142.50 ر.ي'),row('03','الدولار الأمريكي','آخر سعر مسجل: 535.00 ر.ي')],
  methods: ['نقدًا','محفظة جيب','محفظة جوالي','ون كاش','بنك الكريمي','آجل'].map((t,i) => row(`0${i+1}`, t, ['1101 · الصندوق الرئيسي','1110 · محفظة جيب','1111 · محفظة جوالي','1112 · ون كاش','1102 · بنك الكريمي','1201 · ذمم العملاء'][i])),
  'admin-units': [row('01','وحدة','الوحدة الأساسية · المعامل 1'),row('02','كرتون','يعادل 12 وحدة'),row('03','كيس','يعادل 1 وحدة')],
  users: adminRows, sessions: [row('12','حاسوب المحاسبة','سارة عادل · صنعاء · 10:24'),row('13','جهاز نقطة البيع','محمد الحداد · عدن · 10:12')],
  audit: [row('254','سارة عادل · رحّلت قيدًا','مسودة ← مرحّل · القيد 186 · جهاز المحاسبة','posted',undefined,'#/accounting/journal-detail'),row('253','أحمد خالد · حدّث الصلاحيات','أمين الصندوق · الخصم: مسموح ← غير مسموح'),row('252','أحمد خالد · أنشأ نسخة','النسخة 214','posted',undefined,'#/backup/backups')], approvals,
  accounts: accounts.map((t,i) => row(t.slice(0,4),t.slice(7),`${i < 5 ? 'أصول' : i === 5 ? 'خصوم' : i === 6 ? 'إيرادات' : 'مصروفات'} · تحليلي${i < 7 ? ' · حساب نظام' : ''}`,i < 7 ? 'locked' : 'active')),
  'cost-centers': [row('010','الإدارة العامة','المركز الرئيسي'),row('011','المبيعات','يتبع الإدارة العامة'),row('012','التوزيع','يتبع المبيعات')],
  expenses: [row('5101','مصروف التشغيل','حساب تحليلي'),row('5102','النقل والتوزيع','حساب تحليلي'),row('5103','الكهرباء والمياه','حساب تحليلي')],
  vouchers: voucherRows, 'period-requests': [row('19','طلب قفل أكتوبر 2026','سارة عادل · إغلاق بعد مراجعة المصروفات','pending')],
  items: itemRows, stock: itemRows, 'item-groups': [row('01','المواد الغذائية','أرز · سكر · زيت · دقيق'),row('02','المنظفات','مواد تنظيف منزلية'),row('03','المشروبات','مياه وعصائر')],
  warehouses: [row('01','المخزن الرئيسي','الفرع الرئيسي · افتراضي'),row('02','مخزن عدن','فرع عدن · افتراضي'),row('03','مخزن تعز','فرع تعز · افتراضي')],
  'in-transit': [row('54','تحويل إلى مخزن عدن','من المخزن الرئيسي · 12 كرتون زيت','pending'),row('53','تحويل إلى مخزن تعز','من المخزن الرئيسي · 6 أكياس دقيق','posted')],
  prices: pickerRecords.item.filter((record) => !record.restriction).map((record) => row(record.code,record.name,'سعر بيع الوحدة بعد آخر مراجعة','posted',record.price)),
  suppliers: supplierRows, 'supplier-groups': [row('01','موردو الأغذية','3 موردين نشطين'),row('02','موردو التجزئة','موردان نشطان')],
  'purchase-order': [row('152','أمر شراء شركة اليمن للتوريدات','وصلت 8 من 12 كرتونًا','pending',42500,'#/inventory/goods'),row('151','أمر شراء مؤسسة الأمانة','لم يُرسل إلى المورد','draft',19800)],
  'purchase-invoices': purchaseRows, 'price-comparison': suppliers.map((t,i) => row(`30${i+1}`,t,'أرز بسمتي 5 كجم · سعر الشراء للوحدة','active',[3900,4100,4050][i])),
  'shift-history': [row('75','وردية أحمد خالد','الصندوق الرئيسي · 08:00 — 14:00','posted'),row('74','وردية محمد الحداد','صندوق عدن · 14:00 — 20:00','posted')],
  quotations: [row('47','عرض أسعار مؤسسة النور','صالح حتى 2026-11-30','draft',28100),row('46','عرض أسعار أسواق البركة','مرتبط بالفاتورة رقم 1041','posted',36400)],
  customers: clientRows, 'customer-groups': [row('01','قطاع التجزئة','18 عميلًا'),row('02','قطاع الجملة','7 عملاء')],
  'price-lists': [row('01','قائمة التجزئة','ر.ي · القائمة الافتراضية'),row('02','قائمة الجملة','ر.ي · حد طلب أدنى')],
  backups: backupRows, 'restore-history': [row('08','استعادة النسخة 189','أحمد خالد · نسخة أمان 190','posted',undefined,undefined,undefined,'2026-10-09')],
  notifications: approvals, sync: approvals.slice(2), search: [...voucherRows,...purchaseRows,...itemRows,...clientRows,...supplierRows],
};
map.units = map['admin-units']; map['sales-methods'] = map.methods;
const reportsMap: Record<string, Sample[]> = {
  ledger: [row('128','سند قبض 128','مدين 18,400.00 · دائن 0.00','posted',18400,'#/accounting/vouchers'),row('84','سند صرف 84','مدين 0.00 · دائن 3,500.00','posted',14900,'#/accounting/vouchers'),row('186','قيد 186','مدين 12,500.00 · دائن 0.00','posted',27400,'#/accounting/journal-detail')],
  trial: [row('1101','الصندوق الرئيسي','مدين', 'posted',18400),row('1301','مخزون البضاعة','مدين','posted',42500),row('2101','ذمم الموردين','دائن','posted',42500),row('4101','إيراد المبيعات','دائن','posted',18400)],
  income: [row('4101','إيراد المبيعات','إيرادات الفترة','posted',84650),row('5104','تكلفة البضاعة المباعة','تكلفة الفترة','posted',57650),row('5101','مصروفات التشغيل','مصروفات الفترة','posted',5250)],
  'balance-sheet': [row('01','إجمالي الأصول','أرصدة ختامية','posted',295000),row('02','إجمالي الخصوم','أرصدة ختامية','posted',96400),row('03','حقوق الملكية','أرصدة ختامية','posted',198600)],
  treasury: [row('01','النقد الداخل','عمليات القبض ومبيعات نقدية','posted',52300),row('02','النقد الخارج','عمليات الصرف','posted',28750)],
  'daily-sales': [row('01','الفرع الرئيسي','24 فاتورة · 3 مرتجعات','posted',84650),row('02','فرع عدن','12 فاتورة · مرتجع واحد','posted',46220),row('03','فرع تعز','9 فواتير · لا مرتجعات','posted',33400)],
  'sales-by-method': [row('01','نقدًا','14 عملية','posted',52300),row('02','محفظة جيب','6 عمليات','posted',21200),row('03','على الحساب','4 عمليات','posted',11150)],
  'sales-by-cashier': adminRows.map((r,i) => ({ ...r, about: 'صافي المبيعات في الوردية', value: [52300,18750,13600][i], status: 'posted' })),
  'sales-by-category': map['item-groups'].map((r,i) => ({ ...r, value: [71650,2500,10500][i], about: 'صافي مبيعات المجموعة' })),
  'purchase-by-period': purchaseRows, 'purchase-by-supplier': supplierRows, 'top-suppliers': supplierRows, 'supplier-statement': supplierRows, 'customer-statement': clientRows, dues: supplierRows.slice(0,2),
  'low-stock': itemRows.filter((r) => r.status === 'low'), 'stock-report': itemRows, movements: [row('67','استلام بضاعة','المخزن الرئيسي · +8 كراتين','posted',undefined,'#/inventory/goods'),row('54','تحويل مخزون','مخزن عدن · -12 كرتونًا','pending',undefined,'#/inventory/in-transit')],
  'count-history': [row('33','جرد المخزن الرئيسي','3 أصناف · فرق -2 وحدة','posted',undefined,'#/inventory/stock-count')],
  expiry: [row('298','حليب مجفف 900 جم','المخزن الرئيسي · الصلاحية 2026-12-01','pending')],
  'backup-log': backupRows, activity: map.audit, 'permission-log': map.audit.slice(1,2), 'login-attempts': [row('81','محاولة دخول ناجحة','أحمد خالد · جهاز المحاسبة','posted'),row('80','محاولة دخول لم تكتمل','مستخدم الصندوق · رمز تحقق منتهي الصلاحية','pending')],
  health: [row('01','جهاز المحاسبة','آخر مزامنة 10:24 · لا إيصالات معلقة','active'),row('02','جهاز نقطة البيع','آخر مزامنة 10:12 · إيصال واحد معلّق','pending')],
};
const ageIds = ['aging-payable','aging-receivable','receivables','payables'];
export function rowsFor(screen: Screen, role: string): Sample[] {
  if (screen.id === 'price-comparison' && role !== 'owner' && role !== 'accountant') return map[screen.id].map(({ value: _value, ...r }) => r);
  if (map[screen.id]) return map[screen.id];
  if (reportsMap[screen.id]) return reportsMap[screen.id];
  if (ageIds.includes(screen.id)) return ['0–30','31–60','61–90','91+'].map((label,i) => row(String(i+1),`${label} يومًا`, 'حسب تاريخ الاستحقاق',i > 0 ? 'overdue' : 'active',[45600,28500,14100,8200][i],undefined,screen.id.includes('payable') ? 'له' : 'عليه'));
  if (screen.id === 'reversals' || screen.id === 'cancelled') return voucherRows.filter((r) => r.status === 'reversed');
  if (screen.module === 'sales') return screen.id.includes('item') || screen.id === 'top-sales' ? itemRows.map((r,i) => ({...r, about: `الكمية المباعة: ${[28,19,17,11,4][i]}`, value: [126000,49400,20400,57200,4400][i] })) : reportsMap['daily-sales'];
  if (screen.module === 'inventory') return screen.sensitive ? itemRows.map((r,i) => ({...r, value: [156000,65400,72000,104000,2550][i] })) : itemRows;
  if (screen.module === 'purchases') return screen.id.includes('item') ? itemRows.map((r,i) => ({...r, value: [39000,43600,18000,10400,2550][i] })) : purchaseRows;
  return screen.id === 'cashflow' ? reportsMap.treasury : voucherRows;
}

const stocked: Record<string,string[]> = { حساب: accounts, صنف: items, مورد: suppliers, عميل: clients, فرع: ['الفرع الرئيسي','فرع عدن','فرع تعز'], مخزن: ['المخزن الرئيسي','مخزن عدن','مخزن تعز'], دفع: ['نقدًا','محفظة جيب','محفظة جوالي','ون كاش','بنك الكريمي','آجل'], دور: ['المالك / المدير','المحاسب','أمين المخزن','مسؤول المشتريات','أمين الصندوق'] };
const defaults: Record<string,string> = { 'اسم الشركة': company, 'رقم السجل التجاري':'2026-01325', 'العنوان':'شارع الزبيري، صنعاء', 'رقم الهاتف':'777123456', 'تذييل الإيصال':'شكرًا لتسوّقكم معنا', 'التكرار':'يومي', 'وقت النسخ':'02:00', 'عدد النسخ المحتفظ بها':'14', 'مسؤول التنبيهات':'أحمد خالد', 'عهدة البداية':'15000', 'المدة':'30' };
export function fieldSpecs(fields: string[], branch: string, cost: boolean): FieldSpec[] {
  return fields.flatMap((field) => {
    const [label, kind] = field.split(':');
    if (kind === 'تكلفة' && !cost) return [];
    const types: Record<string,string> = { تاريخ:'date', وقت:'time', ملف:'file', ملاحظة:'textarea', رقم:'number', تكلفة:'number', خيار:'checkbox', سر:'password' };
    const type = types[kind];
    const options = stocked[kind] ?? (kind && !type ? kind.split(',') : undefined);
    const initial = defaults[label] ?? (kind === 'فرع' ? branch : kind === 'مخزن' ? stocked.مخزن[stocked.فرع.indexOf(branch)] ?? stocked.مخزن[0] : type === 'date' ? demoDate : undefined);
    const picker = ({ حساب:'account', صنف:'item', مورد:'supplier', عميل:'customer' } as const)[kind as 'حساب' | 'صنف' | 'مورد' | 'عميل'];
    return [{ label, type, options, initial: initial ?? (picker ? '' : undefined), picker, min: type === 'number' ? (label.includes('المبلغ') ? .01 : 0) : undefined, optional: type === 'file' || type === 'textarea' && !label.includes('سبب') || label === 'المرجع' || label === 'الرقم الضريبي' || kind === 'سر' && label === 'عبارة التشفير' }];
  });
}
