
---

## 17. Addendum — Dual-entry picker: type the code OR the name (accounts, customers, suppliers, items)

### Purpose
Experienced users memorize account/party/item codes and want to type them directly; others prefer to search by name. Every field that selects an **account, customer, supplier, or item** must accept **either**, and always show **both** once chosen, so the user can verify what they picked.

### Where it applies
Receipt voucher, payment voucher, journal-entry lines, transfers, opening balances, purchase/sales invoice party and item lines, supplier payment, stock transfers/counts/adjustments, ledger and statement report filters, and any "pick an account/party/item" filter anywhere.

### Anatomy (one component: "Code + Name picker")
Two linked inputs in one row (RTL: code on the right, name on the left), each with its own visible label:
- **الرقم** (code) — narrow field (about 96–120 px), numeric keypad on mobile (`inputmode="numeric"`; alphanumeric codes fall back to the text keyboard), tabular figures.
- **الاسم** (name) — flexible width, searchable combobox.
- On phones (390 px) keep them side by side if both fit (code ≥ 96 px, name ≥ 44 px height); otherwise stack: code on top, name below. Never hide the code field.

### Behavior
1. **Type a code → name fills in.**
   - Lookup starts when the user stops typing (about 250 ms) or presses Enter/Tab.
   - **Exact match** → fill the name, mark the field valid, move focus to the next field (amount, quantity, etc.) on Enter only (never steal focus on Tab-less typing).
   - **Prefix matches** while typing → show a short dropdown of candidates ("1101 · الصندوق الرئيسي"); arrow keys + Enter select; tap selects on touch.
   - **No match** → inline error below the field, blameless: "لا يوجد حساب بالرقم 1199. جرّب الاسم أو اختر من القائمة." and offer a "ابحث بالاسم" action that focuses the name field with the typed text cleared.
2. **Type a name → code fills in.**
   - Search matches anywhere in the name (Arabic-normalized: ignore tashkeel, treat أ/إ/آ/ا and ة/ه and ى/ي as equal), plus matches on code and phone/barcode where relevant.
   - Results list rows: **code (bold, tabular) · name · small meta** (type, balance direction label, stock). Highlight the matched part.
   - Selecting a result fills **both** fields and shows the selected state.
3. **Selected state.** Both fields become read-only-looking with a distinct "picked" style (tinted background, check icon), plus a "غيّر" (change) button (44 px) that clears both and refocuses the code field. Pressing Backspace on an empty code field also clears.
4. **Context line under the picker** (secondary text), depending on type:
   - Account: type and path ("أصول › نقد وما في حكمه"); balance only if the user has the cash-balance permission.
   - Customer/Supplier: balance with direction label ("عليه 12,500 ر.ي" / "له 3,000 ر.ي") and credit-limit warning if relevant.
   - Item: unit, price, available stock in the chosen warehouse.
5. **Restrictions are explained, not silent.** Group (non-postable) accounts, inactive records, system-only accounts, or records the user is not permitted to use are **listed but disabled with a reason** ("حساب رئيسي — اختر حسابًا فرعيًا"). Typing the code of such a record shows the same message.
6. **Paste support.** Pasting a code or full name resolves the same way; pasting a multi-line list is not supported in single pickers.
7. **Recent and favorites.** On focus with empty input, show the last 5 used for this field type and any pinned favorites (e.g. cash, Jaib wallet) — a tap fills both fields.
8. **Barcode / scan (items only).** A scan icon button fills the code field from the camera or a Bluetooth scanner; an exact barcode match fills the row and increments quantity if the item is already on the document.
9. **Line editors (journal entries, invoices).** Keyboard flow per row: code → (auto-fill name) → amount/qty → Enter adds a new row with focus on its code field. On phones, rows are cards with the picker on top; "أضف سطرًا" is always reachable at the bottom.
10. **Duplicate detection.** In a document where the same account/item may only appear once (e.g. transfer from ≠ to), selecting a duplicate shows an inline error naming the conflict.

### States to design
Empty, focused-with-recents, typing with suggestions, loading (inline spinner after 100 ms; skeleton rows after 1 s), exact match filled, selected, not found, disabled-record-with-reason, permission-restricted, offline (use the locally cached list; show "القائمة محفوظة على الجهاز" if cache is older than 1 day), error loading list (retry action).

### Accessibility
- Pattern: ARIA combobox for each input (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`), listbox options with full text "1101، الصندوق الرئيسي".
- Announce the result of a code lookup politely ("تم اختيار الصندوق الرئيسي"), and announce "لا توجد نتائج" when empty.
- Visible labels for both fields; the picked state must not rely on color alone (check icon + text).
- All parts operable by keyboard: Tab between code/name/change; Arrow keys in lists; Esc closes suggestions without clearing; Enter selects.
- Targets ≥ 44 px; suggestion rows ≥ 48 px on touch.

### Data and performance notes for the designer
- The lists are small to medium (hundreds to a few thousand rows); assume the client keeps a cached list for instant local filtering and falls back to the server for large catalogs. Design for instant feedback (under 100 ms) with no spinner in the common case.
- Codes are unique per type within a company; they may be numeric (accounts like 1101, 110201) or short alphanumeric (customers C001, suppliers S001, items 1001).

### Deliverables for this addendum
1. The "Code + Name picker" component with every state above, at 390 and 1280 px, RTL.
2. Three in-context examples: voucher form (party), journal-entry line editor (account), invoice line (item with scan).
3. A short interaction spec covering keyboard flow and the not-found / restricted-record messages.
