# Final Architectural Audit & End-to-End Completion Blueprint
**Project:** Arabic RTL Multi-Tenant ERP & Accounting System (Mobile-First PWA)  
**Target Stack:** PostgreSQL 16+ (Accounting Kernel) · Fastify 5 + TypeScript + `pg` + Zod (API) · Vite 8 + React 19 + TypeScript + `vite-plugin-pwa` + IndexedDB (Web PWA)  
**Audit Basis:** Direct inspection of `project (3).zip` (110 source files), `ARCHITECTURE_AND_ROADMAP_AR.md`, `ERP_UI_DESIGN_BRIEF_EN.md`, and `ERP_UI_ADDENDUM_CODE_NAME_PICKER_EN.md`.

---

## 1. Executive Codebase Audit (Ground Truth vs. Existing Documentation)

Direct inspection of the repository reveals a **production-grade PostgreSQL accounting kernel** and a **working offline-first POS vertical slice**, alongside **three critical discrepancies** between the repository state and `ARCHITECTURE_AND_ROADMAP_AR.md` that must be resolved before scaling out the remaining screens.

### 1.1 Verified Ground Truth Matrix

| Layer | Actually Built & Verified in `project (3).zip` | Discrepancies & Gaps Found During Audit |
|---|---|---|
| **Repository Root** | Contains `db/`, `api/`, `web/`, `README_APP.md` | **Dead Next.js 16 Scaffold at Root:** `package.json`, `app/page.tsx`, `components/ui/button.tsx`, `next.config.mjs`, and `pnpm-lock.yaml` are unused boilerplate rendering a placeholder SVG. This creates severe tooling/AI confusion and must be removed immediately. |
| **Database (`db/`)** | **34 tables**, **2 views** (`v_account_statement`, `v_trial_balance`), **36 PL/pgSQL functions** (`post_sales_invoice`, `submit_offline_sale`, `reverse_sales_invoice`, `post_journal_entry`, `post_voucher`, `reverse_voucher`, `post_purchase_invoice`, `reverse_purchase_invoice`, `post_stock_document`, `open_shift`, `fn_shift_report`, `close_shift`, `close_fiscal_year`, `reopen_fiscal_year`, `resolve_sync_conflict`, `approve_credit_override`, `fn_seed_tenant_accounting`, `fn_auth_lookup`) + `02_auth_hardening.sql` (TOTP 2FA, `login_throttle`, token revocation) + least-privilege `erp_api` role (no `BYPASSRLS`). | Missing tables for full ERP scope: `payment_allocations`, `stock_count_sessions` / `stock_count_lines`, `price_lists` / `discount_rules`, `purchase_orders`, `quotations`, `bank_reconciliations`, `period_lock_requests`, `notifications`, `backup_jobs` / `backup_runs`, `print_templates`. Missing reporting views (`v_income_statement`, `v_balance_sheet`, `v_aging_receivables`, `v_aging_payables`, `v_stock_valuation`, `v_item_card`). |
| **Backend API (`api/`)** | Fastify 5 + `@fastify/jwt` + `helmet` + `rate-limit` + `zod` + `withTenant()` RLS wrapper + live `token_version` & `is_active` check + forced 2FA gate + **31 real HTTP integration tests** (`api/test/`). Active route plugins: `auth`, `pos`, `shifts`, `sales`, `conflicts`, `invoices`. | **Doc Mismatch:** `ARCHITECTURE_AND_ROADMAP_AR.md` lists Users/Roles, Vouchers, and Summary Reports as built in `api/`, but `api/src/app.ts` does **not** mount any `users`, `roles`, `vouchers`, or `reports` routes yet. Also, `Session` in `api/src/app.ts` only carries `{ post, reverse, cashview }`—it omits `viewCost`, `giveDiscount`, and `manageUsers`. |
| **Frontend (`web/`)** | Working offline-first PWA (`App.tsx`, `Workstation.tsx`, `idb.ts`, `offline.ts`, `screens/{Login,OpenShift,Pos,PosPanels,Shift,Invoices,Conflicts,Account}.tsx`) + a rich **mock design-mode ERP prototype** under `web/src/erp/` (`CodeNamePicker.tsx`, `PickerScanner.tsx`, `InvoiceLines.tsx`, `Confirm.tsx`, `Dashboard.tsx`, `Flows.tsx`, `Records.tsx`, `Screens.tsx`, `Workspace.tsx`, `catalog.ts`, `fixtures.ts`, `ui.tsx`, `erp.css`). | **Doc Mismatch:** `web/src/ui/kit` and `web/src/ui/overlay` do **not** exist yet, nor do live Vouchers/Admin/Reports screens. The app uses two separate UI worlds (`Workstation.tsx` + `styles.css` for live POS vs. `web/src/erp/*` + `erp.css` for mock screens) and tab-state routing instead of hash-based screen routing. |

