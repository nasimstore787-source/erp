import { LayoutDashboard, Calculator, Boxes, ShoppingBag, Store, ChartNoAxesCombined, DatabaseBackup, Settings, BookOpen, UserRound } from 'lucide-react';

export const modules = [
  { id: 'home', title: 'نظرة عامة', icon: LayoutDashboard, about: 'تابع حالة أعمالك من مكان واحد.' },
  { id: 'sales', title: 'المبيعات', icon: Store, about: 'الفواتير والعملاء والورديات اليومية.' },
  { id: 'accounting', title: 'الحسابات', icon: Calculator, about: 'القيود والسندات والأرصدة والفترات المالية.' },
  { id: 'inventory', title: 'المخازن', icon: Boxes, about: 'الأصناف وحركات المخزون والجرد.' },
  { id: 'purchases', title: 'المشتريات', icon: ShoppingBag, about: 'الموردون والفواتير والاستلام والسداد.' },
  { id: 'reports', title: 'التقارير', icon: ChartNoAxesCombined, about: 'أداء أعمالك وأرقامك في مكان واحد.' },
  { id: 'admin', title: 'إدارة النظام', icon: Settings, about: 'الشركة والمستخدمون والصلاحيات وسجل التدقيق.' },
  { id: 'backup', title: 'النسخ الاحتياطي', icon: DatabaseBackup, about: 'إدارة النسخ والتحقق والاستعادة الآمنة.' },
  { id: 'profile', title: 'حسابي', icon: UserRound, about: 'ملفك والإشعارات وحالة المزامنة.' },
  { id: 'design', title: 'دليل التصميم', icon: BookOpen, about: 'المكوّنات وفهرس الشاشات والمسارات ومواصفات التسليم.' },
] as const;
export type Module = typeof modules[number]['id'];
export const patterns = { list: 'قائمة', detail: 'تفاصيل سجل', form: 'نموذج', settings: 'إعدادات', report: 'تقرير', inbox: 'قائمة مهام', wizard: 'معالج متعدد الخطوات', overview: 'لوحة نظرة عامة' };
export type Pattern = keyof typeof patterns;
export const roles = { owner: 'المالك / المدير', accountant: 'المحاسب', keeper: 'أمين المخزن', buyer: 'مسؤول المشتريات', cashier: 'أمين الصندوق' };
export type Role = keyof typeof roles;
export type Screen = { module: Module; section: 'العمليات' | 'الإعدادات' | 'التقارير'; id: string; title: string; pattern: Pattern; action: string; fields: string[]; access: Role[]; sensitive?: boolean; href?: string };
const permissions: Partial<Record<Module, Role[]>> = { sales: ['accountant', 'cashier'], accounting: ['accountant'], inventory: ['accountant', 'keeper', 'buyer'], purchases: ['accountant', 'buyer', 'keeper'], profile: ['accountant', 'keeper', 'buyer', 'cashier'] };
type Definition = [id: string, title: string, pattern: Pattern, action?: string, fields?: string, sensitive?: boolean, href?: string];
const all: Screen[] = [];
function group(module: Module, section: Screen['section'], rows: Definition[]) {
  for (const [id, title, pattern, action, fields, sensitive, href] of rows) all.push({ module, section, id, title, pattern, action: action || (pattern === 'report' ? 'صدّر التقرير' : pattern === 'detail' ? 'اعرض المستند' : 'احفظ التغييرات'), fields: fields?.split('|') ?? [], access: ['owner', ...(permissions[module] ?? [])], sensitive, href });
}

