import { ArrowLeft, Barcode, Banknote, Grid2X2, Minus, Package, Plus, ReceiptText, Search, ShoppingBasket, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Item } from '../api';
import { money } from '../format';

export type CartLine = { item: Item; qty: number };
const filters = [
  { id: 'all', label: 'جميع الأصناف' }, { id: 'available', label: 'متوفر' }, { id: 'low', label: 'مخزون منخفض' }, { id: 'out', label: 'نفد المخزون' },
] as const;
type StockFilter = typeof filters[number]['id'];
const sampleNames = ['أرز بسمتي 5 كجم', 'سكر ناعم 1 كجم', 'زيت طبخ 1.5 لتر', 'دقيق أبيض 10 كجم', 'شاي أحمر 100 كيس', 'حليب مجفف 900 جم', 'معكرونة 400 جم', 'تونة معلبة', 'مياه معدنية 600 مل', 'عصير برتقال 1 لتر', 'صابون سائل', 'منظف أرضيات'];
const sampleImages = Object.fromEntries(sampleNames.map((name, i) => [name, String(1001 + i)]));

export function ProductImage({ item, eager = false }: { item: Item; eager?: boolean }) {
  const code = sampleImages[item.name_ar];
  return code && item.item_code === code
    ? <img src={`/catalog/${code}.webp`} width="288" height="286" alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
    : <Package size={34} strokeWidth={1.35} aria-hidden="true" />;
}