### 1.2 Risk Assessment Summary
1. **Architecture Integrity (9/10):** The DB-first accounting model (`post_*` / `reverse_*` inside PostgreSQL, `withTenant()` RLS, no `BYPASSRLS`, IndexedDB offline queue with `offline_uuid`) is rock-solid and must remain the single source of truth.
2. **Permission Enforcement Gap (High):** `can_view_cost`, `can_give_discount`, and `can_manage_users` are not yet propagated into `Session` JWT claims or API response projection guards. Cost/margin fields must be stripped server-side before serialization when `can_view_cost === false`.
3. **Frontend Fragmentation Risk (High):** Building new screens by copying ad-hoc CSS between `styles.css` and `erp.css` will fracture RTL alignment, accessibility, and mobile touch targets. Unifying the design system and promoting `web/src/erp/` primitives into `web/src/ui/` is the #1 prerequisite.

---

## 2. Non-Negotiable Architectural Decisions

1. **Repository Cleanup (Single-Stack Monorepo):** Delete the unused root Next.js scaffold (`app/`, `components/`, `lib/`, `next.config.mjs`, `next-env.d.ts`, `pnpm-lock.yaml`, `components.json`, root `package.json`). Replace root `package.json` with clean workspace scripts orchestrating `db/`, `api/`, and `web/`, plus a production `docker-compose.yml`.
2. **Database as Sole Accounting Engine:** `api/` NEVER executes raw `INSERT`/`UPDATE`/`DELETE` against `journal_entries`, `journal_lines`, `stock_balances`, or `stock_ledger`. Every financial or inventory state transition MUST execute a PostgreSQL `post_*`, `reverse_*`, or `close_*` function inside `withTenant(pool, tid, ...)`.
3. **Three-Layer RBAC Enforcement:**
   - **DB Layer:** PostgreSQL functions assert `can_post` / `can_reverse` and RLS isolates `tenant_id`.
   - **API Layer:** Expand `Session` JWT payload to `{ uid, tid, branch, tv, uk, lim, perms: { post, reverse, cashview, viewCost, giveDiscount, manageUsers } }`. Add a declarative `requirePerm('...')` Fastify `preHandler` hook returning HTTP `403` with Arabic error messages, and strip `unit_cost` / `moving_avg_cost` / `profit` fields in serializers when `!perms.viewCost`.
   - **UI Layer:** Hide inaccessible navigation destinations; render visible disabled/locked explanations (`يلزم صلاحية ...`) for restricted actions inside accessible screens.
