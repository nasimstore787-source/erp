import { useEffect, useEffectEvent, useId, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { Barcode, Camera, Check, CircleAlert, Clock3, LoaderCircle, Search, Star, WifiOff } from 'lucide-react';
import { canSeeCash, exactPicker, itemWarehouse, matchesPicker, normalizePicker, pickerNouns, pickerRecords, restrictionFor, stockAt, type PickerContext, type PickerKind, type PickerRecord } from './pickerCatalog';
import { PickerScanner } from './PickerScanner';

type Side = 'code' | 'name';
export type CatalogState = 'ready' | 'loading' | 'error' | 'offline';
const recentCodes = new Map<PickerKind,string[]>();
const number = new Intl.NumberFormat('en-US');
const money = (value: number) => `${number.format(value)} ر.ي`;

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const chars = Array.from(text);
  const ranges: number[][] = [];
  let normalized = '';
  chars.forEach((char,index) => {
    const value = /\s/.test(char) ? char : normalizePicker(char);
    if (!value && ranges.length) ranges[ranges.length-1][1] = index + 1;
    for (const key of value) { normalized += key; ranges.push([index,index+1]); }
  });
  const start = normalized.indexOf(query);
  if (start < 0) return text;
  const [from] = ranges[start];
  const [,to] = ranges[start + query.length - 1];
  return <>{chars.slice(0,from).join('')}<mark>{chars.slice(from,to).join('')}</mark>{chars.slice(to).join('')}</>;
}

function RecordContext({ record, kind, context }: { record: PickerRecord; kind: PickerKind; context: PickerContext }) {
  if (kind === 'item') return <>{record.meta} · <bdi>{money(record.price ?? 0)}</bdi>{!context.hideStock && <> · المتاح في {itemWarehouse(context.warehouse)}: <bdi>{number.format(stockAt(record,context.warehouse) ?? 0)}</bdi></>}</>;
  if (kind === 'account') return <>{record.meta}{canSeeCash(context.role) && record.balance !== undefined && <> · الرصيد <bdi>{money(record.balance)}</bdi></>}</>;
  return <>{record.direction} <bdi>{money(record.balance ?? 0)}</bdi>{record.limit !== undefined && (record.balance ?? 0) >= record.limit && <span className="e-picker-credit"><CircleAlert size={14} aria-hidden="true" /> تجاوز حد الائتمان</span>}</>;
}

type Props = {
  kind: PickerKind;
  label: string;
  value: string;
  onChange: (value: string) => void;
  context?: PickerContext;
  options?: string[];
  optional?: boolean;
  error?: string;
  nextField?: string;
  getNextField?: (record: PickerRecord) => string | undefined;
  catalogState?: CatalogState;
  cacheAgeDays?: number;
  onRetry?: () => void;
  onBarcodeMatch?: (record: PickerRecord) => void;
  onScanExisting?: (record: PickerRecord) => boolean;
  getConflict?: (record: PickerRecord) => boolean;
  demo?: { query: string; side: Side; focus: boolean };
};

