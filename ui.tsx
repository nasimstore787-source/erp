import { useId, useState, type ReactNode } from 'react';
import { CodeNamePicker } from './CodeNamePicker';
import { pickerRecords, restrictionFor, type PickerContext, type PickerKind } from './pickerCatalog';
import { ArrowLeft, Check, CircleAlert, Clock3, FileText, Info, LockKeyhole, Search, TriangleAlert, Undo2, type LucideIcon } from 'lucide-react';

export const demoDate = '2026-11-23';
export const num = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export function Money({ value, digits = 0 }: { value: number; digits?: number }) { return <span className="e-money"><bdi dir="ltr">{num(value, digits)}</bdi><small>ر.ي</small></span>; }
export function Action({ children, href, icon: Icon, kind = 'secondary', onClick }: { children: ReactNode; href?: string; icon?: LucideIcon; kind?: 'primary' | 'secondary' | 'danger' | 'quiet'; onClick?: () => void }) {
  const klass = `e-button ${kind}`;
  const content = <>{Icon && <Icon aria-hidden="true" size={17} />}{children}</>;
  return href ? <a className={klass} href={href}>{content}</a> : <button className={klass} type="button" onClick={onClick}>{content}</button>;
}
export const statusTypes = { posted: ['مرحّل', Check, 'good'], draft: ['مسودة', FileText, 'neutral'], reversed: ['ملغى', Undo2, 'danger'], pending: ['معلّق', Clock3, 'warn'], overdue: ['متأخر', CircleAlert, 'danger'], low: ['مخزون منخفض', TriangleAlert, 'warn'], locked: ['مقفل', LockKeyhole, 'neutral'], active: ['نشط', Check, 'good'] } as const;
export type Status = keyof typeof statusTypes;
export function Badge({ status }: { status: Status }) { const [label, Icon, tone] = statusTypes[status]; return <span className={`e-badge ${tone}`}><Icon size={13} aria-hidden="true" />{label}</span>; }
export function Notice({ title, children, tone = 'info' }: { title?: string; children: ReactNode; tone?: 'info' | 'warn' | 'danger' | 'good' }) { const Icon = tone === 'good' ? Check : tone === 'info' ? Info : TriangleAlert; return <div className={`e-notice ${tone}`} role={tone === 'danger' ? 'alert' : undefined}><Icon size={18} aria-hidden="true" /><div>{title && <strong>{title}</strong>}<div>{children}</div></div></div>; }
export function PageIntro({ title, description, parent, children }: { title: string; description: string; parent?: { href: string; label: string }; children?: ReactNode }) { return <header className="e-page-intro"><div>{parent && <a className="e-back" href={parent.href}><ArrowLeft className="e-rtl-back" size={15} aria-hidden="true" />{parent.label}</a>}<h1 id="erp-title">{title}</h1><p>{description}</p></div>{children && <div className="e-page-actions">{children}</div>}</header>; }
export function SearchBox({ value, set, label = 'ابحث في السجلات' }: { value: string; set: (v: string) => void; label?: string }) { return <label className="e-search"><span className="sr-only">{label}</span><Search size={17} aria-hidden="true" /><input value={value} onChange={(event) => set(event.target.value)} placeholder={label} /></label>; }
export type FieldSpec = { label: string; type?: string; options?: string[]; picker?: PickerKind; optional?: boolean; initial?: string; min?: number };
export function Field({ spec, value, set, error, onBlur, pickerContext }: { spec: FieldSpec; value?: string; set?: (v: string) => void; error?: string; onBlur?: () => void; pickerContext?: PickerContext }) {
  if (spec.picker) return <CodeNamePicker kind={spec.picker} label={spec.label} value={value ?? ''} onChange={set ?? (() => {})} optional={spec.optional} error={error} context={pickerContext} />;
  return <BasicField spec={spec} value={value} set={set} error={error} onBlur={onBlur} />;
}
function BasicField({ spec, value, set, error, onBlur }: { spec: FieldSpec; value?: string; set?: (v: string) => void; error?: string; onBlur?: () => void }) {
  const id = useId();
  const [fileName, setFileName] = useState('');
  const a = { id, name: spec.label, 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined, onBlur };
  const change = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set?.(event.currentTarget.value);
  return <div className={`e-field ${spec.type === 'checkbox' ? 'e-check-field' : ''}`}>
    {spec.type === 'checkbox' ? <label htmlFor={id}><input {...a} type="checkbox" checked={value === '1'} onChange={(event) => set?.(event.currentTarget.checked ? '1' : '0')} />{spec.label}</label> : <><label htmlFor={id}>{spec.label}{spec.optional && <small> · اختياري</small>}</label>
    {spec.options ? <select {...a} value={value ?? ''} onChange={change}><option value="">اختر من القائمة</option>{spec.options.map((option) => <option key={option}>{option}</option>)}</select>
    : spec.type === 'textarea' ? <textarea {...a} value={value ?? ''} onChange={change} rows={3} />
    : spec.type === 'file' ? <div className="e-file"><input {...a} className="sr-only" type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]?.name ?? ''; setFileName(file); set?.(file); }} /><label className="e-button secondary" htmlFor={id}>اختر ملفًا</label><span className="e-caption" aria-live="polite">{fileName || 'لم يُختر ملف'}</span></div>
    : <input {...a} type={spec.type || 'text'} dir={['number', 'date', 'time'].includes(spec.type || '') ? 'ltr' : undefined} value={value ?? ''} onChange={change} min={spec.min} step={spec.type === 'number' ? '0.01' : undefined} inputMode={spec.type === 'number' ? 'decimal' : undefined} />}</>}
    {error && <small id={`${id}-error`} className="e-field-error">{error}</small>}
  </div>;
}
export function formError(field: FieldSpec, value: string, pickerContext?: PickerContext) {
  if (field.type === 'checkbox') return '';
  if (!value.trim()) return field.optional ? '' : `أدخل ${field.label}.`;
  if (field.picker) {
    const record = pickerRecords[field.picker].find((entry) => entry.value === value);
    return record ? restrictionFor(record,pickerContext) : 'اختر قيمة متاحة من القائمة.';
  }
  if (field.options && !field.options.includes(value)) return 'اختر قيمة متاحة من القائمة.';
  if (field.type === 'number' && (!Number.isFinite(Number(value)) || (field.min !== undefined && Number(value) < field.min))) return `أدخل رقمًا لا يقل عن ${field.min ?? 0}.`;
  return '';
}
export function useFields(fields: FieldSpec[]) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.label, field.initial ?? field.options?.[0] ?? ''])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  return { values, setValues, bind: (spec: FieldSpec) => ({ spec, value: values[spec.label], error: errors[spec.label], set: (value: string) => { setValues((current) => ({ ...current, [spec.label]: value })); setErrors((current) => ({ ...current, [spec.label]: '' })); }, onBlur: () => setErrors((current) => ({ ...current, [spec.label]: formError(spec, values[spec.label] ?? '') })) }), validate: (form: HTMLFormElement, pickerContext?: (field: FieldSpec) => PickerContext) => {
    const entries = fields.filter((field) => form.elements.namedItem(field.label)).map((field) => [field.label, formError(field, values[field.label] ?? '', pickerContext?.(field))] as const).filter(([, message]) => message);
    setErrors(Object.fromEntries(entries));
    if (entries.length) { const node = form.elements.namedItem(entries[0][0]); if (node instanceof HTMLElement) { node.focus(); node.scrollIntoView({ block: 'nearest' }); } }
    return !entries.length;
  } };
}
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const cell = (value: string | number) => `"${(typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value)).replaceAll('"', '""')}"`;
  const url = URL.createObjectURL(new Blob(['\uFEFF', rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="e-empty"><span className="e-icon-box"><FileText size={22} aria-hidden="true" /></span><h2>{title}</h2><p>{children}</p>{action}</div>; }