4. **Unified Frontend Shell & Design System (`web/src/ui/`):**
   - Consolidate `web/src/styles.css` and `web/src/erp/erp.css` into a single token-driven CSS architecture (plain CSS + CSS custom properties, logical properties `margin-inline` / `inset-inline-start`, `@fontsource/ibm-plex-sans-arabic` weights `400/500/600` only, Latin `0-9` tabular numerals, 8-pt grid, 1 px hairline panels, calm paper-ledger palette, WCAG 2.1 AA contrast ≥ 4.5:1, `prefers-reduced-motion`).
   - **Single Navigation Registry (`web/src/screens.ts`):** Declarative array defining every screen's `route`, `module`, `section` (`operations | setup | reports`), `pattern`, `requiredPerm`, `offlinePolicy` (`offline-capable | online-only`), and lazy component loader. Automatically generates: Mobile Bottom Bar (≤ 5 items), Mobile Drawer, Desktop RTL Right Rail, Breadcrumbs, Global Search index, and 403 Route Guards.
   - **Hash-Based Router (`#/pos`, `#/accounting/journal`, etc.):** Keep `#/pos` mounted in the DOM (or hydrated from IndexedDB) so cashiers can switch tabs and return to an active cart with zero latency.
5. **Five Reusable Screen Templates + Production `CodeNamePicker`:**
   - Every screen in the application MUST compose one of five templates under `web/src/ui/templates/`: `ListScreen`, `FormScreen`, `ReportScreen`, `DetailScreen`, `WizardScreen` (plus `ModuleHome` / `Dashboard`).
   - Promote `web/src/erp/CodeNamePicker.tsx` + `PickerScanner.tsx` into `web/src/ui/kit/CodeNamePicker.tsx` as the universal dual-entry selector (Code + Name, Arabic normalization ignoring tashkeel and normalizing `أ/إ/آ/ا`, `ة/ه`, `ى/ي`, IndexedDB local cache for `<100 ms` filtering with server fallback for large catalogs, recents/favorites, explicit disabled-record reasons, keyboard flow `code → name → qty → Enter adds row`, ARIA combobox accessibility).
6. **Strict Form, Surface & Feedback Contracts:**
   - Submit buttons are **never disabled**; clicking invalid forms scrolls to and focuses the first error.
   - Validation fires on **first blur** and clears immediately on edit.
   - Long forms autosave drafts to IndexedDB (`drafts` store) with a restore/discard banner.
   - Destructive/reversal actions require a named confirmation dialog (`Cancel` focused by default) plus a mandatory `reason` field for financial reversals.
   - Loaders: `<100 ms` none · `100 ms–1 s` inline control spinner · `>1 s` layout-matching skeletons.
7. **Offline & Sync Architecture:**
   - **Sales POS (`#/pos`):** Fully offline-capable via `vite-plugin-pwa` + IndexedDB (`offline.ts` queue + `submit_offline_sale` idempotency).
   - **Reference Data (`accounts`, `parties`, `items`, `warehouses`):** Cached read-only in IndexedDB with `cachedAt` timestamp (display `"القائمة محفوظة على الجهاز"` if cache > 24 h) to power instant `CodeNamePicker` lookups.
   - **All Other Mutating Screens:** Online-only with a non-blocking `"يلزم اتصال بالإنترنت"` banner while preserving local form drafts until connectivity returns.
8. **Server-Side Backup & Restore Architecture:**
   - Never run backup/restore from the browser. Implement an isolated backup worker on the API host executing encrypted `pg_dump` (with SHA-256 checksum + automated verification restore into an ephemeral scratch DB), writing to local encrypted volume + optional S3-compatible object storage (Cloudflare R2 / AWS S3).
   - Restore executes via a 4-step `WizardScreen` gated by owner role, mandatory pre-restore safety backup (default ON), typed company-name confirmation, and passphrase entry.

---

## 3. Target Monorepo Directory Structure

