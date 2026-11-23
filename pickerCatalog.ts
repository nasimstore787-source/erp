import type { Role } from './catalog';

export type PickerKind = 'account' | 'customer' | 'supplier' | 'item' | 'party';
export type PickerRecord = {
  code: string;
  name: string;
  value: string;
  meta: string;
  phone?: string;
  barcode?: string;
  favorite?: boolean;
  balance?: number;
  direction?: string;
  limit?: number;
  price?: number;
  stock?: number[];
  restriction?: 'group' | 'inactive' | 'system' | 'permission';
};
export type PickerContext = {
  role?: Role;
  warehouse?: string;
  hideStock?: boolean;
  accountUse?: 'posting' | 'parent' | 'report';
  blockedValue?: string;
  conflictLabel?: string;
};

const cash = 'أصول › نقد وما في حكمه';
const account = (code: string, name: string, meta: string, extra: Partial<PickerRecord> = {}): PickerRecord => ({ code, name, value: `${code} · ${name}`, meta, ...extra });
const party = (code: string, name: string, meta: string, phone: string, balance: number, direction: string, extra: Partial<PickerRecord> = {}): PickerRecord => ({ code, name, value: name, meta, phone, balance, direction, ...extra });
const item = (code: string, name: string, barcode: string, meta: string, price: number, stock: number[], restriction?: PickerRecord['restriction']): PickerRecord => ({ code, name, value: name, barcode, meta, price, stock, restriction });

const accountRecords = [
  account('1101','الصندوق الرئيسي',cash,{favorite:true,balance:27400}),
  account('1102','بنك الكريمي',cash,{balance:36500}),
  account('1110','محفظة جيب',cash,{favorite:true,balance:12500}),
  account('1201','ذمم العملاء','أصول › ذمم مدينة'),
  account('1301','مخزون البضاعة','أصول › مخزون'),
  account('2101','ذمم الموردين','خصوم › ذمم دائنة'),
  account('4101','إيراد المبيعات','إيرادات › مبيعات'),
  account('5101','مصروف التشغيل','مصروفات › تشغيل'),
  account('3101','الأرباح المحتجزة','حقوق الملكية › الأرباح المحتجزة'),
  account('1100','النقد وما في حكمه','أصول › مجموعة',{restriction:'group'}),
  account('1103','صندوق الفرع القديم',cash,{restriction:'inactive'}),
  account('1119','حساب تسوية النظام',cash,{restriction:'system'}),
  account('1198','صندوق الإدارة',cash,{restriction:'permission'}),
];
const customerRecords = [
  party('C001','مؤسسة النور التجارية','عميل · تجزئة','777903561',2200,'عليه',{limit:50000,favorite:true}),
  party('C002','بقالة الشروق','عميل · تجزئة','777903562',56100,'عليه',{limit:50000}),
  party('C003','أسواق البركة','عميل · جملة','777903563',70100,'عليه',{limit:100000}),
  party('C004','متجر الأمل','عميل · تجزئة','777903564',0,'عليه',{restriction:'inactive'}),
];
const supplierRecords = [
  party('S001','شركة اليمن للتوريدات','مورد · أجل 30 يومًا','771023456',42500,'له',{favorite:true}),
  party('S002','مؤسسة الأمانة للمواد الغذائية','مورد · أجل 15 يومًا','771023457',34900,'له'),
  party('S003','مؤسسة عدن للتجارة','مورد · نقدًا','771023458',19000,'له'),
];
const itemRecords = [
  item('1001','أرز بسمتي 5 كجم','6281001','كيس',4500,[40,22,18]),
  item('1003','زيت طبخ 1.5 لتر','6281003','عبوة',2600,[30,14,9]),
  item('1002','سكر ناعم 1 كجم','6281002','كيس',1200,[80,48,26]),
  item('1004','دقيق أبيض 10 كجم','6281004','كيس',5200,[25,10,6]),
  item('1012','منظف أرضيات 1 لتر','6281012','عبوة',1100,[3,6,0]),
  item('1014','عبوة عرض قديمة','6281014','عبوة',800,[0,0,0],'inactive'),
];
export const pickerRecords: Record<PickerKind, PickerRecord[]> = { account: accountRecords, customer: customerRecords, supplier: supplierRecords, item: itemRecords, party: [...customerRecords,...supplierRecords] };
export const pickerNouns: Record<PickerKind,string> = { account: 'حساب', customer: 'عميل', supplier: 'مورد', item: 'صنف', party: 'طرف' };
export const itemWarehouse = (warehouse?: string) => warehouse?.includes('عدن') ? 'مخزن عدن' : warehouse?.includes('تعز') ? 'مخزن تعز' : 'المخزن الرئيسي';
export const stockAt = (record: PickerRecord, warehouse?: string) => record.stock?.[warehouse?.includes('عدن') ? 1 : warehouse?.includes('تعز') ? 2 : 0];
export const canSeeCash = (role?: Role) => role === 'owner' || role === 'accountant';

export function restrictionFor(record: PickerRecord, { role, accountUse, blockedValue, conflictLabel }: PickerContext = {}) {
  if (record.value === blockedValue) return `لا يمكن اختيار ${record.name} مرة أخرى${conflictLabel ? `؛ هو ${conflictLabel}` : ' في هذا المستند'}.`;
  if (record.restriction === 'group' && !['parent','report'].includes(accountUse ?? '')) return 'حساب رئيسي — اختر حسابًا فرعيًا.';
  if (record.restriction === 'inactive') return 'هذا السجل غير نشط — اختر سجلًا نشطًا.';
  if (record.restriction === 'system') return 'حساب نظام — يُستخدم تلقائيًا فقط.';
  if (record.restriction === 'permission' && role !== 'owner') return 'لا تملك صلاحية استخدام هذا الحساب.';
  return '';
}

export function normalizePicker(text: string) {
  return Array.from(text.toLowerCase(), (char) => {
    const point = char.charCodeAt(0);
    if (point >= 0x660 && point <= 0x669) return String(point - 0x660);
    if (point >= 0x6f0 && point <= 0x6f9) return String(point - 0x6f0);
    return char.replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[\u0610-\u061a\u0640\u064b-\u065f\u0670]/g,'');
  }).join('').trim();
}

export function exactPicker(records: PickerRecord[], query: string, field: 'code' | 'name') {
  return records.find((record) => [record.code,record.barcode, ...(field === 'name' ? [record.name,record.phone] : [])].some((value) => value && normalizePicker(value) === query));
}

export function matchesPicker(record: PickerRecord, query: string, field: 'code' | 'name') {
  return field === 'code' ? [record.code,record.barcode].some((value) => value && normalizePicker(value).startsWith(query))
    : [record.name,record.code,record.phone,record.barcode].some((value) => value && normalizePicker(value).includes(query));
}
