export const money = (n: number | string | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
export const uuid = () => crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
export const receiptNo = () => 'P' + Date.now().toString(36).toUpperCase();
export const time = (iso: string) => new Date(iso).toLocaleTimeString('ar-YE-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
export const REASONS: [RegExp, string][] = [
  [/^INSUFFICIENT_STOCK/, 'نقص في المخزون'], [/^CREDIT_LIMIT/, 'تجاوز سقف الائتمان'], [/^SHIFT_CLOSED/, 'الوردية مغلقة'],
];
export const reasonAr = (r: string | null) => (r ? REASONS.find(([re]) => re.test(r))?.[1] ?? 'تعذّر الترحيل' : '');