```text
erp-system/
├── package.json                      # Workspace runner (dev, test, build, db:migrate)
├── docker-compose.yml                # PostgreSQL 16 + erp-api (serves web/dist) + backup cron
├── db/
│   ├── 00_bootstrap_roles.sql
│   ├── erp_schema_v2.1.sql           # Existing 34-table hardened accounting kernel
│   ├── 01_post_install.sql
│   ├── 02_auth_hardening.sql
│   ├── 03_allocations_and_views.sql  # payment_allocations + financial/aging/stock views
│   ├── 04_inventory_counts.sql       # stock_count_sessions, lines, post_stock_count()
│   ├── 05_pricing_and_orders.sql     # price_lists, discount_rules, purchase_orders, quotations
│   ├── 06_admin_and_backups.sql      # bank_reconciliations, period_lock_requests, notifications, backup_jobs/runs
│   └── seed_demo.sql
├── api/
│   ├── src/
│   │   ├── app.ts                    # Fastify 5 bootstrap + expanded Session RBAC
│   │   ├── db.ts                     # withTenant() + pagination/query helpers
│   │   ├── rbac.ts                   # requirePerm(), stripCostFields()
│   │   ├── errors.ts                 # Centralized PostgreSQL -> Arabic HTTP error mapper
│   │   ├── backup-worker.ts          # Scheduled pg_dump + AES-256-GCM + checksum + verify
│   │   └── routes/
│   │       ├── auth.ts               # Existing (extend Session with full role flags)
│   │       ├── pos.ts                # Existing
│   │       ├── shifts.ts             # Existing
│   │       ├── sales.ts              # Existing
│   │       ├── conflicts.ts          # Existing
│   │       ├── invoices.ts           # Existing
│   │       ├── accounting.ts         # NEW: CoA, cost centers, journals, opening balances, transfers, FY close
│   │       ├── vouchers.ts           # NEW: Receipt, Payment, Petty Cash, list & reverse
│   │       ├── purchases.ts          # NEW: Suppliers, purchase invoices/returns, payments + allocations, POs
│   │       ├── inventory.ts          # NEW: Items, groups, units, warehouses, stock docs, counts, item card
│   │       ├── sales-backoffice.ts   # NEW: Customers, price lists, discounts, collections, quotations
│   │       ├── reports.ts            # NEW: GL, trial balance, P&L, balance sheet, aging, valuation, sales/purchase
│   │       ├── admin.ts              # NEW: Company, branches, FYs, users, roles matrix, sessions, audit, print templates
│   │       └── backups.ts            # NEW: Schedule, run-now, verify, 4-step restore, CSV import/export
│   └── test/                         # Real PostgreSQL HTTP integration tests per route plugin
└── web/
    └── src/
        ├── main.tsx
        ├── App.tsx                   # Hash router + Auth/2FA gate + Offline sync monitor
        ├── api.ts                    # Typed client + unified paginated list fetcher
        ├── idb.ts                    # IndexedDB: pos_queue, ref_cache (accounts/parties/items), form_drafts
        ├── screens.ts                # Single Source of Truth screen registry & nav generator
        ├── permissions.ts            # can(flag) helper + role-based route guard
        ├── ui/
        │   ├── tokens.css            # Paper-ledger design tokens (light, RTL, tabular-nums, print)
        │   ├── print.css             # @media print layouts (A4 + 80mm thermal receipt)
        │   ├── kit/                  # Button, Input, MoneyInput, Stepper, StatusChip, CodeNamePicker, DataTable, TreeView, LineEditor, Notice, Skeleton, EmptyState
        │   ├── overlay/              # Sheet, Drawer, ConfirmDialog (named + reason), Toast
        │   └── templates/            # AppShell, ListScreen, FormScreen, ReportScreen, DetailScreen, WizardScreen, ModuleHome
        └── modules/
            ├── pos/                  # Existing live POS, OpenShift, Shift, Conflicts, Invoices (migrated to ui/kit)
            ├── accounting/           # CoA, CostCenters, Vouchers, Journals, Transfers, Reconcile, PeriodLocks
            ├── inventory/            # Items, Groups, Units, Warehouses, StockDocs, StockCountWizard, ItemCard
            ├── purchases/            # Suppliers, PurchaseInvoices, Returns, SupplierPayments, POs
            ├── sales/                # Customers, PriceLists, Discounts, Collections, Quotations
            ├── reports/              # ReportsHub + parameterized ReportScreen views
            ├── admin/                # Company, Branches, FiscalYears, YearCloseWizard, Users, RolesMatrix, AuditLog, Sessions
            ├── backup/               # BackupSchedule, BackupsList, RestoreWizard, ImportExportWizard
            └── system/               # Login, 2FA, FirstRunWizard, Account, Notifications, GlobalSearch, SyncQueue, 403/404
```

