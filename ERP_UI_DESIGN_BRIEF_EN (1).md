# UI/UX Design Brief — Arabic ERP & Accounting System (Mobile-first PWA)

## 0. Your role and what to deliver

You are a senior product designer. Design **every screen** of a commercial ERP/accounting system for small and mid-size traders (retail, wholesale, supermarkets) in Yemen/Gulf. The sales screen already exists; this brief covers the **whole product**: System Administration, Accounting / General Ledger, Inventory & Warehouses, Purchasing & Suppliers, Sales, Backup & Restore, and a Reports hub. Each module has **Setup (configuration)**, **Operations (daily work)**, and **Reports**.

Deliver, in this order:
1. A short design-direction statement and **design tokens** (color, type scale, spacing, radii, elevation, motion).
2. A **component library** (see §5) with all states (default, hover/pressed, focus, disabled-by-permission, loading, error, empty).
3. A **screen inventory** table: route, pattern, who can see it, primary action.
4. **High-fidelity screens** for every item in §6–§12 at **390 px (phone, primary)**, **768 px (tablet)** and **1280 px (desktop)**, in RTL Arabic with realistic Arabic data.
5. **Key flows** as annotated sequences (posting an entry, receiving purchase goods, stock count, backup → restore, closing a fiscal year).
6. A **handoff spec**: spacing, tokens used, states, edge cases, accessibility notes.

Use real-looking Arabic content and amounts (not lorem ipsum). Do not invent accounting rules; follow §4.

---

## 1. Product context

- Multi-tenant SaaS: one company = one tenant; multiple branches, warehouses, cashiers.
- Users work mainly on **phones in a browser (installable PWA)**; managers/accountants also use laptops. Sales (POS) must keep working **offline**; most other screens need a connection and must say so clearly.
- Backend (already built): PostgreSQL with strict double-entry accounting, row-level tenant isolation, REST API. Design only the front-end; every screen maps to an existing or straightforward API call.
- Base currency: Yemeni Rial, shown as **ر.ي**. Multi-currency exists in the data model (exchange rate on each line) but day-to-day UI is base currency; show foreign currency only where noted.
- Payment methods in Yemen: cash, mobile wallets (Jaib, Jawali, OneCash), bank (Al-Kuraimi), and credit (on account).

## 2. Hard constraints (non-negotiable)

**Language & layout**
- Arabic only, **RTL** everywhere. Mirror icons that imply direction (back, forward, chevrons, progress). Do not mirror logos, numbers, or media controls.
- **Latin digits (0-9)** for all numbers, dates and amounts; thousands separator `,`; decimals `.`; amounts right-to-left aligned consistently in tables (numbers aligned by decimal point, in a tabular-figures font). Negative numbers: leading minus, optionally red *plus* a minus sign (never color alone).
- Dates `YYYY-MM-DD` in tables, long form (“23 نوفمبر 2026”) in headings. Gregorian by default.
- Arabic UI typeface with good numerals and weights 400/500/600 only (max 3 weights; none above 600). Body 16 px, secondary 14 px, meta 12 px minimum. Line-height 1.5–1.6 body, 1.2 headings.

**Mobile & touch**
- Design **mobile-first at 390 px**; no page-level horizontal scroll at 375 or 1280. Tables may scroll horizontally *inside their own region*, but on phones prefer converting rows to **stacked cards/list rows**.
- Touch targets **≥ 44×44 px**. Primary actions reachable by thumb (bottom area). No hover-only functionality.
- Navigation: **bottom bar** with the 5 most important destinations + **side drawer** (☰) for everything else. On wide screens the bottom bar becomes a persistent right-hand rail (RTL) showing the same destinations grouped.

**Accessibility**
- WCAG 2.1 AA minimum: text contrast ≥ 4.5:1, UI components ≥ 3:1, visible focus ring on every interactive element, full keyboard operation, correct roles/labels, `aria-live` for toasts and totals. Never rely on color alone (status = color + text/icon).
- Respect `prefers-reduced-motion`. Motion only 100–300 ms, ease-out, transform/opacity only; no bounce.

