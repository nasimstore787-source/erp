import { useRef, type Dispatch, type SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CodeNamePicker } from './CodeNamePicker';
import { pickerRecords, type PickerRecord } from './pickerCatalog';
import { Action, Field, Money, Notice, type FieldSpec } from './ui';

export type InvoiceLine = { id: number; item: string; qty: string; price: string; discount: string };
export const invoiceLineName = (field: string, id: number) => `${field} · بند ${id}`;
const priceFor = (record?: PickerRecord, purchase = false) => String(record ? purchase ? Math.round((record.price ?? 0) * 0.865) : record.price ?? 0 : '');
export function invoiceSeed(purchase: boolean): InvoiceLine[] {
  return [{ id:1, item:purchase ? pickerRecords.item[0].value : '', qty:purchase ? '2' : '', price:purchase ? '3900' : '', discount:'0' }];
}

export function InvoiceLines({ lines, setLines, warehouse, purchase, onEdit }: { lines: InvoiceLine[]; setLines: Dispatch<SetStateAction<InvoiceLine[]>>; warehouse?: string; purchase: boolean; onEdit: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const lastId = useRef(lines.at(-1)?.id ?? 1);
  const total = lines.reduce((sum,line) => sum + Number(line.qty)*Number(line.price)-Number(line.discount),0);
  function focusField(name: string) {
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`)?.focus());
  }
  function addLine() {
    const id = ++lastId.current;
    onEdit(); setLines((rows) => [...rows,{id,item:'',qty:'',price:'',discount:'0'}]);
    focusField(invoiceLineName('الصنف',id));
  }
  function edit(id: number, changes: Partial<InvoiceLine>) {
    onEdit(); setLines((rows) => rows.map((line) => line.id === id ? {...line,...changes} : line));
  }
  function scanExisting(record: PickerRecord) {
    const existing = lines.find((line) => line.item === record.value);
    if (!existing) return false;
    onEdit(); setLines((rows) => rows.map((line) => line.id === existing.id ? {...line,qty:String((Number(line.qty) || 0)+1)} : line));
    focusField(invoiceLineName('الكمية',existing.id));
    return true;
  }
  return <div ref={root} className="e-stack">
    <h2>{purchase ? 'بنود فاتورة المشتريات' : 'بنود فاتورة المبيعات'}</h2>
    <div className="e-ledger-lines">{lines.map((line,index) => <section key={line.id} className="e-ledger-line e-picker-line" aria-label={`بند الفاتورة ${index+1}`}>
      <div className="e-picker-line-title"><strong>بند {index+1}</strong>{lines.length > 1 && <button className="e-icon-button" type="button" aria-label={`أزل البند ${index+1}`} onClick={() => { onEdit(); setLines((rows) => rows.filter((row) => row.id !== line.id)); }}><Trash2 size={17} aria-hidden="true" /></button>}</div>
      <CodeNamePicker kind="item" label={invoiceLineName('الصنف',line.id)} value={line.item} context={{warehouse, conflictLabel:'صنف في بند آخر'}}
        getConflict={(record) => lines.some((row) => row.id !== line.id && row.item === record.value)}
        onChange={(item) => edit(line.id,{item,price:priceFor(pickerRecords.item.find((record) => record.value === item),purchase)})}
        nextField={invoiceLineName('الكمية',line.id)} onScanExisting={scanExisting} onBarcodeMatch={() => { if (!line.qty) edit(line.id,{qty:'1'}); }} />
      <div className="e-picker-line-fields" onKeyDown={(event) => { if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229 || !(event.target instanceof HTMLInputElement) || event.target.name !== invoiceLineName('الكمية',line.id)) return; event.preventDefault(); if (!line.item) focusField(invoiceLineName('الصنف',line.id)); else if (index === lines.length-1) addLine(); else focusField(invoiceLineName('الصنف',lines[index+1].id)); }}>
        {([{key:'qty', label:'الكمية'},{key:'price', label:purchase ? 'تكلفة الوحدة' : 'سعر الوحدة'},{key:'discount', label:'الخصم'}] as const).map(({key,label}) => {
          const spec: FieldSpec = {label:invoiceLineName(label,line.id),type:'number',min:0};
          return <Field key={key} spec={spec} value={line[key]} set={(value) => edit(line.id,{[key]:value})} />;
        })}
      </div>
    </section>)}</div>
    <div className="e-actions"><Action icon={Plus} onClick={addLine}>أضف سطرًا</Action></div>
    <Notice><span aria-live="polite">إجمالي البنود · <Money value={total} digits={2} /></span></Notice>
  </div>;
}