---

## 4. Standardized API & Data Contracts

### 4.1 Unified Paginated List Contract
All `GET` collection endpoints (`accounts`, `parties`, `items`, `vouchers`, `invoices`, `audit`, etc.) MUST implement a single query & response schema:
- **Query Params:** `?q=<search>&page=1&limit=25&sort=<col>&dir=asc|desc&status=<enum>&from=YYYY-MM-DD&to=YYYY-MM-DD&branch_id=<uuid>`
- **Response:** `{ items: T[], total: number, page: number, limit: number, summary?: Record<string, string> }`
- **Reference Cache Endpoint:** `GET /api/ref-cache?since=<iso>` returns compact `{ id, code, name_ar, meta, active, postable }` payloads for `accounts`, `parties`, `items`, and `warehouses` to hydrate `CodeNamePicker` locally in IndexedDB.

### 4.2 Database-First Financial Endpoints Mapping
Every mutating route maps 1-to-1 to a hardened PostgreSQL function:

| Domain | API Endpoint | Underlying PostgreSQL Function / View | Required Role Flag |
|---|---|---|---|
| **Accounting** | `POST /api/journals/:id/post` | `post_journal_entry()` | `can_post` |
| **Accounting** | `POST /api/vouchers` / `POST /api/vouchers/:id/reverse` | `post_voucher()` / `reverse_voucher()` | `can_post` / `can_reverse` |
| **Accounting** | `POST /api/fiscal-years/:id/close` · `/reopen` | `close_fiscal_year()` · `reopen_fiscal_year()` | `can_manage_users` (Owner) |
| **Accounting** | `GET /api/reports/ledger` · `/trial-balance` | `v_account_statement` · `v_trial_balance` | `can_view_cash_balance` (for cash/bank) |
| **Purchases** | `POST /api/purchases/:id/post` · `/reverse` | `post_purchase_invoice()` · `reverse_purchase_invoice()` | `can_post` / `can_reverse` |
| **Inventory** | `POST /api/stock-docs/:id/post` | `post_stock_document()` | `can_post` |
| **Inventory** | `POST /api/stock-counts/:id/post` | `post_stock_count()` *(Phase 3 migration)* | `can_post` |
| **Sales POS** | `POST /api/sales` · `POST /api/invoices/:id/reverse` | `submit_offline_sale()` · `reverse_sales_invoice()` | `can_post` / `can_reverse` |
| **Shifts** | `POST /api/shifts/open` · `/close` · `GET /report` | `open_shift()` · `close_shift()` · `fn_shift_report()` | `can_post` (`can_view_cash_balance` for expected cash) |

### 4.3 New Database Migrations Required (`db/03` – `db/06`)
- **`03_allocations_and_views.sql`:**
  - `payment_allocations(id, tenant_id, voucher_id, invoice_type, invoice_id, allocated_amount)` with composite FKs and `FORCE RLS` (supports both invoice-linked and on-account auto-FIFO oldest-first allocation).
  - Read-only `security_invoker = true` views: `v_income_statement`, `v_balance_sheet`, `v_aging_receivables`, `v_aging_payables`, `v_stock_valuation`, `v_item_card`.
- **`04_inventory_counts.sql`:**
  - `stock_count_sessions` & `stock_count_lines` + atomic `post_stock_count()` generating a `stock_documents` (`ADJUSTMENT`) + balanced variance journal entry.