**Forms (strict rules)**
- Every input has a **visible label** (placeholder only for format hints like `0.00`, `2026-11-23`).
- Validate **on first blur**, never while typing in a pristine field; error clears as soon as the user focuses/edits the field.
- **Submit buttons are never disabled**: clicking with invalid data scrolls to and focuses the first error and shows inline messages.
- Buttons use verb-first Arabic labels that name the object (“سجّل سند القبض”, “احفظ التغييرات”) — never “موافق / إرسال / متابعة”.
- Long forms autosave a **draft locally** and offer “استعدنا مسودتك · تجاهلها”.
- Smart defaults: pre-select last-used / inferred values (branch, warehouse, cash account, today’s date, base currency). No empty dropdown when a default can be inferred.

**Surfaces (when to use what)**
- Task < 10 s, 1–3 fields → **inline edit / bottom sheet / slide-over** (keeps context).
- Task ≥ 10 s or multi-step → **its own route** (no modal chains; never a modal on top of a modal).
- **Destructive or irreversible actions** → a confirmation dialog that **names the exact entity** (“ألغِ السند رقم 12؟”), uses a destructive verb button in red, **Cancel is focused by default**, Esc dismisses. Cancellations of financial documents also require a **reason** field.
- Financial documents are **never deleted** — only *reversed/cancelled* with a reason, producing a visible “ملغى” status and a linked reversal entry.

**Feedback**
- No loader under 100 ms; inline spinner on the triggering control for 100 ms–1 s; **structural skeletons** (matching real layout) beyond 1 s. No full-page centered spinners.
- Errors: blameless, ≤ 2 sentences, say what happened + what to do next. Technical failures offer “انسخ تفاصيل الخطأ”. Never show raw codes/stack traces.
- Every empty state has: what belongs here, why it matters, **one primary action**. Filtered-empty states add “امسح كل الفلاتر”. No cartoon illustrations of people; simple monochrome icons only.

**Visual taste**
- Calm, trustworthy, “paper ledger” feel: off-white canvas, white surfaces with **1 px hairline borders** (shadows ≤ 8 % alpha, rarely), one deep indigo/blue accent for actions and focus, semantic colors only for status (success/warning/danger/info). 60 % canvas / 30 % surfaces / 10 % accent.
- 8-pt spacing grid (4-pt for micro), consistent 8–12 px radii. Lists/tables always sit in a visible bordered panel with hairline row dividers.
- Banned: rainbow gradients, glassmorphism/blur, decorative icons inside inputs, pill-wrapping of plain metadata, stock “SaaS card” sameness, emoji as icons.

## 3. Roles and permissions (drives what each user sees)

Permission flags on a role: `can_post` (create financial documents), `can_reverse` (cancel documents), `can_view_cost` (see item cost/margins), `can_view_cash_balance` (see cash balances & reports), `can_give_discount`, `can_manage_users`. Typical roles: **Owner/Manager** (everything), **Accountant**, **Storekeeper**, **Purchasing officer**, **Cashier** (own shift only).

Design rules:
- **Hide** destinations a role can never use; **show but explain** (“يلزم صلاحية …”) when a single action inside an otherwise visible screen is not permitted. Cost/margin columns simply don’t render without `can_view_cost`.
- Cashiers see only their own documents; managers see all.
- Provide a **“Roles & permissions” matrix screen** (rows = capabilities, columns = roles) with clear toggles and a preview of “what this role will see”.

## 4. Accounting & inventory rules the UI must respect