export function CodeNamePicker({ kind, label, value, onChange, context = {}, options, optional, error, nextField, getNextField, catalogState = 'ready', cacheAgeDays = 0, onRetry, onBarcodeMatch, onScanExisting, getConflict, demo }: Props) {
  const id = useId();
  const root = useRef<HTMLFieldSetElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const records = pickerRecords[kind].filter((record) => !options || options.includes(record.value));
  const picked = records.find((record) => record.value === value);
  const [side, setSide] = useState<Side | null>(demo?.focus ? demo.side : null);
  const [draft, setDraft] = useState(demo?.query ?? '');
  const [draftSide, setDraftSide] = useState<Side>(demo?.side ?? 'code');
  const [barcode, setBarcode] = useState('');
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [camera, setCamera] = useState(false);
  const [networkOffline, setNetworkOffline] = useState(!navigator.onLine);
  const [delay, setDelay] = useState(0);
  const query = side === draftSide ? normalizePicker(draft) : '';
  const offline = networkOffline || catalogState === 'offline';
  const loading = !offline && catalogState === 'loading';
  const failed = !offline && catalogState === 'error';
  const recent = recentCodes.get(kind) ?? [];
  const suggestions = !side || picked || loading || failed ? [] : query
    ? records.filter((record) => matchesPicker(record,query,side)).slice(0,7)
    : records.filter((record) => record.favorite || recent.includes(record.code)).sort((a,b) => Number(!!b.favorite)-Number(!!a.favorite) || recent.indexOf(a.code)-recent.indexOf(b.code));
  const open = !!side && !picked && !failed && !(message && side === draftSide);
  const reasonFor = (record: PickerRecord) => restrictionFor(record,getConflict?.(record) ? {...context,blockedValue:record.value} : context);
  const issue = message || (picked ? reasonFor(picked) : '') || error;
  const listId = `${id}-list`;

  useEffect(() => {
    const update = () => setNetworkOffline(!navigator.onLine);
    window.addEventListener('online',update); window.addEventListener('offline',update);
    return () => { window.removeEventListener('online',update); window.removeEventListener('offline',update); };
  }, []);
  useEffect(() => {
    if (!loading) return;
    const spinner = window.setTimeout(() => setDelay(1),100);
    const skeleton = window.setTimeout(() => setDelay(2),1000);
    return () => { window.clearTimeout(spinner); window.clearTimeout(skeleton); setDelay(0); };
  }, [loading]);

  function focusNext(target = nextField) {
    const form = root.current?.closest('form');
    if (target) {
      const input = (form ?? document).querySelector<HTMLElement>(`[name="${CSS.escape(target)}"]`);
      if (input) { input.focus(); return; }
    }
    const picker = root.current;
    if (!form || !picker) return;
    const next = Array.from(form.elements).find((element) => element instanceof HTMLElement && !picker.contains(element) && (picker.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) && element.matches('input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled)') && element.getClientRects().length);
    if (next instanceof HTMLElement) next.focus();
  }

  function select(record: PickerRecord, advance = false, fromBarcode = false) {
    if (fromBarcode && !restrictionFor(record,{...context,blockedValue:undefined}) && onScanExisting?.(record)) {
      setDraft(''); setMessage(''); setSide(null); setActive(-1);
      setAnnouncement(`زِيدت كمية ${record.name}`); return true;
    }
    const restriction = reasonFor(record);
    if (restriction) { setMessage(restriction); setAnnouncement(restriction); setSide(null); setActive(-1); return false; }
    recentCodes.set(kind,[record.code,...recent.filter((code) => code !== record.code)].slice(0,5));
    onChange(record.value); setDraft(''); setMessage(''); setSide(null); setActive(-1);
    setAnnouncement(`تم اختيار ${record.name}`);
    if (fromBarcode) onBarcodeMatch?.(record);
    if (advance) requestAnimationFrame(() => focusNext(getNextField?.(record) ?? nextField));
    return true;
  }

  function notFound(field: Side, raw: string) {
    setMessage(field === 'code' ? `لا يوجد ${pickerNouns[kind]} بالرقم ${raw.trim()}. جرّب الاسم أو اختر من القائمة.` : 'لا توجد نتائج مطابقة. جرّب رقمًا أو اسمًا آخر.');
    setAnnouncement('لا توجد نتائج');
  }

  function lookup(raw: string, field: Side, advance = false, final = false) {
    const normalized = normalizePicker(raw);
    if (!normalized || loading || failed) return;
    const match = exactPicker(records,normalized,field);
    if (match) { select(match,advance,kind === 'item' && normalizePicker(match.barcode ?? '') === normalized); return; }
    if (final || !records.some((record) => matchesPicker(record,normalized,field))) notFound(field,raw);
  }

  const delayedLookup = useEffectEvent(lookup);
  useEffect(() => {
    if (picked || !side || !query || loading || failed) return;
    const timer = window.setTimeout(() => delayedLookup(draft,side),250);
    return () => window.clearTimeout(timer);
  }, [draft, side, query, picked, loading, failed]);

  function edit(text: string, field: Side) {
    setSide(field); setDraftSide(field); setDraft(text); setMessage(''); setAnnouncement(''); setActive(-1);
  }
  function clear(field: Side = 'code') {
    if (value) onChange('');
    edit('',field); setBarcode(''); setBarcodeOpen(false);
    const input = field === 'code' ? codeRef : nameRef;
    input.current?.focus();
    requestAnimationFrame(() => input.current?.focus());
  }
  function onFocus(field: Side) {
    if (picked) return;
    if (side !== field) { setSide(field); setActive(-1); }
  }
  function onBlur(event: FocusEvent<HTMLFieldSetElement>) {
    if (root.current?.contains(event.relatedTarget)) return;
    if (side === draftSide && !picked && !message) lookup(draft,side,false,true);
    setSide(null); setActive(-1);
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>, field: Side) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); setSide(null); setActive(-1); return; }
    if (event.key === 'Backspace' && field === 'code' && !event.currentTarget.value) { clear(); return; }
    if (event.key === 'Tab' && side === field && !picked) { if (draftSide === field) lookup(draft,field,false,true); setSide(null); setActive(-1); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (picked) { if (!issue) focusNext(); return; }
      if (suggestions[active]) { select(suggestions[active],true); return; }
      if (draftSide === field) lookup(draft,field,true,true);
      return;
    }
    if (!picked && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setSide(field);
      if (!suggestions.length) return;
      const index = active < 0 ? (event.key === 'ArrowDown' ? 0 : suggestions.length-1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      setActive(index);
      requestAnimationFrame(() => document.getElementById(`${id}-option-${index}`)?.scrollIntoView({block:'nearest'}));
    }
  }
  function paste(event: ClipboardEvent<HTMLInputElement>, field: Side) {
    if (picked) return;
    const text = event.clipboardData.getData('text').trim();
    event.preventDefault();
    if (/[\r\n]/.test(text)) { setMessage('الصق رقمًا أو اسمًا واحدًا فقط.'); return; }
    const target = exactPicker(records,normalizePicker(text),'name') && !exactPicker(records,normalizePicker(text),'code') ? 'name' : field;
    if (target !== field) nameRef.current?.focus();
    edit(text,target);
    lookup(text,target);
  }
  function scan(raw: string) {
    const match = exactPicker(records,normalizePicker(raw),'code');
    if (!match) {
      if (picked) onChange('');
      setBarcodeOpen(false); edit(raw,'code'); notFound('code',raw); codeRef.current?.focus();
    } else if (select(match,true,true)) { setBarcodeOpen(false); setBarcode(''); }
    else { setBarcodeOpen(true); setBarcode(raw); }
  }

  const describedBy = [picked && `${id}-context`, issue && `${id}-error`, offline && `${id}-offline`].filter(Boolean).join(' ') || undefined;
  function input(field: Side) {
    const isCode = field === 'code';
    const expanded = open && side === field;
    return <input id={`${id}-${field}`} name={isCode ? label : undefined} ref={isCode ? codeRef : nameRef} role="combobox" type="text"
      aria-label={`${isCode ? 'الرقم' : 'الاسم'} — ${label}`} aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-autocomplete="list"
      aria-activedescendant={expanded && suggestions[active] ? `${id}-option-${active}` : undefined} aria-describedby={describedBy} aria-required={!optional || undefined}
      aria-invalid={!!issue || undefined} readOnly={!!picked} autoFocus={demo?.focus && demo.side === field} autoComplete="off" dir={isCode ? 'ltr' : 'auto'} spellCheck={false}
      inputMode={isCode && (kind === 'account' || kind === 'item') ? 'numeric' : 'text'} placeholder={isCode ? ({account:'1101',customer:'C001',supplier:'S001',item:'1001',party:'C001'})[kind] : 'ابحث بالاسم'}
      value={picked ? (isCode ? picked.code : picked.name) : draftSide === field ? draft : ''}
      onFocus={() => onFocus(field)} onClick={() => onFocus(field)} onChange={(event) => edit(event.target.value,field)} onKeyDown={(event) => onKey(event,field)} onPaste={(event) => paste(event,field)} />;
  }

  return <fieldset className="e-picker" dir="rtl" ref={root} onBlur={onBlur}>
    <legend>{label}{optional && <small> · اختياري</small>}</legend>
    <div className="e-picker-anchor">
      <div className={`e-picker-inputs${picked ? ' picked' : ''}`}>
        <div className="e-picker-code"><label htmlFor={`${id}-code`}>الرقم</label>{input('code')}</div>
        <div className="e-picker-name"><label htmlFor={`${id}-name`}>الاسم</label>{input('name')}</div>
      </div>
      {open && <div className="e-picker-popover">
        <div className="e-picker-listhead">{query ? <Search size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}{query ? 'نتائج البحث' : 'المفضّلة والمستخدمة مؤخرًا'}{loading && delay === 1 && <><LoaderCircle className="e-picker-spin" size={16} aria-hidden="true" /><span className="sr-only" role="status">جارٍ تحميل القائمة</span></>}</div>
        {loading && delay === 2 && <div className="e-skeleton" role="status" aria-label="جارٍ تحميل القائمة"><i/><i/><i/></div>}
        <ul id={listId} className="e-picker-list" role="listbox" aria-label={`اقتراحات ${label}`} aria-busy={loading || undefined}>
          {suggestions.map((record,index) => { const reason = reasonFor(record); return <li key={record.code} id={`${id}-option-${index}`} role="option" aria-label={`${record.code}، ${record.name}${reason ? `، ${reason}` : ''}`} aria-selected={index === active} aria-disabled={!!reason || undefined} onPointerDown={(event) => event.preventDefault()} onClick={() => select(record)}>
            <span className="e-picker-result"><bdi dir="ltr"><Highlight text={record.code} query={query} /></bdi><span aria-hidden="true">·</span><strong><Highlight text={record.name} query={query} /></strong>{record.favorite && <Star size={14} aria-hidden="true" />}</span>
            <small>{reason || (kind === 'item' && !context.hideStock ? `${record.meta} · ${stockAt(record,context.warehouse)} متاح` : record.direction ? `${record.meta} · ${record.direction} رصيد` : record.meta)}{query && [record.barcode,record.phone].filter((extra): extra is string => !!extra && normalizePicker(extra).includes(query)).map((extra) => <span key={extra}> · <bdi dir="ltr"><Highlight text={extra} query={query} /></bdi></span>)}</small>
          </li>; })}
        </ul>
        {!suggestions.length && !loading && <p className="e-picker-list-empty">{query ? 'لا توجد نتائج' : 'ستظهر هنا الاختيارات الأخيرة. اكتب رقمًا أو اسمًا للبحث.'}</p>}
      </div>}
    </div>
    {picked && <div className="e-picker-selected"><span><Check size={15} aria-hidden="true" /> تم الاختيار</span><button type="button" className="e-text-action" onClick={() => clear()}>غيّر<span className="sr-only"> {label}</span></button></div>}
    {picked && <p className="e-picker-context" id={`${id}-context`}><RecordContext record={picked} kind={kind} context={context} /></p>}
    {issue && <div className="e-picker-error" id={`${id}-error`}><p><CircleAlert size={15} aria-hidden="true" />{issue}</p>{!picked && <button type="button" className="e-text-action" onClick={() => clear('name')}>ابحث بالاسم</button>}</div>}
    {offline && <p className="e-picker-offline" id={`${id}-offline`}><WifiOff size={15} aria-hidden="true" />{cacheAgeDays > 1 ? 'القائمة محفوظة على الجهاز · آخر تحديث منذ أكثر من يوم' : 'دون اتصال · تُعرض القائمة المتاحة على الجهاز'}</p>}
    {failed && <div className="e-picker-error" role="status"><p><CircleAlert size={15} aria-hidden="true" /> تعذّر تحميل القائمة.</p>{onRetry && <button type="button" className="e-text-action" onClick={() => { onRetry(); setSide('code'); codeRef.current?.focus(); }}>أعد المحاولة</button>}</div>}
    {kind === 'item' && <><div className="e-picker-scan-actions"><button className="e-text-action" type="button" aria-expanded={barcodeOpen} aria-controls={barcodeOpen ? `${id}-barcode` : undefined} onClick={() => { setBarcodeOpen(!barcodeOpen); if (!barcodeOpen) requestAnimationFrame(() => document.getElementById(`${id}-barcode`)?.focus()); }}><Barcode size={18} aria-hidden="true" /> إدخال أو مسح باركود</button>{barcodeOpen && <button className="e-icon-button" type="button" aria-label="مسح بالكاميرا" onClick={() => setCamera(true)}><Camera size={19} aria-hidden="true" /></button>}</div>{barcodeOpen && <div className="e-picker-barcode"><label htmlFor={`${id}-barcode`}>الباركود</label><input id={`${id}-barcode`} dir="ltr" inputMode="numeric" autoComplete="off" value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); scan(barcode); } }} placeholder="6281001" /><button type="button" className="e-button secondary" onClick={() => scan(barcode)}>طبّق</button></div>}{camera && <PickerScanner onScan={(code) => { setCamera(false); requestAnimationFrame(() => scan(code)); }} onClose={() => { setCamera(false); requestAnimationFrame(() => document.getElementById(`${id}-barcode`)?.focus()); }} />}</>}
    <span className="sr-only" role="status">{announcement}</span>
  </fieldset>;
}