- **`05_pricing_and_orders.sql`:**
  - `price_lists`, `price_list_items`, `discount_rules`, `purchase_orders` / `purchase_order_lines`, `quotations` / `quotation_lines`.
- **`06_admin_and_backups.sql`:**
  - `bank_reconciliations`, `period_lock_requests`, `notifications`, `backup_jobs`, `backup_runs`, `print_templates`.

---

## 5. Phased Execution Roadmap & Exit Gates

Each phase MUST pass **all 4 exit gates** before the next phase starts: (1) Real PostgreSQL HTTP API tests pass 100%, (2) `tsc --noEmit` & production Vite build pass with zero warnings, (3) Browser verification at **390 px, 768 px, and 1280 px** with **Owner + Cashier** roles (zero horizontal overflow, ≥ 44 px touch targets, WCAG AA contrast), (4) Updated route table & docs.

### Phase 0 — Monorepo Cleanup, RBAC Hardening & Unified UI Foundation (1.5 Weeks)
- **Repo & Auth:** Remove dead root Next.js scaffold; create workspace root `package.json` & `docker-compose.yml`. Extend `Session` JWT in `api/src/app.ts` with `viewCost`, `giveDiscount`, `manageUsers`; implement `requirePerm()` and `stripCostFields()`.
- **UI Kit & Shell:** Merge `styles.css` + `erp.css` into `web/src/ui/tokens.css` & `print.css`. Promote `web/src/erp/{CodeNamePicker,PickerScanner,Confirm,InvoiceLines,ui}` into production `web/src/ui/kit/` & `ui/overlay/`. Build `AppShell`, `ListScreen`, `FormScreen`, `ReportScreen`, `DetailScreen`, `WizardScreen`, and `screens.ts` registry with hash routing.
- **Ref Cache & Migration:** Add `GET /api/ref-cache` + IndexedDB reference caching (`<100 ms` `CodeNamePicker`). Migrate existing live POS/Shift/Invoices/Conflicts/Account screens onto the new `AppShell` without regressing offline sales.
- **Exit Gate:** All 31 existing API tests + new RBAC tests pass; `CodeNamePicker` passes keyboard/Arabic-normalization/offline tests; zero layout regressions on POS at 390/768/1280 px.

### Phase 1 — Accounting & General Ledger (2 Weeks)
- **DB & API:** Apply `db/03_allocations_and_views.sql`. Implement `routes/accounting.ts` and `routes/vouchers.ts` (Chart of Accounts tree CRUD/deactivate, cost centers, opening balances, receipt/payment/petty-cash vouchers over `post_voucher`/`reverse_voucher`, journal entries over `post_journal_entry`, inter-account transfers, bank/wallet reconciliation, GL statement, trial balance, P&L, balance sheet).
- **UI:** Deliver all Accounting module screens (Setup, Operations, Reports) using `FormScreen` + `LineEditor` + `CodeNamePicker` + live `"الفرق"` balance indicator + `@media print` A4 ledger templates.
- **Exit Gate:** Automated tests prove balanced journal posting, empty/unbalanced rejection, closed-period rejection, reversal keeping historical period intact, and GL = Trial Balance = Financial Statements parity.

### Phase 2 — Purchasing & Suppliers (1.5 Weeks)
- **DB & API:** Implement `routes/purchases.ts` (suppliers CRUD & detail, supplier groups, purchase invoices & returns over `post_purchase_invoice`/`reverse_purchase_invoice`, supplier payments with FIFO auto-allocation + manual override + advance-payment notice, supplier statement & payables aging, optional purchase orders, invoice photo attachment upload).
- **UI:** Deliver all Purchasing screens + WhatsApp share (`Web Share API / wa.me`) for supplier invoices and statements + effect preview banner (`"يزيد المخزون · يزيد المستحق للمورد"`).
- **Exit Gate:** End-to-end test: Purchase Invoice → Inventory & Moving-Average Cost updated → Partial Return → Supplier Payment with Allocation → Payables Aging & Supplier Statement match GL Control Account to the fils.