- **Double entry**: every journal entry balances (total debit = total credit). Show a live “الفرق” indicator in entry forms; posting is blocked until the difference is 0.
- Document lifecycle: **Draft → Posted → (Reversed)**. Posted documents are immutable; changes = reversal + new document. Show status chips on every document. Posting date must fall in an **open fiscal period**; closed periods show a lock icon and explain why edits are blocked.
- Numbering is automatic, per document type and fiscal year (e.g. receipt vouchers 1, 2, 3 …). Show the number after posting, not an editable field.
- **Chart of accounts**: hierarchical (tree), codes like `1101`, with *group* (non-postable) vs *analytic* (postable) accounts; accounts flagged *system* (cash, receivables control, payables control, inventory, sales, COGS, etc.) cannot be edited/deleted. Account types: assets, liabilities, equity, revenue, expenses. Optional cost centers and branches on lines.
- **Parties** (customers & suppliers, or both) have a control account; **balance = debit − credit**. Customer positive = they owe us; supplier negative = we owe them. Always label direction in words (“عليه / له”) beside the number — never show a bare signed number without a label.
- **Inventory**: per-warehouse quantities, **moving-average cost**, units of measure with conversion, stock movements (receipt, issue, transfer, adjustment, count). A sale that exceeds stock is allowed but flagged (“قد يُعلَّق الإيصال”) and goes to a **conflicts / pending queue** for manager review.
- **Cash**: each cashier shift has a drawer account; **blind count** at shift close (cashier enters counted cash before seeing the expected figure; only roles with `can_view_cash_balance` see expected vs counted difference).
- **Reports** that reveal cash balances or profit require the matching permission.

## 5. Component library to design (all states)

App shell (top bar, bottom bar, drawer, wide rail, branch/user chip) · Page header with breadcrumb/back · Search field · Filter bar + filter sheet · Segmented control / choice chips · Text/Number/Money/Date/Select/Combobox (searchable picker for parties, items, accounts) · Barcode scan field · Money input with currency suffix · Quantity stepper · Checkbox/Switch/Radio · List row (1–3 lines + trailing amount + status) · Data table (sticky header, sortable, totals row, row actions) · Stat card / KPI · Status chip (Draft, Posted, Reversed, Pending, Overdue, Low stock, Locked) · Notice banners (info/warn/error/success) · Toast with action · Bottom sheet / slide-over / confirm dialog · Stepper/wizard (for multi-step flows) · Tabs · Tree view (chart of accounts) · Line-items editor (add/remove lines, totals footer) · Attachment picker · Date-range picker with presets · Pagination / infinite list · Skeletons · Empty states · Print/PDF preview layout (A4 and 80 mm receipt) · Audit-trail timeline item · Permission lock.

---

## 6. MODULE — System Administration (إدارة النظام)

**Setup**
- Company profile (name, logo, tax/commercial reg. numbers, address, phones, receipt footer text).
- Branches and warehouses (list + edit sheet; default warehouse per branch).
- Fiscal years & periods (create year, open/close period, lock indicator, **year-end closing wizard**: review → carry-forward → confirm with named confirmation).
- Currencies & exchange rates (base currency fixed; rate history).
- Numbering/sequences preview (read-mostly).
- Payment methods & their linked accounts (cash, Jaib, Jawali, OneCash, Al-Kuraimi, credit).
- Tax settings (off by default; design a clear “not enabled” state).
- Receipt/invoice print templates (A4 invoice, 80 mm thermal receipt) with live preview.
- Units of measure and conversions (can live under Inventory but linked here).

**Operations**
- **Users**: list (search, filter by role/status), create/edit sheet, activate/deactivate, reset password, force logout, assign branch & role. 2-factor (TOTP) status per user; admin can require 2FA.
- **Roles & permissions** matrix (see §3).
- **Active sessions & devices** (revoke).
- **Audit log**: filterable timeline (who/what/when/before→after, document link, device, IP). Read-only; export.
- **Conflicts / pending approvals inbox**: offline receipts held for stock shortage or credit-limit breach; approve/reject with reason.
- Notifications settings.

**Reports**: user activity, login attempts & failures, permission changes, documents cancelled (who/why), system health (last sync per device, pending offline queue size).

## 7. MODULE — Accounting / General Ledger (الحسابات والأستاذ العام)

**Setup**
- **Chart of accounts**: tree with expand/collapse, search, type badges, balance column (permission-gated), add child account sheet (code auto-suggested, type inherited, group vs analytic), edit, deactivate (never delete used accounts), mark default cash/bank accounts.
- Cost centers (tree/list). Opening balances wizard (accounts, customers, suppliers, stock) with a balance check.
- Expense categories (analytic accounts under expenses) quick-manage list.