group('admin', 'الإعدادات', [
  ['company','ملف الشركة','settings','احفظ ملف الشركة','اسم الشركة|رقم السجل التجاري|الرقم الضريبي|العنوان|رقم الهاتف|تذييل الإيصال|شعار الشركة:ملف'],
  ['branches','الفروع والمخازن','list','أضف فرعًا','اسم الفرع|المدينة|المخزن الافتراضي'], ['fiscal','السنوات والفترات المالية','list','أنشئ سنة مالية','اسم السنة|البداية:تاريخ|النهاية:تاريخ'], ['year-close','إقفال السنة المالية','wizard','راجع السنة'],
  ['currencies','العملات وأسعار الصرف','list','أضف سعر صرف','العملة|السعر:رقم|تاريخ السريان:تاريخ'], ['sequences','تسلسل أرقام المستندات','detail'], ['methods','طرق الدفع والحسابات','list','اربط طريقة دفع','طريقة الدفع|حساب الأستاذ:حساب'],
  ['tax','الضرائب','settings','احفظ إعدادات الضريبة','فعّل احتساب الضريبة:خيار|النسبة:رقم|حساب الضريبة:حساب'], ['print','قوالب الفواتير والإيصالات','settings','احفظ قالب الطباعة'], ['admin-units','وحدات القياس','list','أضف وحدة','الوحدة|معامل التحويل:رقم'],
]);
group('admin','العمليات',[
  ['users','المستخدمون','list','أضف مستخدمًا','الاسم|اسم المستخدم|الفرع:فرع|الدور:دور|اطلب التحقق بخطوتين:خيار'], ['permissions','الأدوار والصلاحيات','settings','احفظ مصفوفة الصلاحيات'],
  ['sessions','الجلسات والأجهزة النشطة','inbox','راجع الجلسات'], ['audit','سجل التدقيق','list','صدّر السجل'], ['approvals','الموافقات والإيصالات المعلّقة','inbox','راجع الإيصال'], ['notification-settings','إعدادات الإشعارات','settings','احفظ تفضيلات الإشعارات','أرسل تنبيه تعارض المبيعات:خيار|أرسل تنبيه فشل النسخ:خيار|أرسل تنبيه نقص المخزون:خيار'],
]);
group('accounting','الإعدادات',[
  ['accounts','دليل الحسابات','list','أضف حسابًا فرعيًا','الحساب الأب:حساب|اسم الحساب|النوع:مجموعة,تحليلي'], ['cost-centers','مراكز التكلفة','list','أضف مركز تكلفة','الاسم|المركز الأب|معرّف المركز'], ['opening','الأرصدة الافتتاحية','wizard','راجع الأرصدة'], ['expenses','فئات المصروفات','list','أضف فئة مصروف','الفئة|حساب المصروف:حساب'],
]);
group('accounting','العمليات',[
  ['receipt','سند قبض','form','سجّل سند القبض','العميل:عميل|المبلغ:رقم|طريقة القبض:دفع|تاريخ السند:تاريخ|المرجع|ملاحظات:ملاحظة'], ['payment','سند صرف','form','سجّل سند الصرف','الجهة:مورد,حساب مصروف|المورد:مورد|حساب المصروف:حساب|المبلغ:رقم|الطريقة:دفع|تاريخ السند:تاريخ|ملاحظات:ملاحظة'],
  ['journal','قيد يومية','form','رحّل القيد'], ['journal-detail','تفاصيل قيد يومية','detail','اعكس القيد'], ['cash-transfer','تحويل بين الحسابات','form','سجّل التحويل','الحساب المصدر:حساب|الحساب الوجهة:حساب|المبلغ:رقم|التاريخ:تاريخ|البيان:ملاحظة'], ['vouchers','سجل السندات','list','سجّل سند قبض'],
  ['reconcile','تسوية البنك والمحافظ','form','احفظ التسوية'], ['period-requests','طلبات قفل وفتح الفترات','inbox','راجع طلب الفترة'],
]);
group('inventory','الإعدادات',[
  ['items','الأصناف','list','أضف صنفًا'], ['item-edit','بطاقة إعداد الصنف','form','احفظ الصنف','اسم الصنف|الباركود|المجموعة|الوحدة الأساسية:وحدة,كرتون,كيس|الوحدة البديلة|معامل التحويل:رقم|سعر البيع:رقم|سعر الشراء:تكلفة|حد إعادة الطلب:رقم|قابل للبيع:خيار|قابل للشراء:خيار|نشط:خيار|صورة الصنف:ملف'],
  ['item-groups','مجموعات الأصناف','list','أضف مجموعة','اسم المجموعة|المجموعة الأم'], ['units','وحدات القياس والتحويل','list','أضف وحدة قياس','اسم الوحدة|الوحدة الأساسية|المعامل:رقم'], ['warehouses','المخازن','list','أضف مخزنًا','اسم المخزن|الفرع:فرع|اجعله افتراضيًا:خيار'], ['reorder','قواعد إعادة الطلب','settings','احفظ حد الطلب','الصنف:صنف|المخزن:مخزن|حد الطلب:رقم'], ['barcode','طباعة ملصقات الباركود','form','اطبع الملصقات','الصنف:صنف|عدد الملصقات:رقم|القالب:حراري 80 ملم,ورق A4'],
]);
group('inventory','العمليات',[
  ['stock','أرصدة المخزون','list','ابدأ جردًا'], ['goods','استلام البضاعة','wizard','راجع الاستلام'], ['issue','صرف وإتلاف المخزون','form','سجّل الصرف','المخزن:مخزن|الصنف:صنف|الكمية:رقم|السبب:تالف,منتهي الصلاحية,عينة|ملاحظات:ملاحظة'], ['warehouse-transfer','التحويل بين المخازن','form','أرسل التحويل','من مخزن:مخزن|إلى مخزن:مخزن|الصنف:صنف|الكمية:رقم|تاريخ النقل:تاريخ'], ['in-transit','حركات قيد النقل','inbox','استلم التحويل'],
  ['stock-count','جرد المخزون','wizard','ابدأ العدّ'], ['adjustment','تسوية المخزون','form','أرسل التسوية للمراجعة','المخزن:مخزن|الصنف:صنف|الكمية المصححة:رقم|السبب:ملاحظة|المعتمد:أحمد خالد,سارة عادل'], ['item-card','بطاقة حركة الصنف','detail'], ['prices','تاريخ أسعار الأصناف','list','صدّر الأسعار'],
]);
group('purchases','الإعدادات',[
  ['suppliers','الموردون','list','أضف موردًا'], ['supplier-detail','ملف المورد','detail'], ['supplier-edit','إعداد المورد','form','احفظ المورد','اسم المورد|رقم الهاتف|مدة السداد:رقم|حد الائتمان:رقم|الرصيد الافتتاحي:رقم|الحساب الرقابي:حساب|ملاحظات:ملاحظة'], ['supplier-groups','مجموعات الموردين','list','أضف مجموعة','اسم المجموعة|الوصف'], ['purchase-defaults','إعدادات المشتريات','settings','احفظ الإعدادات','حساب المشتريات:حساب|المخزن الافتراضي:مخزن'],
]);
group('purchases','العمليات',[
  ['purchase-order','أوامر الشراء','list','أنشئ أمر شراء','المورد:مورد|تاريخ الطلب:تاريخ|الصنف:صنف|الكمية:رقم'], ['purchase-invoices','فواتير المشتريات','list','سجّل فاتورة مشتريات'], ['purchase-invoice','فاتورة مشتريات','form','رحّل فاتورة المشتريات','المورد:مورد|التاريخ:تاريخ|المخزن:مخزن|الدفع:آجل,نقدًا,محفظة جيب,الكريمي|مرفق الفاتورة:ملف'], ['purchase-detail','تفاصيل فاتورة مشتريات','detail','اعكس الفاتورة'], ['purchase-return','مرتجع مشتريات','form','رحّل مرتجع المشتريات','الفاتورة الأصلية|الصنف:صنف|الكمية:رقم|سبب الإرجاع:ملاحظة'], ['supplier-payment','سداد الموردين','form','سجّل سداد المورد','المورد:مورد|المبلغ:رقم|طريقة الدفع:دفع|التاريخ:تاريخ'], ['price-comparison','مقارنة أسعار الموردين','list','صدّر المقارنة'],
]);
group('sales','العمليات',[
  ['quick-sale','نقطة البيع','form','ابدأ البيع','',false,'#pos'], ['sales-invoices','فواتير المبيعات','list','اعرض الفواتير','',false,'#invoices'], ['sales-invoice','فاتورة مبيعات','form','رحّل فاتورة المبيعات','العميل:عميل|التاريخ:تاريخ|المخزن:مخزن|الدفع:دفع'], ['shifts','الوردية الحالية','detail','اعرض الوردية','',false,'#shift'], ['shift-open','فتح وردية','form','افتح الوردية','عهدة البداية:رقم|الصندوق:حساب'], ['shift-close','إقفال الوردية','form','سجّل النقد المعدود','النقد المعدود:رقم'], ['shift-history','سجل الورديات','list','صدّر الورديات'], ['sales-return','مرتجع مبيعات','form','سجّل مرتجع البيع','رقم الفاتورة|الصنف:صنف|الكمية:رقم|السبب:ملاحظة'], ['collections','التحصيل من العملاء','form','سجّل التحصيل','العميل:عميل|المبلغ:رقم|طريقة الدفع:دفع|التاريخ:تاريخ'], ['quotations','عروض الأسعار','list','أنشئ عرض سعر','العميل:عميل|الصنف:صنف|الكمية:رقم|صلاحية العرض:تاريخ'], ['sales-pending','الإيصالات المعلّقة','inbox','راجع الإيصالات','',false,'#conflicts'], ['reminders','تذكير العملاء بالسداد','form','أنشئ التذكير','العميل:عميل|التاريخ:تاريخ|الرسالة:ملاحظة'],
]);
group('sales','الإعدادات',[
  ['customers','العملاء','list','أضف عميلًا','اسم العميل|الهاتف|حد الائتمان:رقم|مدة السداد:رقم|قائمة الأسعار'], ['customer-detail','ملف العميل','detail'], ['customer-groups','مجموعات العملاء','list','أضف مجموعة','اسم المجموعة|الوصف'], ['price-lists','قوائم الأسعار','list','أضف قائمة','اسم القائمة|العملة|تاريخ السريان:تاريخ'], ['discounts','قواعد الخصم','settings','احفظ قاعدة الخصم','اسم القاعدة|النسبة:رقم|حد الخصم:رقم'], ['pos-settings','إعدادات نقطة البيع','settings','احفظ إعدادات البيع','طريقة الدفع الافتراضية:دفع|اطبع الإيصال تلقائيًا:خيار|اطلب فتح وردية:خيار'], ['sales-methods','طرق دفع المبيعات','list','اربط طريقة دفع','الطريقة:دفع|الحساب:حساب'],
]);
group('backup','الإعدادات',[
  ['schedule','جدولة النسخ الاحتياطي','settings','احفظ جدول النسخ','التكرار:يومي,أسبوعي|وقت النسخ:وقت|عدد النسخ المحتفظ بها:رقم|الوجهة:تخزين سحابي,تنزيل محلي|عبارة التشفير:سر|مسؤول التنبيهات'],
]);
group('backup','العمليات',[
  ['backup-now','نسخ احتياطي الآن','wizard','أنشئ نسخة احتياطية'], ['backups','النسخ المتاحة','list','أنشئ نسخة احتياطية'], ['restore','استعادة نسخة احتياطية','wizard','اختر النسخة'], ['export','تصدير البيانات','form','صدّر البيانات','الوحدة:الأصناف,العملاء,الموردون,الأرصدة الافتتاحية|نوع الملف:جدول بيانات,ملف قيم مفصولة'], ['import','استيراد البيانات','wizard','راجع الملف'], ['restore-history','سجل الاستعادة','list','صدّر السجل'],
]);
group('profile','العمليات',[
  ['account-profile','الملف الشخصي','settings','احفظ الملف الشخصي','الاسم|رقم الهاتف'], ['password','تغيير كلمة المرور','form','احفظ كلمة المرور','كلمة المرور الحالية:سر|كلمة المرور الجديدة:سر'], ['2fa','التحقق بخطوتين','form','تحقق من الرمز','رمز التحقق:رقم'], ['notifications','مركز الإشعارات','inbox','راجع الإشعارات'], ['search','البحث العام','list','ابحث في السجلات'], ['sync','قائمة انتظار المزامنة','inbox','راجع قائمة المزامنة'], ['login','تسجيل الدخول','form','اعرض الدخول','',false,'/?screen=login'], ['forgot','استعادة الدخول','form','اطلب استعادة الدخول','رمز الشركة|اسم المستخدم'], ['first-run','إعداد النظام لأول مرة','wizard','ابدأ إعداد الشركة'], ['offline','حالة عدم الاتصال','detail'], ['forbidden','الوصول غير المصرّح','detail'], ['not-found','صفحة غير موجودة','detail'], ['maintenance','الصيانة','detail'], ['global-empty','لا توجد بيانات بعد','detail'], ['global-error','تعذّر تحميل البيانات','detail'], ['region','اللغة والمنطقة','settings','احفظ المنطقة','المنطقة:اليمن,السعودية,عُمان|تنسيق التاريخ:ميلادي'], ['pdf','معاينة الطباعة','detail','اطبع المستند'],
]);
const reports: Partial<Record<Module, [string,string,boolean?][]>> = {
  accounting: [['ledger','الأستاذ العام'],['trial','ميزان المراجعة'],['income','قائمة الدخل',true],['balance-sheet','الميزانية العمومية'],['cashflow','التدفق النقدي',true],['customer-statement','كشف حساب العميل'],['aging-receivable','أعمار الذمم المدينة'],['aging-payable','أعمار الذمم الدائنة'],['treasury','حركة الصندوق اليومية',true],['expense-report','المصروفات حسب الفئة'],['journal-report','سجل قيود اليومية'],['reversals','المستندات الملغاة']],
  inventory: [['valuation','تقييم المخزون',true],['stock-report','المخزون حسب المخزن'],['movements','حركة المخزون'],['slow-stock','المخزون بطيء وراكد الحركة'],['fast-stock','الأصناف سريعة الحركة'],['low-stock','النواقص وإعادة الطلب'],['expiry','صلاحية المخزون'],['count-history','فروقات الجرد'],['item-profit','الربح حسب الصنف',true]],
  purchases: [['purchase-by-supplier','المشتريات حسب المورد'],['purchase-by-item','المشتريات حسب الصنف'],['purchase-by-period','المشتريات حسب الفترة'],['payables','أعمار مستحقات الموردين'],['supplier-statement','كشف حساب المورد'],['purchase-returns','مرتجعات المشتريات'],['price-variance','فروقات الأسعار'],['top-suppliers','أكبر الموردين'],['dues','المبالغ المستحقة قريبًا']],
  sales: [['daily-sales','المبيعات اليومية'],['net-sales','صافي المبيعات'],['sales-by-cashier','المبيعات حسب أمين الصندوق'],['sales-by-item','المبيعات حسب الصنف'],['sales-by-category','المبيعات حسب المجموعة'],['sales-by-customer','المبيعات حسب العميل'],['sales-by-method','المبيعات حسب الدفع'],['top-sales','الأصناف الأكثر والأقل مبيعًا'],['sales-compare','مقارنة المبيعات'],['receivables','أعمار مستحقات العملاء'],['shift-report','تقارير الورديات',true],['discount-report','الخصومات الممنوحة'],['gross-profit','إجمالي الربح',true]],
  admin: [['activity','نشاط المستخدمين'],['login-attempts','محاولات الدخول'],['permission-log','تغييرات الصلاحيات'],['cancelled','المستندات الملغاة وأسبابها'],['health','صحة النظام والمزامنة']], backup: [['backup-log','نتائج النسخ الاحتياطي']],
};
for (const [module, rows] of Object.entries(reports)) group(module as Module, 'التقارير', rows.map(([id, title, sensitive]) => [id, title, 'report', 'صدّر التقرير', '', sensitive]));
export const screens = all;
export const screenHref = (screen: Screen) => screen.href || `#/${screen.module}/${screen.id}`;
export const moduleHref = (module: Module) => module === 'home' ? '#/' : `#/${module}`;
export function visible(screen: Screen, role: Role) {
  return screen.access.includes(role) && (!screen.sensitive || role === 'owner' || role === 'accountant') && !(role === 'cashier' && (screen.pattern === 'report' || screen.module === 'sales' && (screen.section === 'الإعدادات' || ['reminders', 'collections', 'sales-return', 'quotations'].includes(screen.id)))) && !(role === 'keeper' && screen.module === 'purchases' && !['purchase-order'].includes(screen.id));
}
export const flowIds = ['journal', 'goods', 'stock-count', 'restore', 'year-close'];