### Phase 3 — Inventory & Warehouses (1.5 Weeks)
- **DB & API:** Apply `db/04_inventory_counts.sql`. Implement `routes/inventory.ts` (items CRUD with auto-code by group, alternate units & conversion factors, item groups, units, warehouses, reorder rules, stock overview, goods receipt, issue/write-off, warehouse transfer, stock count sessions + `post_stock_count()`, adjustments, item card history, valuation/movement/slow-mover reports).
- **UI:** Deliver all Inventory screens including one-handed phone barcode **Stock Count Wizard** (`PickerScanner`) and barcode label printing sheet (`80mm` & `A4`), with cost columns hidden when `!can_view_cost`.
- **Exit Gate:** Stock valuation report total equals `Inventory` GL account balance after receipts, sales, returns, transfers, and stock count adjustments.

### Phase 4 — Sales Back-Office & Pricing (1.5 Weeks)
- **DB & API:** Apply `db/05_pricing_and_orders.sql`. Implement `routes/sales-backoffice.ts` (customers CRUD/credit limits, price lists, discount rules gated by `can_give_discount`, customer collections with invoice allocation, receivables aging, detailed sales/cashier/item/payment-method/gross-profit reports gated by `can_view_cost`, optional quotations).
- **UI:** Deliver Sales Back-Office screens and unify POS quick-sale settings & discount enforcement with `can_give_discount`.
- **Exit Gate:** Cashier role cannot view cost/profit or issue unauthorized discounts (verified at both API 403 and UI layers); Receivables Aging matches Customer Control Account.

### Phase 5 — System Administration & Governance (1.5 Weeks)
- **DB & API:** Apply `db/06_admin_and_backups.sql`. Implement `routes/admin.ts` (company profile & logo, branches/warehouses, fiscal years + `close_fiscal_year`/`reopen_fiscal_year`, currencies/rates, payment methods, tax settings, print templates, users CRUD + force-logout via `token_version` + 2FA enforcement, Roles & Permissions matrix, active sessions, read-only audit log explorer with CSV export, period-lock requests).
- **UI:** Deliver all System Admin screens + **Year-End Closing Wizard** (named confirmation) + **First-Run Setup Wizard** + interactive Roles Matrix with role preview.
- **Exit Gate:** Revoking a user session immediately returns `401 SESSION_ENDED`; closing a fiscal year atomically locks back-dated postings across all operational tables.

### Phase 6 — Backup, Restore & Data Import/Export (1 Week)
- **Backend Worker & API:** Implement `api/src/backup-worker.ts` (scheduled & on-demand encrypted `pg_dump`, SHA-256 checksum, scratch-DB verification, local + optional S3/R2 upload, owner-gated restore with automatic pre-restore safety backup) and `routes/backups.ts` + CSV/Excel import validator (column mapping + dry-run error report).
- **UI:** Deliver Backup Schedule, Backups List, **4-Step Restore Wizard** (explicit data-loss preview + typed company name + passphrase + safety backup default ON), and Import/Export Wizards.
- **Exit Gate:** Full disaster-recovery drill passes: create backup → verify checksum → mutate DB → restore → verify exact pre-backup state and safety-backup preservation.

### Phase 7 — Reports Hub, Cross-Cutting UX & Polish (1 Week)
- Deliver **Reports Hub** (overview dashboard + searchable module catalog + favorites + unified `ReportScreen` with CSV/Excel export & print), **Module Home** dashboards, **Global Search**, **Notifications Center**, **Pending Sync Queue** screen, and `403 / 404 / Maintenance` pages.
- Retire `web/src/erp/` mock directory completely once all screens are wired to live APIs.