**Operations**
- **Receipt voucher** (سند قبض) – party picker with balance shown, amount, method/account, reference, note.
- **Payment voucher** (سند صرف) – to supplier **or** expense account; overpayment shown as “دفعة مقدّمة” notice.
- **Journal entry** (قيد يومية) – line editor (account combobox, debit, credit, description, party, cost center), live balance difference, save draft / post, attachments. Entry detail shows source document link and a **reverse** action (reason required).
- **Transfers** between cash/bank/wallet accounts.
- **Vouchers list** (type filter, date range, status, cashier) with cancel action for permitted roles.
- Bank/wallet reconciliation (simple: tick posted items against statement; difference indicator).
- Period lock / unlock requests.

**Reports**
- **General ledger / account statement (الأستاذ العام)**: pick account + date range → opening balance, running balance per line, totals, drill-down to the source document, export PDF/Excel.
- **Trial balance** (with/without zero balances, by level), **Income statement**, **Balance sheet**, **Cash flow (simple)**.
- **Customer statements / aging** and **supplier statements / aging** (0-30, 31-60, 61-90, 90+).
- Daily cash/treasury report, expenses by category, journal register, cancelled documents.
All reports: date-range presets (today, week, month, quarter, year, custom), branch & cost-center filters, “as of” timestamp, export, print layout, and a mobile card/summary view with drill-down.

## 8. MODULE — Inventory & Warehouses (إدارة المخازن)

**Setup**
- **Items**: list (search by name/code/barcode, filter by group/stock status), create/edit (names, code auto-generated by group, barcode(s), group, base unit + alternate units with factors, sale/purchase prices, min/reorder level, active, sellable/purchasable, image), price history. Cost visible only with `can_view_cost`.
- Item groups (tree/list), units of measure, warehouses (per branch), reorder rules.
- Barcode label printing sheet.

**Operations**
- **Stock overview** per warehouse (qty on hand, value, low-stock chips, out-of-stock).
- **Goods receipt** (direct, or against a purchase invoice).
- **Stock issue / write-off** with reason (damaged, expired, sample).
- **Warehouse transfer** (from → to, lines, in-transit → received).
- **Stock count (الجرد)**: create count sheet by warehouse/group → count on phone with barcode scan and quantity entry (works well one-handed) → variance review (system vs counted, value impact) → post adjustment with named confirmation.
- **Adjustments** (manual, reason + approver).
- **Item card / movement history** (each in/out with document link and running quantity & average cost).

**Reports**: stock valuation, stock on hand by warehouse, movement report, slow/non-moving, fast movers, low-stock/reorder list, expiry (if tracked), count variance history, profit by item (permission-gated).

## 9. MODULE — Purchasing & Suppliers (المشتريات والموردون)

**Setup**: suppliers list/detail (contact, phone, payment terms, credit limit, opening balance, notes, linked account), supplier groups, default purchase accounts/warehouse.

**Operations**
- **Purchase order** (optional): draft → sent → partially received → closed.
- **Purchase invoice** (فاتورة مشتريات): supplier, date, warehouse, lines (item combobox + barcode, unit, qty, cost, discount), totals, payment now (cash/wallet/bank) or on account, attachments (photo of the paper invoice), post. Show effect preview: “يزيد المخزون · يزيد المستحق للمورد”.
- **Purchase return** (against an invoice).
- **Supplier payment** (سداد الموردين) – pick supplier, see outstanding invoices, allocate payment across them (auto-allocate oldest first, manual override), advance payment notice.
- **Supplier statement** and invoice reversal (reason).
- Price comparison across suppliers for an item.

**Reports**: purchases by supplier / item / period, payables aging, supplier statement, purchase returns, price variance, top suppliers, upcoming dues.

## 10. MODULE — Sales (إدارة المبيعات)

(The POS quick-sale screen already exists; design its **back-office** and keep the quick-sale consistent.)

**Quick sale (reference, already built)**: search + category chips, 2-column item tiles, best-sellers first, cart bar with “ادفع نقدًا” one-tap and “راجع السلة” for split/credit payment, instant new sale, offline-safe queue.

**Setup**: customers list/detail (credit limit, balance, terms, price list), customer groups, price lists, discount rules (with `can_give_discount`), POS settings (default payment method, receipt printing, shift rules), payment methods.