export function Catalog({ items, cart, add }: { items: Item[]; cart: Record<string, number>; add: (item: Item) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const input = useRef<HTMLInputElement>(null);
  const value = query.trim().toLocaleLowerCase('ar');
  const shown = items.filter((i) => {
    const stock = Number(i.stock);
    const matchesStock = filter === 'all' || (filter === 'available' && stock > 0) || (filter === 'low' && stock > 0 && stock <= 5) || (filter === 'out' && stock <= 0);
    return matchesStock && (!value || i.name_ar.toLocaleLowerCase('ar').includes(value) || i.item_code.toLowerCase().includes(value) || i.barcode?.includes(value));
  });
  function scan(event: FormEvent) {
    event.preventDefault();
    const hit = items.find((i) => value && (i.barcode === value || i.item_code.toLowerCase() === value));
    if (hit && Number(hit.stock) > (cart[hit.id] ?? 0)) { add(hit); setQuery(''); }
  }
  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
  }
  return <section className="catalog card" aria-labelledby="catalog-title">
    <div className="panel-heading"><div className="panel-title"><span className="panel-icon"><Grid2X2 size={20} aria-hidden="true" /></span><div><h2 id="catalog-title">كتالوج الأصناف</h2><p>اختر صنفًا لإضافته إلى السلة</p></div></div><span className="count-pill"><bdi>{money(items.length)}</bdi> صنفًا</span></div>
    <form className="catalog-search" role="search" onSubmit={scan}>
      <div className="search-field"><Search size={19} aria-hidden="true" /><input ref={input} name="product-search" type="search" inputMode="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKey} placeholder="ابحث باسم الصنف أو الباركود…" aria-label="بحث عن صنف" /></div>
      <button className="scan-btn" type="button" onClick={() => { input.current?.focus(); input.current?.select(); }} aria-label="إدخال الباركود" title="أدخل أو امسح الباركود ثم اضغط Enter"><Barcode size={21} aria-hidden="true" /></button>
    </form>
    <div className="filters" role="group" aria-label="تصفية الأصناف بحسب المخزون">{filters.map(({ id, label }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="sr-only" role="status">{money(shown.length)} نتيجة</div>
    {shown.length ? <ul className="items">
      {shown.map((item, index) => {
        const inCart = cart[item.id] ?? 0;
        const stock = Number(item.stock);
        const canAdd = stock > inCart;
        return <li key={item.id}><button className={`product ${inCart ? 'selected' : ''}`} type="button" disabled={!canAdd} onClick={() => add(item)} aria-label={canAdd ? `أضف ${item.name_ar}، ${money(item.price)} ريال يمني` : `${item.name_ar}، لا تتوفر كمية إضافية`}>
          <span className="product-media"><ProductImage item={item} eager={index < 8} /><span className={`stock-badge ${stock <= 0 ? 'sold-out' : stock <= 5 ? 'low-stock' : ''}`}><i />{stock <= 0 ? 'نفد' : stock <= 5 ? `متبقٍ ${money(stock)}` : `${money(stock)} متاح`}</span></span>
          <span className="product-body"><span className="product-name">{item.name_ar}</span><span className="product-bottom"><span className="product-price"><bdi>{money(item.price)}</bdi> <small>ر.ي</small></span><span className="product-add" aria-hidden="true">{inCart ? <bdi>{money(inCart)}</bdi> : <Plus size={16} />}</span></span></span>
        </button></li>;
      })}
    </ul> : <div className="catalog-empty"><span className="panel-icon"><Search size={24} aria-hidden="true" /></span><strong>لا توجد أصناف مطابقة</strong><p>جرّب اسمًا آخر أو غيّر فلتر المخزون.</p><button className="btn ghost" type="button" onClick={() => { setQuery(''); setFilter('all'); input.current?.focus(); }}>إعادة ضبط البحث</button></div>}
  </section>;
}

export function Basket({ lines, total, count, add, onCheckout, onClear, inSheet = false }: {
  lines: CartLine[]; total: number; count: number; add: (item: Item, change?: number) => void; onCheckout: () => void; onClear: () => void; inSheet?: boolean;
}) {
  const titleId = useId();
  return <section className={inSheet ? 'basket basket-in-sheet' : 'basket card'} aria-labelledby={inSheet ? undefined : titleId}>
    <div className="panel-heading"><div className="panel-title">{!inSheet && <span className="panel-icon"><ShoppingBasket size={21} aria-hidden="true" /></span>}<div>{!inSheet && <h2 id={titleId}>سلة المبيعات</h2>}<p role="status"><bdi>{money(count)}</bdi> وحدة في السلة</p></div></div>{count > 0 && <button className="soft-icon clear-basket" type="button" aria-label="إفراغ السلة" title="إفراغ السلة" onClick={onClear}><Trash2 size={17} aria-hidden="true" /></button>}</div>
    <div className="basket-content">
      {lines.length ? <ul className="basket-lines">{lines.map(({ item, qty }) => <li key={item.id}>
        <div className="cart-product"><span className="cart-photo"><ProductImage item={item} /></span><span><strong>{item.name_ar}</strong><small><bdi>{money(item.price)}</bdi> ر.ي للوحدة</small></span></div>
        <div className="cart-line-footer"><span className="stepper"><button type="button" aria-label={`إنقاص ${item.name_ar}`} onClick={() => add(item, -1)}><Minus size={14} aria-hidden="true" /></button><bdi>{money(qty)}</bdi><button type="button" aria-label={`زيادة ${item.name_ar}`} disabled={qty >= Number(item.stock)} onClick={() => add(item, 1)}><Plus size={14} aria-hidden="true" /></button></span><strong><bdi>{money(Number(item.price) * qty)}</bdi> <small>ر.ي</small></strong></div>
      </li>)}</ul> : <div className="basket-empty"><span className="panel-icon"><ReceiptText size={26} aria-hidden="true" /></span><strong>السلة فارغة</strong><p>أضف صنفًا من الكتالوج لبدء البيع.</p></div>}
    </div>
    <div className="basket-summary"><div className="summary-meta"><span>مجموع الأصناف</span><span><bdi>{money(total)}</bdi> ر.ي</span></div><div className="summary-total"><strong>الإجمالي</strong><strong><bdi>{money(total)}</bdi> <small>ر.ي</small></strong></div><button className="btn primary checkout-button" type="button" disabled={!count} onClick={onCheckout}><Banknote size={19} aria-hidden="true" /><span>متابعة إلى الدفع</span><ArrowLeft size={17} aria-hidden="true" /></button></div>
  </section>;
}