### Phase 8 — Production Hardening & Release Gate (1 Week)
- **Security:** Rotate secrets, enforce non-superuser DB credentials, apply `@fastify/rate-limit` to all new endpoints, verify `security_invoker = true` on all views, confirm zero `BYPASSRLS`.
- **Performance:** Add composite indexes for heavy reporting queries (`journal_lines(tenant_id, account_id)`, `stock_ledger(tenant_id, item_id, txn_date)`), run load tests on Trial Balance and 10k-row Account Statement.
- **End-to-End Verification:** Playwright multi-viewport (390/768/1280) + multi-role (Owner, Accountant, Storekeeper, Buyer, Cashier) E2E suite, screen-reader accessibility check, production Docker deployment, off-site backup test, and Arabic User/Admin manuals.

---

## 6. Recommended Resolutions for Open Business Decisions

To prevent mid-build blocking, adopt these defaults unless explicitly overridden by the business owner:

| Decision Point | Recommended Production Default | Rationale |
|---|---|---|
| **1. Supplier Payments on Account (Phase 2)** | **Allow unallocated/on-account payments** with automatic oldest-first (FIFO) invoice allocation and manual override. | Matches real Yemeni/Gulf wholesale practice where traders make lump-sum payments against running supplier accounts. |
| **2. Negative Stock Policy (Phase 3)** | **Keep current `V2.1` behavior:** allow offline POS sale into `SYNC_CONFLICT` with cash suspense posting for manager review; block direct online `POSTED` stock issues below zero. | Never stalls a cashier at checkout while keeping `stock_balances >= 0` and cash drawer reconciliation 100% accurate. |
| **3. Multi-Currency in UI (Phase 5)** | **Base currency (`YER`) only in day-to-day V1 UI**; keep `currencies` & `exchange_rates` in DB and Admin Setup as dormant/optional for Phase 5+. | Cuts UI and edge-case complexity by ~35% for initial launch without sacrificing future multi-currency expansion. |
| **4. Backup Storage Target (Phase 6)** | **Local encrypted volume + S3-compatible off-site sync** (Cloudflare R2 / AWS S3 configurable via env vars). | Local-only backups fail completely on disk loss or server compromise; R2 offers near-zero cost off-site durability. |
| **5. Sales Tax / VAT (General)** | **Keep schema & calculation hooks ready, disabled (`0%`) by default** per tenant with a clear "غير مفعّلة" Admin toggle. | Zero friction for Yemeni SMBs today while keeping the product immediately sellable to VAT-registered Gulf/Saudi clients. |

---

## 7. Immediate First-Step Execution Prompt (For Your Coding Agent)

> **Phase 0 Kickoff Directive:**
> "Read `ERP_FINAL_MASTER_ARCHITECTURE_EN.md`. Execute **Phase 0 only**:
> 1. Remove the unused root Next.js scaffold (`app/`, `components/`, `lib/`, `next.config.mjs`, `next-env.d.ts`, `components.json`, `pnpm-lock.yaml`, root `package.json`) and create a clean workspace root `package.json` + `docker-compose.yml` for `db/`, `api/`, and `web/`.
> 2. Expand `Session` in `api/src/app.ts` to include `viewCost`, `giveDiscount`, and `manageUsers`, add `api/src/rbac.ts` (`requirePerm`, `stripCostFields`), and add `GET /api/ref-cache`.
> 3. Consolidate `web/src/styles.css` and `web/src/erp/erp.css` into `web/src/ui/tokens.css`, promote `CodeNamePicker` and overlay/kit primitives from `web/src/erp/` into `web/src/ui/`, create `web/src/screens.ts` + hash router + the 5 screen templates, and migrate the existing live POS/Shift/Invoices/Conflicts/Account screens onto the unified `AppShell`.
> 4. Run `cd api && npm test` (all 31+ tests green) and `cd web && npm run build` (zero TS/build errors), then report verification results at 390/768/1280 px before starting Phase 1."