**Operations**
- **Shifts**: open (opening float), live summary, **blind-count close**, difference result (permission-gated), shift history.
- **Invoices list & detail** (filters, status, cashier), print/share receipt (PDF/WhatsApp), **return** (partial lines) and **cancel** (reason).
- **Credit sales & collections**: receipt voucher against customer, outstanding invoices, allocation.
- **Quotations** (optional): create, convert to invoice.
- **Held/pending receipts & conflicts** inbox.
- **Customer statement** and reminders.

**Reports**: daily/period sales, net sales (after returns), by cashier / item / category / customer / payment method, top & slow items, sales vs. previous period, receivables aging, shift reports, discounts given, gross profit (permission-gated).

## 11. MODULE — Backup & Restore (النسخ الاحتياطي والاستعادة)

**Setup**: backup schedule (daily/weekly, time, retention count), storage destination (local download, cloud), encryption passphrase (explain it cannot be recovered), who is notified on failure.

**Operations**
- **Backup now** (progress with skeleton → success with size, timestamp, checksum).
- **Backups list**: date, size, type (auto/manual), status, created by; actions download / verify / restore / delete (named confirmation).
- **Restore wizard** (own route, 4 steps): choose backup → **preview what will be overwritten** (date of backup, number of documents/entries that will be lost since) → type-to-confirm the company name and enter passphrase → progress with “do not close this page” and result. Make the danger unmistakable but calm: red notice, explicit consequences, option to **take a safety backup first (default ON)**.
- Export data (Excel/CSV per module) and import wizards (items, customers, suppliers, opening balances) with a column-mapping step and an error report before committing.
- Restore history & audit entries.

**Reports**: backup success/failure log, last successful backup indicator shown on the Admin home and as a warning chip if older than the schedule.

## 12. Reports hub (التقارير)

One entry in the bottom bar. Landing screen = **overview dashboard** (today’s net sales, cash in/out, receivables, payables, low-stock count, top items) followed by **report catalog grouped by module** (Sales, Purchases, Inventory, Accounting, Admin) with search and “recent/favorites”. Every report uses the same template: header (title, “as of”), filter bar, summary cards, main table/chart, export/print. Charts: simple bar/line only, accessible (labelled values, patterns not just color, text alternative/table toggle).

## 13. Cross-cutting screens

Login (company code, username, password) · Two-factor entry · Forgot/reset · First-run setup wizard (company → branch → warehouse → fiscal year → chart template → cash accounts → first user) · Account/profile (change password, enable 2FA, sessions) · Notifications center · Global search (items, parties, documents by number) · Offline/online status bar and **pending sync queue** screen · Global empty/error/403/404/maintenance pages · Print/PDF layouts · Language/region (Arabic default; leave an English toggle placeholder out of scope).

## 14. Navigation proposal (refine if you have better)

- **Bottom bar (≤ 5)**: سند قبض · سند صرف · المبيعات (center, primary) · سداد الموردين · التقارير. Items hidden if role lacks access (cashier: no reports).
- **Drawer** grouped: *المبيعات* · *المشتريات والموردون* · *المخازن* · *الحسابات والأستاذ العام* · *التقارير* · *النسخ الاحتياطي* · *إدارة النظام* · *حسابي / تسجيل الخروج*. Each group expands to **Operations / Setup / Reports** sub-sections in that order.
- Each module has a **module home**: today’s key numbers, 3–5 frequent actions, pending items needing attention, and links to Setup and Reports.

## 15. Page patterns to use (pick exactly one per screen)

List/Index · Detail/Record · Form · Dashboard/Overview · Settings/Configuration · Analytics/Reporting · Inbox/Work queue · Wizard (multi-step form). Name the pattern on each screen in the inventory table. Use the same skeleton for loading/empty/error inside that pattern.

## 16. Acceptance checklist (I will review against this)

- [ ] Every screen exists at 390 / 768 / 1280 and is RTL-correct.
- [ ] No page-level horizontal overflow; targets ≥ 44 px; focus visible.
- [ ] Every list has search/filter, a visible panel with hairlines, loading skeleton, empty, and error states.
- [ ] Every form follows the validation rules in §2; submit never disabled.
- [ ] Every destructive/financial-reversal action has the named confirmation + reason.
- [ ] Permission-gated elements show the specified behavior (hidden vs explained).
- [ ] Posted/draft/reversed statuses are consistent and not color-only.
- [ ] Money formatting, balance direction labels (“عليه/له”) and date formats are consistent.
- [ ] Backup/Restore flows make consequences explicit and require typed confirmation.
- [ ] Reports share one template, include export/print, and have a mobile summary view.
- [ ] Contrast ≥ 4.5:1 verified; motion respects reduced-motion.

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

---

## 18. Build directive — implement all screens as working front-end code

**Do not stop at mockups or static images. Build every screen in this brief as a working, navigable front-end**, covering all modules (System Administration, Accounting/General Ledger, Inventory, Purchasing & Suppliers, Sales, Backup & Restore, Reports hub, cross-cutting screens) and the "Code + Name picker" from §17.

### Technology (match the existing app so the code can be dropped in)
- **Vite + React 18 + TypeScript**, plain CSS with CSS variables (no CSS-in-JS, no UI framework that fights RTL). Hash-based routing (`#/receipt`, `#/reports`, …) with one route per screen.
- RTL by default (`<html dir="rtl" lang="ar">`), logical CSS properties (`margin-inline`, `inset-inline-start`), Latin digits, self-hosted Arabic font (woff2).
- Reusable kit first (`ui/kit`, `ui/overlay`, `ui/Icon`): Button (never disabled), Input/Select/Combobox/CodeNamePicker, Money input, Quantity stepper, Status chip, Notice, Empty, ErrorBox, Loading/Skeleton, PageHead, Sheet/Drawer/Confirm dialog, Toast, DataTable (card-list on phones), Tree view, Line-items editor, Wizard, Tabs. Screens compose these only; no one-off styling.
- A small `api.ts` layer with typed functions per endpoint. **Until the real API is connected, back each function with realistic in-memory mock data (Arabic names, YER amounts)** behind a single `USE_MOCK` switch, with simulated latency (150–600 ms) and a few simulated failures so loading, empty, error and offline states can be seen.
- Permissions: a `can(flag)` helper reading the current user's flags (`can_post`, `can_reverse`, `can_view_cost`, `can_view_cash_balance`, `can_give_discount`, `can_manage_users`). Include a **dev role switcher** (Owner, Accountant, Storekeeper, Purchasing, Cashier) so reviewers can see each role's navigation and gated elements.

### Scope: every screen, no placeholders
For each module build: **module home → setup screens → operation screens → reports**, exactly as listed in §6–§13. Each screen must include its loading skeleton, empty state, error state, validation behavior and (where relevant) permission-restricted state. Forms must really validate, line editors must really calculate totals and balance differences, trees must expand/collapse, filters must really filter the mock data, report tables must total correctly, wizards must really step through (restore and year-end closing require the typed confirmation).
Include: login + two-factor, first-run setup wizard, notifications center, global search, offline/pending-sync screen, 403/404/maintenance pages, A4 invoice and 80 mm receipt print layouts (`@media print`).

### Responsive and quality bar
- Test at **390, 768, 1280 px**. Phone: bottom bar (5 items) + drawer; wide: right-hand rail. No page-level horizontal scroll; targets ≥ 44 px; visible focus; keyboard operable; contrast ≥ 4.5:1; reduced-motion honored.
- All rules in §2, §3, §4 and §17 apply to the code, not just to the visuals.
- Run a TypeScript check and a production build with no errors or warnings before delivering, and include a short checklist showing each acceptance item in §16 as pass/fail.

### Deliverables
1. The full project (source, `package.json`, README with run/build steps and the screen→route table).
2. A `SCREENS.md` listing every route, its pattern, required permission, and the mock-data source.
3. A `COMPONENTS.md` documenting each reusable component, props and states.
4. Screenshots of each screen at 390 and 1280 px (phone + desktop) in `/screenshots`.
5. A list of any behavior you could not implement and why.

Deliver in stages so progress can be reviewed early: (1) tokens + kit + app shell + navigation + permissions, (2) Accounting + Sales back-office, (3) Inventory + Purchasing, (4) System Administration + Backup/Restore, (5) Reports hub + cross-cutting screens + print layouts.
