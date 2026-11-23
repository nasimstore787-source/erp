-- ============================================================================
-- Multi-Tenant Commercial ERP Accounting System — PostgreSQL 16+ Hardened V2.1
-- ============================================================================
-- Production Guarantees Enforced at Database Level:
--   1. Full Multi-Tenant Isolation: Composite FKs (tenant_id, id) + FORCE RLS on ALL tables
--   2. Zero-Line & Unbalanced Entry Rejection: >=2 lines, >=1 Dr, >=1 Cr, SUM(Dr)=SUM(Cr)>0
--   3. True Immutability: journal_entries (POSTED) & journal_lines locked via triggers
--   4. Clean Reversal: Original stays POSTED; reversal entry links via unique reverses_entry_id
--   5. Unified Fiscal Year Bounds & Lock (FOR KEY SHARE) across ALL financial/stock documents
--   6. Base-Currency Balance + Per-Line FX Rounding Validation (<= 0.0001)
--   7. Concurrent Last-Unit Stock Protection via ordered FOR UPDATE on stock_balances
--   8. Single Atomic Posting Path: post_sales_invoice() with Offline Idempotency & Conflict State
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================
CREATE TYPE account_level_enum  AS ENUM ('MAIN', 'SUB', 'ANALYTICAL');
CREATE TYPE account_type_enum   AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE normal_bal_enum     AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE doc_status_enum     AS ENUM ('DRAFT', 'POSTED');
CREATE TYPE sync_status_enum    AS ENUM ('SYNCED', 'PENDING_SYNC', 'SYNC_CONFLICT', 'REJECTED');
CREATE TYPE costing_method_enum AS ENUM ('MOVING_WEIGHTED_AVERAGE', 'FIFO');
CREATE TYPE party_type_enum     AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');
CREATE TYPE voucher_type_enum   AS ENUM ('RECEIPT', 'PAYMENT', 'PETTY_CASH');
CREATE TYPE payment_method_enum AS ENUM ('CASH', 'JAIB', 'JAWALI', 'ONECASH', 'KURAIMI', 'BANK_TRANSFER', 'CREDIT');
CREATE TYPE stock_doc_type_enum AS ENUM ('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'SWAP_ITEM');
CREATE TYPE shift_status_enum   AS ENUM ('OPEN', 'CLOSED');

-- ============================================================================
-- 1. CORE GOVERNANCE: TENANTS, BRANCHES, FISCAL YEARS, ROLES, USERS, CURRENCIES
-- ============================================================================
CREATE TABLE tenants (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                        VARCHAR(32) NOT NULL UNIQUE,
    name_ar                     VARCHAR(200) NOT NULL,
    name_en                     VARCHAR(200),
    description_ar              TEXT,
    description_en              TEXT,
    logo_url                    TEXT,
    tax_number                  VARCHAR(64),
    costing_method              costing_method_enum NOT NULL DEFAULT 'MOVING_WEIGHTED_AVERAGE',
    costing_method_locked       BOOLEAN NOT NULL DEFAULT FALSE,
    allow_negative_stock_draft  BOOLEAN NOT NULL DEFAULT TRUE,
    theme_key                   VARCHAR(32) NOT NULL DEFAULT 'blue-silver',
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    subscription_expires_at     TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE branches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    code        VARCHAR(32) NOT NULL,
    name_ar     VARCHAR(150) NOT NULL,
    name_en     VARCHAR(150),
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE fiscal_years (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name        VARCHAR(64) NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    is_closed   BOOLEAN NOT NULL DEFAULT FALSE,
    closed_at   TIMESTAMPTZ,
    closed_by   UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE roles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name_ar                 VARCHAR(100) NOT NULL,
    permissions_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
    can_post                BOOLEAN NOT NULL DEFAULT FALSE,
    can_reverse             BOOLEAN NOT NULL DEFAULT FALSE,
    can_view_cost           BOOLEAN NOT NULL DEFAULT FALSE,
    can_view_cash_balance   BOOLEAN NOT NULL DEFAULT FALSE,
    can_give_discount       BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, name_ar)
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id       UUID NOT NULL,
    role_id         UUID NOT NULL,
    username        VARCHAR(80) NOT NULL,
    full_name_ar    VARCHAR(150) NOT NULL,
    password_hash   TEXT NOT NULL,
    two_fa_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, username),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, role_id)   REFERENCES roles(tenant_id, id)    ON DELETE RESTRICT
);

CREATE TABLE currencies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    code        VARCHAR(10) NOT NULL,
    name_ar     VARCHAR(64) NOT NULL,
    symbol      VARCHAR(16) NOT NULL,
    is_base     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE exchange_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    currency_id     UUID NOT NULL,
    rate_to_base    NUMERIC(18, 6) NOT NULL CHECK (rate_to_base > 0),
    effective_date  DATE NOT NULL,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, currency_id, effective_date),
    FOREIGN KEY (tenant_id, currency_id) REFERENCES currencies(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, created_by)  REFERENCES users(tenant_id, id)      ON DELETE RESTRICT
);

-- ============================================================================
-- 2. GENERAL LEDGER: ACCOUNTS, COST CENTERS, PARTIES, JOURNAL ENTRIES & LINES
-- ============================================================================
CREATE TABLE accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    parent_id           UUID,
    code                VARCHAR(40) NOT NULL,
    name_ar             VARCHAR(200) NOT NULL,
    name_en             VARCHAR(200),
    level               account_level_enum NOT NULL,
    is_analytical       BOOLEAN GENERATED ALWAYS AS (level = 'ANALYTICAL') STORED,
    account_type        account_type_enum NOT NULL,
    normal_balance      normal_bal_enum NOT NULL,
    default_currency_id UUID,
    is_system           BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, parent_id)           REFERENCES accounts(tenant_id, id)   ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, default_currency_id) REFERENCES currencies(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_accounts_tenant_parent ON accounts(tenant_id, parent_id);
CREATE INDEX idx_accounts_search ON accounts(tenant_id, name_ar, code);

CREATE TABLE cost_centers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    parent_id   UUID,
    code        VARCHAR(40) NOT NULL,
    name_ar     VARCHAR(160) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, parent_id) REFERENCES cost_centers(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE tenant_accounting_settings (
    tenant_id                       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
    default_cash_account_id         UUID,
    sales_revenue_account_id        UUID,
    sales_return_account_id         UUID,
    cogs_account_id                 UUID,
    default_inventory_account_id    UUID,
    allowed_discount_account_id     UUID,
    earned_discount_account_id      UUID,
    fx_gain_loss_account_id         UUID,
    cash_over_short_account_id      UUID,
    stock_adjustment_account_id     UUID,
    retained_earnings_account_id    UUID,
    customers_control_account_id    UUID,
    suppliers_control_account_id    UUID,
    vat_output_account_id           UUID,
    vat_input_account_id            UUID,
    default_vat_rate                NUMERIC(6, 4) NOT NULL DEFAULT 0.0000,
    FOREIGN KEY (tenant_id, default_cash_account_id)      REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, sales_revenue_account_id)     REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, sales_return_account_id)      REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, cogs_account_id)              REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, default_inventory_account_id) REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, allowed_discount_account_id)  REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, earned_discount_account_id)   REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, fx_gain_loss_account_id)      REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, cash_over_short_account_id)   REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, stock_adjustment_account_id)  REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, retained_earnings_account_id) REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, customers_control_account_id) REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, suppliers_control_account_id) REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, vat_output_account_id)        REFERENCES accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, vat_input_account_id)         REFERENCES accounts(tenant_id, id)
);

CREATE TABLE parties (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    party_type          party_type_enum NOT NULL,
    code                VARCHAR(40) NOT NULL,
    name_ar             VARCHAR(200) NOT NULL,
    phone               VARCHAR(32),
    whatsapp_phone      VARCHAR(32),
    account_id          UUID NOT NULL,
    credit_limit        NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (credit_limit >= 0),   -- customers: 0 = no limit
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE journal_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id           UUID NOT NULL,
    fiscal_year_id      UUID NOT NULL,
    entry_no            BIGINT NOT NULL,
    entry_date          DATE NOT NULL,
    source_type         VARCHAR(40) NOT NULL,
    source_id           UUID,
    reference_no        VARCHAR(80),
    description         TEXT,
    status              doc_status_enum NOT NULL DEFAULT 'DRAFT',
    reverses_entry_id   UUID, -- Points to original POSTED entry; original stays POSTED forever
    posted_at           TIMESTAMPTZ,
    posted_by           UUID,
    created_by          UUID NOT NULL,
    device_info         VARCHAR(200),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, fiscal_year_id, entry_no),
    FOREIGN KEY (tenant_id, branch_id)         REFERENCES branches(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, fiscal_year_id)    REFERENCES fiscal_years(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, reverses_entry_id) REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, posted_by)         REFERENCES users(tenant_id, id)           ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, created_by)        REFERENCES users(tenant_id, id)           ON DELETE RESTRICT
);
-- Prevent reversing the same posted entry more than once
CREATE UNIQUE INDEX uq_je_single_reversal
    ON journal_entries(tenant_id, reverses_entry_id)
    WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX idx_je_tenant_date ON journal_entries(tenant_id, fiscal_year_id, entry_date, id);

CREATE TABLE journal_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    journal_entry_id    UUID NOT NULL,
    account_id          UUID NOT NULL,
    cost_center_id      UUID,
    party_id            UUID,
    currency_id         UUID NOT NULL,
    exchange_rate       NUMERIC(18, 6) NOT NULL DEFAULT 1.000000 CHECK (exchange_rate > 0),
    debit_original      NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (debit_original >= 0),
    credit_original     NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (credit_original >= 0),
    debit_base          NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (debit_base >= 0),
    credit_base         NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (credit_base >= 0),
    line_description    TEXT,
    CHECK (
        (debit_original > 0 AND credit_original = 0 AND debit_base > 0 AND credit_base = 0)
        OR (credit_original > 0 AND debit_original = 0 AND credit_base > 0 AND debit_base = 0)
    ),
    FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, account_id)       REFERENCES accounts(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, cost_center_id)   REFERENCES cost_centers(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, party_id)         REFERENCES parties(tenant_id, id)         ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, currency_id)      REFERENCES currencies(tenant_id, id)      ON DELETE RESTRICT
);
CREATE INDEX idx_jl_account ON journal_lines(tenant_id, account_id, journal_entry_id);
CREATE INDEX idx_jl_party   ON journal_lines(tenant_id, party_id);

-- ============================================================================
-- 3. POS SHIFTS & VOUCHERS
-- ============================================================================
CREATE TABLE pos_shifts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id                   UUID NOT NULL,
    fiscal_year_id              UUID NOT NULL,
    cashier_user_id             UUID NOT NULL,
    cash_account_id             UUID NOT NULL,
    opened_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at                   TIMESTAMPTZ,
    opening_float               NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    expected_cash               NUMERIC(18, 4),
    counted_cash                NUMERIC(18, 4),
    variance_amount             NUMERIC(18, 4),
    status                      shift_status_enum NOT NULL DEFAULT 'OPEN',
    closing_journal_entry_id    UUID,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, branch_id)                REFERENCES branches(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, fiscal_year_id)           REFERENCES fiscal_years(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, cashier_user_id)          REFERENCES users(tenant_id, id)           ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, cash_account_id)          REFERENCES accounts(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, closing_journal_entry_id) REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE vouchers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id           UUID NOT NULL,
    fiscal_year_id      UUID NOT NULL,
    voucher_type        voucher_type_enum NOT NULL,
    voucher_no          BIGINT NOT NULL,
    voucher_date        DATE NOT NULL,
    reference_no        VARCHAR(80),
    cash_account_id     UUID NOT NULL,
    counter_account_id  UUID NOT NULL,
    party_id            UUID,
    cost_center_id      UUID,
    shift_id            UUID,
    currency_id         UUID NOT NULL,
    exchange_rate       NUMERIC(18, 6) NOT NULL DEFAULT 1.000000 CHECK (exchange_rate > 0),
    amount_original     NUMERIC(18, 4) NOT NULL CHECK (amount_original > 0),
    amount_base         NUMERIC(18, 4) NOT NULL CHECK (amount_base > 0),
    description         TEXT,
    status              doc_status_enum NOT NULL DEFAULT 'DRAFT',
    journal_entry_id    UUID,
    created_by          UUID NOT NULL,
    device_info         VARCHAR(200),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, fiscal_year_id, voucher_type, voucher_no),
    FOREIGN KEY (tenant_id, branch_id)          REFERENCES branches(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, fiscal_year_id)     REFERENCES fiscal_years(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, cash_account_id)    REFERENCES accounts(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, counter_account_id) REFERENCES accounts(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, party_id)           REFERENCES parties(tenant_id, id)         ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, cost_center_id)     REFERENCES cost_centers(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, shift_id)           REFERENCES pos_shifts(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, currency_id)        REFERENCES currencies(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, journal_entry_id)   REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, created_by)         REFERENCES users(tenant_id, id)           ON DELETE RESTRICT
);

-- ============================================================================
-- 4. INVENTORY, LOCKED STOCK BALANCES & IMMUTABLE STOCK LEDGER
-- ============================================================================
CREATE TABLE warehouses (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id               UUID NOT NULL,
    code                    VARCHAR(32) NOT NULL,
    name_ar                 VARCHAR(150) NOT NULL,
    inventory_account_id    UUID NOT NULL,
    is_default              BOOLEAN NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, branch_id)            REFERENCES branches(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, inventory_account_id) REFERENCES accounts(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE item_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    group_code      VARCHAR(16) NOT NULL,
    next_item_seq   INT NOT NULL DEFAULT 101,
    name_ar         VARCHAR(150) NOT NULL,
    name_en         VARCHAR(150),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, group_code)
);

CREATE TABLE units (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name_ar     VARCHAR(64) NOT NULL,
    name_en     VARCHAR(64),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, name_ar)
);

CREATE TABLE items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    group_id                UUID NOT NULL,
    item_code               VARCHAR(40) NOT NULL,
    barcode                 VARCHAR(80),
    name_ar                 VARCHAR(200) NOT NULL,
    name_en                 VARCHAR(200),
    image_url               TEXT,
    base_unit_id            UUID NOT NULL,
    is_purchasable          BOOLEAN NOT NULL DEFAULT TRUE,
    is_sellable             BOOLEAN NOT NULL DEFAULT TRUE,
    default_purchase_price  NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    default_sale_price      NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    reorder_level           NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    track_expiry            BOOLEAN NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, item_code),
    FOREIGN KEY (tenant_id, group_id)     REFERENCES item_groups(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, base_unit_id) REFERENCES units(tenant_id, id)       ON DELETE RESTRICT
);
CREATE INDEX idx_items_barcode ON items(tenant_id, barcode) WHERE barcode IS NOT NULL;

CREATE TABLE item_units (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    item_id             UUID NOT NULL,
    unit_id             UUID NOT NULL,
    conversion_factor   NUMERIC(18, 4) NOT NULL CHECK (conversion_factor > 0),
    barcode             VARCHAR(80),
    sale_price          NUMERIC(18, 4),
    UNIQUE (tenant_id, item_id, unit_id),
    FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE RESTRICT
);

-- Serialized lock target per (tenant, warehouse, item) to prevent concurrent overselling of last unit
CREATE TABLE stock_balances (
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    warehouse_id    UUID NOT NULL,
    item_id         UUID NOT NULL,
    qty_on_hand     NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (qty_on_hand >= 0),
    moving_avg_cost NUMERIC(18, 6) NOT NULL DEFAULT 0.000000 CHECK (moving_avg_cost >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, warehouse_id, item_id),
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, item_id)      REFERENCES items(tenant_id, id)      ON DELETE RESTRICT
);

CREATE TABLE stock_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id           UUID NOT NULL,
    fiscal_year_id      UUID NOT NULL,
    doc_type            stock_doc_type_enum NOT NULL,
    doc_no              BIGINT,   -- assigned atomically at posting via fn_next_no()
    doc_date            DATE NOT NULL,
    warehouse_id        UUID NOT NULL,
    target_warehouse_id UUID,
    counter_account_id  UUID,     -- IN: credited account, OUT: debited account (e.g. capital / expense)
    reference_no        VARCHAR(80),
    notes               TEXT,
    status              doc_status_enum NOT NULL DEFAULT 'DRAFT',
    journal_entry_id    UUID,
    created_by          UUID NOT NULL,
    device_info         VARCHAR(200),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((doc_type = 'TRANSFER') = (target_warehouse_id IS NOT NULL)),
    CHECK (target_warehouse_id IS NULL OR target_warehouse_id <> warehouse_id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, fiscal_year_id, doc_type, doc_no),
    FOREIGN KEY (tenant_id, branch_id)           REFERENCES branches(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, fiscal_year_id)      REFERENCES fiscal_years(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, warehouse_id)        REFERENCES warehouses(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, target_warehouse_id) REFERENCES warehouses(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, counter_account_id)  REFERENCES accounts(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, journal_entry_id)    REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, created_by)          REFERENCES users(tenant_id, id)           ON DELETE RESTRICT
);

-- Lines of stock documents (v2.0 had a header table with no lines table at all)
--   IN  : direction IN,  unit_cost required (> 0)
--   OUT : direction OUT, cost = moving average (computed at posting, written back to unit_cost)
--   TRANSFER: direction OUT lines (source warehouse -> target_warehouse_id), cost = source average
--   ADJUSTMENT: OUT = shortage/damaged, IN = surplus (valued at the average; unit_cost used only if average is 0)
--   SWAP_ITEM : exactly one OUT line and one IN line; the IN item takes over the value of the OUT item
CREATE TABLE stock_document_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    document_id     UUID NOT NULL,
    item_id         UUID NOT NULL,
    unit_id         UUID NOT NULL,
    direction       VARCHAR(3) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    qty             NUMERIC(18, 4) NOT NULL CHECK (qty > 0),
    base_qty        NUMERIC(18, 4) NOT NULL CHECK (base_qty > 0),
    unit_cost       NUMERIC(18, 6) NOT NULL DEFAULT 0.000000 CHECK (unit_cost >= 0),
    notes           TEXT,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, document_id) REFERENCES stock_documents(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, item_id)     REFERENCES items(tenant_id, id)           ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, unit_id)     REFERENCES units(tenant_id, id)           ON DELETE RESTRICT
);

CREATE TABLE stock_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    warehouse_id    UUID NOT NULL,
    item_id         UUID NOT NULL,
    txn_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_type     VARCHAR(40) NOT NULL,
    source_id       UUID NOT NULL,
    qty_in          NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (qty_in >= 0),
    qty_out         NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (qty_out >= 0),
    unit_cost       NUMERIC(18, 6) NOT NULL DEFAULT 0.000000,
    total_cost      NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    running_qty     NUMERIC(18, 4) NOT NULL,
    moving_avg_cost NUMERIC(18, 6) NOT NULL,
    batch_no        VARCHAR(64),
    expiry_date     DATE,
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, item_id)      REFERENCES items(tenant_id, id)      ON DELETE RESTRICT
);
CREATE INDEX idx_stock_ledger_item ON stock_ledger(tenant_id, warehouse_id, item_id, txn_date DESC);

-- ============================================================================
-- 5. PURCHASES & SALES (WITH OFFLINE IDEMPOTENCY & SPLIT PAYMENTS)
-- ============================================================================
CREATE TABLE purchase_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id           UUID NOT NULL,
    fiscal_year_id      UUID NOT NULL,
    invoice_no          BIGINT,   -- assigned atomically at posting via fn_next_no()
    is_return           BOOLEAN NOT NULL DEFAULT FALSE,
    original_invoice_id UUID,
    invoice_date        DATE NOT NULL,
    supplier_id         UUID,
    warehouse_id        UUID NOT NULL,
    payment_method      payment_method_enum NOT NULL,
    cash_account_id     UUID,
    subtotal            NUMERIC(18, 4) NOT NULL,
    discount_amount     NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    tax_amount          NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    net_total           NUMERIC(18, 4) NOT NULL,
    reference_no        VARCHAR(80),
    notes               TEXT,
    status              doc_status_enum NOT NULL DEFAULT 'DRAFT',
    journal_entry_id    UUID,
    created_by          UUID NOT NULL,
    device_info         VARCHAR(200),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (NOT is_return OR original_invoice_id IS NOT NULL),
    CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND net_total >= 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, fiscal_year_id, is_return, invoice_no),
    FOREIGN KEY (tenant_id, branch_id)           REFERENCES branches(tenant_id, id)          ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, fiscal_year_id)      REFERENCES fiscal_years(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, original_invoice_id) REFERENCES purchase_invoices(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, supplier_id)         REFERENCES parties(tenant_id, id)           ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, warehouse_id)        REFERENCES warehouses(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, cash_account_id)     REFERENCES accounts(tenant_id, id)          ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, journal_entry_id)    REFERENCES journal_entries(tenant_id, id)   ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, created_by)          REFERENCES users(tenant_id, id)             ON DELETE RESTRICT
);

CREATE TABLE purchase_invoice_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id      UUID NOT NULL,
    item_id         UUID NOT NULL,
    unit_id         UUID NOT NULL,
    qty             NUMERIC(18, 4) NOT NULL CHECK (qty > 0),
    base_qty        NUMERIC(18, 4) NOT NULL CHECK (base_qty > 0),
    unit_price      NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    line_discount   NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    line_total      NUMERIC(18, 4) NOT NULL,
    original_line_id UUID,   -- required on return lines: the purchased line being returned
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, original_line_id) REFERENCES purchase_invoice_lines(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES purchase_invoices(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, item_id)    REFERENCES items(tenant_id, id)             ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, unit_id)    REFERENCES units(tenant_id, id)             ON DELETE RESTRICT
);

CREATE TABLE sales_invoices (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id            UUID NOT NULL,
    fiscal_year_id       UUID NOT NULL,
    offline_uuid         UUID,
    offline_payload_hash VARCHAR(64),
    sync_status          sync_status_enum NOT NULL DEFAULT 'SYNCED',
    sync_conflict_reason TEXT,
    invoice_no           BIGINT,              -- assigned atomically at posting via fn_next_no()
    offline_receipt_no   VARCHAR(40),         -- device-local receipt number (printed while offline)
    is_return            BOOLEAN NOT NULL DEFAULT FALSE,
    original_invoice_id  UUID,
    invoice_date         DATE NOT NULL,
    customer_id          UUID,
    warehouse_id         UUID NOT NULL,
    shift_id             UUID,
    subtotal             NUMERIC(18, 4) NOT NULL,
    discount_amount      NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    tax_amount           NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    net_total            NUMERIC(18, 4) NOT NULL,
    notes                TEXT,
    status               doc_status_enum NOT NULL DEFAULT 'DRAFT',
    journal_entry_id     UUID,
    created_by           UUID NOT NULL,
    device_info          VARCHAR(200),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    credit_override_by     UUID,           -- manager approval to exceed the customer's credit limit (approve_credit_override only)
    credit_override_at     TIMESTAMPTZ,
    credit_override_reason TEXT,
    CHECK (NOT is_return OR original_invoice_id IS NOT NULL),
    CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND net_total >= 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, fiscal_year_id, is_return, invoice_no),
    UNIQUE (tenant_id, offline_uuid),
    FOREIGN KEY (tenant_id, branch_id)           REFERENCES branches(tenant_id, id)        ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, fiscal_year_id)      REFERENCES fiscal_years(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, original_invoice_id) REFERENCES sales_invoices(tenant_id, id)  ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, customer_id)         REFERENCES parties(tenant_id, id)         ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, warehouse_id)        REFERENCES warehouses(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, shift_id)            REFERENCES pos_shifts(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, journal_entry_id)    REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, created_by)          REFERENCES users(tenant_id, id)           ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, credit_override_by)  REFERENCES users(tenant_id, id)           ON DELETE RESTRICT
);

CREATE TABLE sales_invoice_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id      UUID NOT NULL,
    item_id         UUID NOT NULL,
    unit_id         UUID NOT NULL,
    qty             NUMERIC(18, 4) NOT NULL CHECK (qty > 0),
    base_qty        NUMERIC(18, 4) NOT NULL CHECK (base_qty > 0),
    unit_price      NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    unit_cost       NUMERIC(18, 6) NOT NULL DEFAULT 0.000000,
    line_discount   NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    line_total      NUMERIC(18, 4) NOT NULL,
    original_line_id UUID,   -- required on return lines: the sold line being returned
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, original_line_id) REFERENCES sales_invoice_lines(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES sales_invoices(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, item_id)    REFERENCES items(tenant_id, id)          ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, unit_id)    REFERENCES units(tenant_id, id)          ON DELETE RESTRICT
);

CREATE TABLE invoice_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id      UUID NOT NULL,
    payment_method  payment_method_enum NOT NULL,
    account_id      UUID NOT NULL,
    amount          NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    reference_no    VARCHAR(80),
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES sales_invoices(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id)       ON DELETE RESTRICT
);

-- ============================================================================
-- 6. IMMUTABLE AUDIT LOG
-- ============================================================================
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id         UUID NOT NULL,
    action          VARCHAR(32) NOT NULL,
    table_name      VARCHAR(64) NOT NULL,
    record_id       UUID NOT NULL,
    device_info     VARCHAR(200),
    ip_address      INET,
    old_json        JSONB,
    new_json        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);


-- ============================================================================
-- 7. V2.1 ADDITIONS: COUNTERS, DOCUMENT REVERSALS, EXTRA CONSTRAINTS
-- ============================================================================

-- Gap-free, concurrency-safe numbering (replaces MAX()+1). Row lock is held until COMMIT,
-- so a rolled-back document never burns a number.
CREATE TABLE doc_counters (
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    fiscal_year_id  UUID NOT NULL,
    doc_kind        VARCHAR(40) NOT NULL,
    last_no         BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, fiscal_year_id, doc_kind),
    FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years(tenant_id, id) ON DELETE RESTRICT
);

-- Document-level reversal marker (the reversed document itself stays POSTED & immutable)
CREATE TABLE document_reversals (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    source_type                 VARCHAR(40) NOT NULL,
    source_id                   UUID NOT NULL,
    reversal_journal_entry_id   UUID NOT NULL,
    shift_id                    UUID,
    reversal_date               DATE NOT NULL,
    reason                      TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    reversed_by                 UUID NOT NULL,
    reversed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, source_type, source_id),
    FOREIGN KEY (tenant_id, reversal_journal_entry_id) REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, shift_id)                  REFERENCES pos_shifts(tenant_id, id)      ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, reversed_by)               REFERENCES users(tenant_id, id)           ON DELETE RESTRICT
);

-- One OPEN shift per cash drawer => the drawer account balance is exactly that shift's cash
CREATE UNIQUE INDEX uq_open_shift_per_drawer ON pos_shifts(tenant_id, cash_account_id) WHERE status = 'OPEN';
-- Exactly one base currency per tenant
CREATE UNIQUE INDEX uq_single_base_currency ON currencies(tenant_id) WHERE is_base;

-- ============================================================================
-- 8. HELPERS
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_current_tenant() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::uuid $$;

CREATE OR REPLACE FUNCTION fn_assert_tenant(p_tenant UUID) RETURNS VOID
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_tenant IS NULL OR fn_current_tenant() IS DISTINCT FROM p_tenant THEN
        RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: session tenant (%) differs from requested tenant (%)', fn_current_tenant(), p_tenant;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_next_no(p_tenant UUID, p_fy UUID, p_kind TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no BIGINT;
BEGIN
    PERFORM fn_assert_tenant(p_tenant);
    INSERT INTO doc_counters (tenant_id, fiscal_year_id, doc_kind, last_no)
    VALUES (p_tenant, p_fy, p_kind, 1)
    ON CONFLICT (tenant_id, fiscal_year_id, doc_kind)
    DO UPDATE SET last_no = doc_counters.last_no + 1
    RETURNING last_no INTO v_no;
    RETURN v_no;
END $$;

-- Moving-average safety: removing stock at a cost that differs from the current average can leave the valuation
-- (qty x average) different from the ledger (GL). That is exact while stock remains, but not when the item is fully
-- depleted (no average left to absorb the difference) or when it would push the valuation below zero.
CREATE OR REPLACE FUNCTION fn_assert_cost_consistent(p_qty_before NUMERIC, p_avg_before NUMERIC, p_qty_out NUMERIC, p_value_out NUMERIC)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_after_value NUMERIC := p_qty_before * p_avg_before - p_value_out;
BEGIN
    IF (p_qty_before - p_qty_out = 0 AND ABS(v_after_value) > 0.01) OR (p_qty_before - p_qty_out > 0 AND v_after_value < -0.01) THEN
        RAISE EXCEPTION 'COST_CONFLICT: removing % units at value % against average % would leave the stock valuation inconsistent with the ledger; adjust through a stock adjustment instead',
                        p_qty_out, p_value_out, p_avg_before;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_base_currency(p_tenant UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT id FROM currencies WHERE tenant_id = p_tenant AND is_base LIMIT 1 $$;

CREATE OR REPLACE FUNCTION fn_fiscal_year_for(p_tenant UUID, p_date DATE) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT id FROM fiscal_years WHERE tenant_id = p_tenant AND p_date BETWEEN start_date AND end_date AND NOT is_closed LIMIT 1 $$;

-- Party balance (debit - credit, base currency) on a control account as of the fiscal year containing p_as_of.
-- After a year-end the opening entry restates balances in the new year, so the sum starts at the latest year that carries one.
CREATE OR REPLACE FUNCTION fn_party_balance(p_tenant UUID, p_party UUID, p_account UUID, p_as_of DATE) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_end DATE; v_floor DATE;
BEGIN
    SELECT end_date INTO v_end FROM fiscal_years WHERE tenant_id = p_tenant AND p_as_of BETWEEN start_date AND end_date;
    v_end := COALESCE(v_end, p_as_of);
    SELECT COALESCE(MAX(f.start_date), DATE '0001-01-01') INTO v_floor
    FROM fiscal_year_closings c JOIN fiscal_years f ON f.tenant_id = c.tenant_id AND f.id = c.next_fiscal_year_id
    WHERE c.tenant_id = p_tenant AND c.reopened_at IS NULL AND f.end_date <= v_end;
    RETURN COALESCE((SELECT SUM(jl.debit_base - jl.credit_base)
                     FROM journal_lines jl
                     JOIN journal_entries je ON je.tenant_id = jl.tenant_id AND je.id = jl.journal_entry_id
                     JOIN fiscal_years fy    ON fy.tenant_id = je.tenant_id AND fy.id = je.fiscal_year_id
                     WHERE jl.tenant_id = p_tenant AND jl.party_id = p_party AND jl.account_id = p_account
                       AND je.status = 'POSTED' AND fy.start_date >= v_floor AND fy.end_date <= v_end), 0);
END $$;

-- ============================================================================
-- 9. HARDENED TRIGGERS (all SECURITY DEFINER: callers need no lock privileges)
-- ============================================================================

-- 9.1 journal_entries: auto-number
CREATE OR REPLACE FUNCTION fn_assign_entry_no() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.entry_no IS NULL THEN
        NEW.entry_no := fn_next_no(NEW.tenant_id, NEW.fiscal_year_id, 'JE');
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_je_assign_no BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION fn_assign_entry_no();

-- 9.2 journal_lines guard
CREATE OR REPLACE FUNCTION fn_protect_journal_lines() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_tenant_id UUID; v_je_id UUID; v_je_status doc_status_enum;
    v_is_analytical BOOLEAN; v_is_active BOOLEAN;
    v_cust_ctl UUID; v_sup_ctl UUID; v_party_type party_type_enum;
BEGIN
    v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
    v_je_id     := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

    SELECT status INTO v_je_status FROM journal_entries
    WHERE tenant_id = v_tenant_id AND id = v_je_id FOR UPDATE;

    IF v_je_status IS NULL THEN
        -- Parent already gone: this is the ON DELETE CASCADE of a DRAFT entry being deleted
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Parent journal_entry (%) not found', v_je_id;
    END IF;
    IF v_je_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Cannot % lines on POSTED journal_entry (%)', TG_OP, v_je_id;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

    SELECT is_analytical, is_active INTO v_is_analytical, v_is_active
    FROM accounts WHERE tenant_id = NEW.tenant_id AND id = NEW.account_id;
    IF v_is_analytical IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Account (%) is not ANALYTICAL', NEW.account_id;
    END IF;
    IF v_is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Account (%) is inactive', NEW.account_id;
    END IF;
    IF ABS(ROUND(NEW.debit_original * NEW.exchange_rate, 4) - NEW.debit_base) > 0.0001
       OR ABS(ROUND(NEW.credit_original * NEW.exchange_rate, 4) - NEW.credit_base) > 0.0001 THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Base amount does not match original * exchange_rate';
    END IF;

    -- control accounts: every line must name a party of the right kind, so the sub-ledger always equals the control account
    SELECT customers_control_account_id, suppliers_control_account_id INTO v_cust_ctl, v_sup_ctl
    FROM tenant_accounting_settings WHERE tenant_id = NEW.tenant_id;
    IF NEW.account_id IN (v_cust_ctl, v_sup_ctl) THEN
        IF NEW.party_id IS NULL THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: a line on a customers / suppliers control account must carry a party_id';
        END IF;
        SELECT party_type INTO v_party_type FROM parties WHERE tenant_id = NEW.tenant_id AND id = NEW.party_id;
        IF NOT ((NEW.account_id = v_cust_ctl AND v_party_type IN ('CUSTOMER', 'BOTH'))
             OR (NEW.account_id = v_sup_ctl  AND v_party_type IN ('SUPPLIER', 'BOTH'))) THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: party (%) is not of the kind this control account requires', NEW.party_id;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_jl_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION fn_protect_journal_lines();

-- 9.3 journal_entries guard (FOR SHARE on the fiscal year: conflicts with ANY concurrent UPDATE of it,
--     unlike FOR KEY SHARE which does not conflict with FOR NO KEY UPDATE)
CREATE OR REPLACE FUNCTION fn_protect_journal_entry() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_fy_closed BOOLEAN; v_fy_start DATE; v_fy_end DATE;
    v_orig_status doc_status_enum; v_orig_rev UUID;
    v_line_count INT; v_dr_count INT; v_cr_count INT;
    v_sum_dr NUMERIC(18,4); v_sum_cr NUMERIC(18,4);
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'POSTED' THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Cannot delete POSTED journal_entry (%)', OLD.id;
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: POSTED journal_entry (%) is permanently immutable', OLD.id;
    END IF;

    SELECT is_closed, start_date, end_date INTO v_fy_closed, v_fy_start, v_fy_end
    FROM fiscal_years WHERE tenant_id = NEW.tenant_id AND id = NEW.fiscal_year_id FOR SHARE;
    IF v_fy_closed IS NULL THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Fiscal year (%) not found for tenant', NEW.fiscal_year_id;
    END IF;
    IF v_fy_closed THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Fiscal year (%) is closed', NEW.fiscal_year_id;
    END IF;
    IF NEW.entry_date < v_fy_start OR NEW.entry_date > v_fy_end THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: entry_date (%) outside fiscal year (%..%)', NEW.entry_date, v_fy_start, v_fy_end;
    END IF;

    IF NEW.reverses_entry_id IS NOT NULL THEN
        SELECT status, reverses_entry_id INTO v_orig_status, v_orig_rev
        FROM journal_entries WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_entry_id;
        IF v_orig_status IS DISTINCT FROM 'POSTED' THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Can only reverse a POSTED entry (%)', NEW.reverses_entry_id;
        END IF;
        IF v_orig_rev IS NOT NULL THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Cannot reverse a reversal entry (%)', NEW.reverses_entry_id;
        END IF;
    END IF;

    IF NEW.status = 'POSTED' AND (TG_OP = 'INSERT' OR OLD.status <> 'POSTED') THEN
        SELECT COUNT(*), COUNT(*) FILTER (WHERE debit_base > 0), COUNT(*) FILTER (WHERE credit_base > 0),
               COALESCE(SUM(debit_base), 0), COALESCE(SUM(credit_base), 0)
        INTO v_line_count, v_dr_count, v_cr_count, v_sum_dr, v_sum_cr
        FROM journal_lines WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.id;

        IF v_line_count < 2 OR v_dr_count < 1 OR v_cr_count < 1 THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Cannot post empty or single-sided journal_entry (%)', NEW.id;
        END IF;
        IF v_sum_dr <= 0 OR v_sum_dr <> v_sum_cr THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Unbalanced journal_entry (%), Dr=%, Cr=%', NEW.id, v_sum_dr, v_sum_cr;
        END IF;

        -- A reversal must be the exact mirror of the original, account by account
        IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (
            (SELECT account_id, SUM(credit_base), SUM(debit_base) FROM journal_lines
              WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.reverses_entry_id GROUP BY account_id
             EXCEPT
             SELECT account_id, SUM(debit_base), SUM(credit_base) FROM journal_lines
              WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.id GROUP BY account_id)
            UNION ALL
            (SELECT account_id, SUM(debit_base), SUM(credit_base) FROM journal_lines
              WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.id GROUP BY account_id
             EXCEPT
             SELECT account_id, SUM(credit_base), SUM(debit_base) FROM journal_lines
              WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.reverses_entry_id GROUP BY account_id)
        ) THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Reversal entry (%) does not mirror original (%)', NEW.id, NEW.reverses_entry_id;
        END IF;
        NEW.posted_at := COALESCE(NEW.posted_at, NOW());
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_je_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION fn_protect_journal_entry();

-- 9.4 operational documents (vouchers / stock docs / purchase & sales invoices)
--     v2.0 referenced NEW.voucher_date inside one CASE => "record new has no field" on EVERY insert.
CREATE OR REPLACE FUNCTION fn_guard_operational_doc() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_fy_closed BOOLEAN; v_fy_start DATE; v_fy_end DATE; v_doc_date DATE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'POSTED' THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Cannot delete POSTED document in %', TG_TABLE_NAME;
        END IF;
        IF TG_TABLE_NAME = 'sales_invoices' AND to_jsonb(OLD) ->> 'offline_uuid' IS NOT NULL
           AND to_jsonb(OLD) ->> 'sync_status' IN ('SYNC_CONFLICT', 'REJECTED') THEN
            RAISE EXCEPTION 'SYNC_CONFLICT_PROTECTED: an offline receipt in conflict / rejected cannot be deleted; resolve it with resolve_sync_conflict()';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Cannot modify POSTED document in %', TG_TABLE_NAME;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: New documents in % must start as DRAFT', TG_TABLE_NAME;
    END IF;

    v_doc_date := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME
        WHEN 'vouchers'          THEN 'voucher_date'
        WHEN 'stock_documents'   THEN 'doc_date'
        WHEN 'purchase_invoices' THEN 'invoice_date'
        WHEN 'sales_invoices'    THEN 'invoice_date'
    END)::date;

    SELECT is_closed, start_date, end_date INTO v_fy_closed, v_fy_start, v_fy_end
    FROM fiscal_years WHERE tenant_id = NEW.tenant_id AND id = NEW.fiscal_year_id FOR SHARE;
    IF v_fy_closed IS NULL THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Fiscal year not found for %', TG_TABLE_NAME;
    END IF;
    IF v_fy_closed THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Fiscal year is closed for %', TG_TABLE_NAME;
    END IF;
    IF v_doc_date < v_fy_start OR v_doc_date > v_fy_end THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Document date (%) outside fiscal year (%..%)', v_doc_date, v_fy_start, v_fy_end;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_vouchers_guard     BEFORE INSERT OR UPDATE OR DELETE ON vouchers          FOR EACH ROW EXECUTE FUNCTION fn_guard_operational_doc();
CREATE TRIGGER trg_stock_docs_guard   BEFORE INSERT OR UPDATE OR DELETE ON stock_documents   FOR EACH ROW EXECUTE FUNCTION fn_guard_operational_doc();
CREATE TRIGGER trg_purchase_inv_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_invoices FOR EACH ROW EXECUTE FUNCTION fn_guard_operational_doc();
CREATE TRIGGER trg_sales_inv_guard    BEFORE INSERT OR UPDATE OR DELETE ON sales_invoices    FOR EACH ROW EXECUTE FUNCTION fn_guard_operational_doc();

-- the credit-limit override can only be written by approve_credit_override()
CREATE OR REPLACE FUNCTION fn_guard_credit_override() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF (NEW.credit_override_by IS NOT NULL OR NEW.credit_override_at IS NOT NULL OR NEW.credit_override_reason IS NOT NULL)
       AND (TG_OP = 'INSERT' OR OLD.credit_override_by IS DISTINCT FROM NEW.credit_override_by
            OR OLD.credit_override_at IS DISTINCT FROM NEW.credit_override_at OR OLD.credit_override_reason IS DISTINCT FROM NEW.credit_override_reason)
       AND COALESCE(current_setting('erp.credit_override_ok', TRUE), '') <> 'on' THEN
        RAISE EXCEPTION 'CREDIT_OVERRIDE_PROTECTED: a credit-limit override is granted only through approve_credit_override()';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_sales_credit_override BEFORE INSERT OR UPDATE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION fn_guard_credit_override();

-- 9.5 document LINES: frozen once the parent is POSTED (v2.0 protected headers only)
--     usage: EXECUTE FUNCTION fn_guard_doc_lines('<parent_table>', '<fk_column>')
CREATE OR REPLACE FUNCTION fn_guard_doc_lines() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_row JSONB; v_tenant UUID; v_parent UUID; v_status doc_status_enum;
BEGIN
    v_row := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    v_tenant := (v_row ->> 'tenant_id')::uuid;
    v_parent := (v_row ->> TG_ARGV[1])::uuid;
    EXECUTE format('SELECT status FROM %I WHERE tenant_id = $1 AND id = $2 FOR SHARE', TG_ARGV[0])
        INTO v_status USING v_tenant, v_parent;
    IF v_status IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;   -- cascade from deleting a DRAFT parent
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: parent document not found in %', TG_ARGV[0];
    END IF;
    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Cannot % lines of a POSTED document (%)', TG_OP, TG_TABLE_NAME;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_sil_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_invoice_lines    FOR EACH ROW EXECUTE FUNCTION fn_guard_doc_lines('sales_invoices', 'invoice_id');
CREATE TRIGGER trg_pil_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_invoice_lines FOR EACH ROW EXECUTE FUNCTION fn_guard_doc_lines('purchase_invoices', 'invoice_id');
CREATE TRIGGER trg_pay_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_payments       FOR EACH ROW EXECUTE FUNCTION fn_guard_doc_lines('sales_invoices', 'invoice_id');
CREATE TRIGGER trg_sdl_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_document_lines FOR EACH ROW EXECUTE FUNCTION fn_guard_doc_lines('stock_documents', 'document_id');

-- 9.6 append-only tables + TRUNCATE protection
CREATE OR REPLACE FUNCTION fn_block_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: % on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER trg_stock_ledger_immutable BEFORE UPDATE OR DELETE ON stock_ledger FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();
CREATE TRIGGER trg_audit_immutable        BEFORE UPDATE OR DELETE ON audit_logs   FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

CREATE OR REPLACE FUNCTION fn_block_truncate() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: TRUNCATE on % is not allowed', TG_TABLE_NAME;
END $$;
DO $$
DECLARE v_t TEXT;
BEGIN
    FOREACH v_t IN ARRAY ARRAY['journal_entries','journal_lines','stock_ledger','audit_logs','sales_invoices',
                               'sales_invoice_lines','invoice_payments','document_reversals','pos_shifts','doc_counters']
    LOOP
        EXECUTE format('CREATE TRIGGER trg_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION fn_block_truncate()', v_t);
    END LOOP;
END $$;

-- 9.7 closed shifts are frozen
CREATE OR REPLACE FUNCTION fn_guard_shift() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'CLOSED' THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Closed shift (%) is immutable', OLD.id;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_shift_guard BEFORE UPDATE OR DELETE ON pos_shifts FOR EACH ROW EXECUTE FUNCTION fn_guard_shift();

-- 9.8 chart of accounts hierarchy rules
CREATE OR REPLACE FUNCTION fn_guard_account() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p_level account_level_enum; v_p_type account_type_enum;
BEGIN
    IF NEW.level = 'MAIN' AND NEW.parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'ACCOUNT_RULE: MAIN account cannot have a parent';
    END IF;
    IF NEW.level <> 'MAIN' AND NEW.parent_id IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_RULE: % account requires a parent', NEW.level;
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
        SELECT level, account_type INTO v_p_level, v_p_type FROM accounts WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id;
        IF v_p_level = 'ANALYTICAL' THEN
            RAISE EXCEPTION 'ACCOUNT_RULE: an ANALYTICAL account cannot be a parent';
        END IF;
        IF v_p_type <> NEW.account_type THEN
            RAISE EXCEPTION 'ACCOUNT_RULE: account_type must match the parent (%)', v_p_type;
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.level <> 'ANALYTICAL' AND NEW.level = 'ANALYTICAL'
           AND EXISTS (SELECT 1 FROM accounts WHERE tenant_id = NEW.tenant_id AND parent_id = NEW.id) THEN
            RAISE EXCEPTION 'ACCOUNT_RULE: account with children cannot become ANALYTICAL';
        END IF;
        IF OLD.level = 'ANALYTICAL' AND NEW.level <> 'ANALYTICAL'
           AND EXISTS (SELECT 1 FROM journal_lines WHERE tenant_id = NEW.tenant_id AND account_id = NEW.id) THEN
            RAISE EXCEPTION 'ACCOUNT_RULE: account with postings cannot stop being ANALYTICAL';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_account_guard BEFORE INSERT OR UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION fn_guard_account();

-- ============================================================================
-- 10. POSTING FUNCTIONS (single atomic path per document type)
--     Lock order everywhere: invoice/doc row -> shift row -> stock_balances (by item_id) -> counters.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 10.1 post_sales_invoice  (sale / return, POS / wholesale / offline sync)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_sales_invoice(
    p_tenant_id   UUID,
    p_invoice_id  UUID,
    p_user_id     UUID,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS TABLE (out_invoice_no BIGINT, out_journal_entry_id UUID, out_sync_status sync_status_enum)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_inv        sales_invoices%ROWTYPE;
    v_set        tenant_accounting_settings%ROWTYPE;
    v_shift      pos_shifts%ROWTYPE;
    v_can_post   BOOLEAN;
    v_base_cur   UUID;
    v_wh_inv_acc UUID;
    v_line       RECORD;
    v_pay        RECORD;
    v_bal        stock_balances%ROWTYPE;
    v_acc        accounts%ROWTYPE;
    v_cust       parties%ROWTYPE;
    v_cnt        INT;
    v_sum_lines  NUMERIC(18,4);
    v_pay_sum    NUMERIC(18,4);
    v_reason     TEXT;
    v_cost       NUMERIC(18,6);
    v_line_cost  NUMERIC(18,4);
    v_total_cogs NUMERIC(18,4) := 0;
    v_new_qty    NUMERIC(18,4);
    v_new_avg    NUMERIC(18,6);
    v_je_id      UUID;
    v_no         BIGINT;
    v_credit_sum NUMERIC(18,4);
    v_cust_bal   NUMERIC(18,4);
    v_msg        TEXT;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);

    SELECT r.can_post INTO v_can_post
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: User (%) lacks can_post permission', p_user_id;
    END IF;

    SELECT * INTO v_inv FROM sales_invoices WHERE tenant_id = p_tenant_id AND id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Sales invoice (%) not found', p_invoice_id;
    END IF;
    IF v_inv.status = 'POSTED' THEN       -- idempotent replay
        RETURN QUERY SELECT v_inv.invoice_no, v_inv.journal_entry_id, v_inv.sync_status;
        RETURN;
    END IF;
    IF v_inv.sync_status = 'REJECTED' THEN   -- a manager rejected this receipt: the device just learns the verdict
        RETURN QUERY SELECT NULL::BIGINT, NULL::UUID, 'REJECTED'::sync_status_enum;
        RETURN;
    END IF;

    SELECT * INTO v_set FROM tenant_accounting_settings WHERE tenant_id = p_tenant_id;
    IF v_set.tenant_id IS NULL OR v_set.sales_revenue_account_id IS NULL OR v_set.sales_return_account_id IS NULL
       OR v_set.cogs_account_id IS NULL OR v_set.customers_control_account_id IS NULL THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: sales/return/COGS/customers accounts must be configured';
    END IF;
    IF v_inv.discount_amount > 0 AND v_set.allowed_discount_account_id IS NULL THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: allowed_discount_account_id is required for discounts';
    END IF;
    IF v_inv.tax_amount > 0 AND v_set.vat_output_account_id IS NULL THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: vat_output_account_id is required for tax';
    END IF;
    SELECT inventory_account_id INTO v_wh_inv_acc FROM warehouses WHERE tenant_id = p_tenant_id AND id = v_inv.warehouse_id;
    v_base_cur := fn_base_currency(p_tenant_id);
    IF v_base_cur IS NULL THEN RAISE EXCEPTION 'SETTINGS_INCOMPLETE: no base currency'; END IF;

    -- ---- shift (lock FOR SHARE so close_shift serialises against posting) ----
    IF v_inv.shift_id IS NOT NULL THEN
        SELECT * INTO v_shift FROM pos_shifts WHERE tenant_id = p_tenant_id AND id = v_inv.shift_id FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: shift (%)', v_inv.shift_id; END IF;
        IF v_shift.status <> 'OPEN' THEN
            IF v_inv.sync_status IN ('PENDING_SYNC', 'SYNC_CONFLICT') THEN
                v_reason := format('SHIFT_CLOSED: shift %s was closed before this offline receipt synced', v_inv.shift_id);
            ELSE
                RAISE EXCEPTION 'SHIFT_CLOSED: cannot post into closed shift (%)', v_inv.shift_id;
            END IF;
        END IF;
    END IF;

    -- ---- structural validation (always raises: a malformed document is never a "conflict") ----
    SELECT COUNT(*), COALESCE(SUM(line_total), 0) INTO v_cnt, v_sum_lines
    FROM sales_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id;
    IF v_cnt = 0 THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Invoice has no lines'; END IF;

    IF EXISTS (SELECT 1 FROM sales_invoice_lines
               WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id
                 AND line_total <> ROUND(qty * unit_price, 4) - line_discount) THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: line_total <> qty * unit_price - line_discount';
    END IF;
    IF EXISTS (SELECT 1 FROM sales_invoice_lines l
               JOIN items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
               LEFT JOIN item_units iu ON iu.tenant_id = l.tenant_id AND iu.item_id = l.item_id AND iu.unit_id = l.unit_id
               WHERE l.tenant_id = p_tenant_id AND l.invoice_id = v_inv.id
                 AND l.base_qty IS DISTINCT FROM CASE WHEN l.unit_id = i.base_unit_id THEN l.qty
                                                      ELSE ROUND(l.qty * iu.conversion_factor, 4) END) THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: base_qty does not match unit conversion';
    END IF;
    IF v_inv.subtotal <> v_sum_lines THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: subtotal (%) <> sum of lines (%)', v_inv.subtotal, v_sum_lines;
    END IF;
    IF v_inv.discount_amount > v_inv.subtotal THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: discount exceeds subtotal';
    END IF;
    IF v_inv.net_total <> v_inv.subtotal - v_inv.discount_amount + v_inv.tax_amount THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: net_total <> subtotal - discount + tax';
    END IF;
    IF v_inv.net_total <= 0 THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: net_total must be positive';
    END IF;

    -- ---- sale vs return linkage ----
    IF NOT v_inv.is_return THEN
        IF EXISTS (SELECT 1 FROM sales_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id AND original_line_id IS NOT NULL) THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: original_line_id is only valid on return lines';
        END IF;
    ELSE
        PERFORM 1 FROM sales_invoices o
        WHERE o.tenant_id = p_tenant_id AND o.id = v_inv.original_invoice_id
          AND o.status = 'POSTED' AND NOT o.is_return FOR UPDATE;       -- serialises concurrent returns of one invoice
        IF NOT FOUND THEN
            RAISE EXCEPTION 'RETURN_INVALID: original invoice must be a POSTED sale';
        END IF;
        IF EXISTS (SELECT 1 FROM document_reversals WHERE tenant_id = p_tenant_id AND source_type = 'SALES_INVOICE' AND source_id = v_inv.original_invoice_id) THEN
            RAISE EXCEPTION 'RETURN_INVALID: original invoice was reversed';
        END IF;
        IF EXISTS (SELECT 1 FROM sales_invoice_lines l
                   LEFT JOIN sales_invoice_lines ol ON ol.tenant_id = l.tenant_id AND ol.id = l.original_line_id
                   WHERE l.tenant_id = p_tenant_id AND l.invoice_id = v_inv.id
                     AND (ol.id IS NULL OR ol.invoice_id <> v_inv.original_invoice_id
                          OR ol.item_id <> l.item_id OR l.unit_price > ol.unit_price)) THEN
            RAISE EXCEPTION 'RETURN_INVALID: each return line must reference a line of the original invoice (same item, price <= sold price)';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM (SELECT original_line_id, SUM(base_qty) q FROM sales_invoice_lines
                  WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id GROUP BY original_line_id) cur
            JOIN sales_invoice_lines ol ON ol.tenant_id = p_tenant_id AND ol.id = cur.original_line_id
            WHERE cur.q + COALESCE((SELECT SUM(r.base_qty) FROM sales_invoice_lines r
                                    JOIN sales_invoices rs ON rs.tenant_id = r.tenant_id AND rs.id = r.invoice_id
                                    WHERE r.tenant_id = p_tenant_id AND r.original_line_id = ol.id
                                      AND rs.status = 'POSTED' AND rs.id <> v_inv.id
                                      AND NOT EXISTS (SELECT 1 FROM document_reversals dr WHERE dr.tenant_id = rs.tenant_id
                                                      AND dr.source_type = 'SALES_INVOICE' AND dr.source_id = rs.id)), 0) > ol.base_qty) THEN
            RAISE EXCEPTION 'RETURN_EXCEEDS_SOLD: returned quantity exceeds the quantity sold';
        END IF;
    END IF;

    -- ---- payments ----
    SELECT COALESCE(SUM(amount), 0) INTO v_pay_sum FROM invoice_payments WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id;
    IF v_pay_sum <> v_inv.net_total THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Payments (%) do not equal net_total (%)', v_pay_sum, v_inv.net_total;
    END IF;
    FOR v_pay IN SELECT * FROM invoice_payments WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id LOOP
        SELECT * INTO v_acc FROM accounts WHERE tenant_id = p_tenant_id AND id = v_pay.account_id;
        IF NOT v_acc.is_analytical OR NOT v_acc.is_active OR v_acc.account_type <> 'ASSET' THEN
            RAISE EXCEPTION 'PAYMENT_INVALID: payment account (%) must be an active analytical ASSET account', v_pay.account_id;
        END IF;
        IF v_pay.payment_method = 'CREDIT' THEN
            IF v_inv.customer_id IS NULL THEN
                RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Credit payment requires a customer_id';
            END IF;
            IF v_pay.account_id <> v_set.customers_control_account_id THEN
                RAISE EXCEPTION 'PAYMENT_INVALID: CREDIT must use the customers control account';
            END IF;
            SELECT * INTO v_cust FROM parties WHERE tenant_id = p_tenant_id AND id = v_inv.customer_id;
            IF v_cust.party_type NOT IN ('CUSTOMER', 'BOTH') OR NOT v_cust.is_active THEN
                RAISE EXCEPTION 'PAYMENT_INVALID: customer (%) is not an active customer', v_inv.customer_id;
            END IF;
        ELSE
            IF v_pay.account_id = v_set.customers_control_account_id THEN
                RAISE EXCEPTION 'PAYMENT_INVALID: non-credit payment cannot use the customers control account';
            END IF;
            IF v_pay.payment_method = 'CASH' THEN
                IF v_inv.shift_id IS NOT NULL AND v_pay.account_id <> v_shift.cash_account_id THEN
                    RAISE EXCEPTION 'PAYMENT_INVALID: CASH must go to the shift drawer account';
                END IF;
                IF v_inv.shift_id IS NULL AND v_pay.account_id IS DISTINCT FROM v_set.default_cash_account_id THEN
                    RAISE EXCEPTION 'PAYMENT_INVALID: CASH without a shift must go to the default cash account';
                END IF;
            ELSIF v_inv.shift_id IS NOT NULL AND v_pay.account_id = v_shift.cash_account_id THEN
                RAISE EXCEPTION 'PAYMENT_INVALID: wallet/bank payment cannot use the cash drawer account';
            END IF;
        END IF;
    END LOOP;

    -- ---- credit limit (customers.credit_limit > 0; 0 = no limit). The customer row is locked so two concurrent credit
    --      sales cannot both pass the check. An offline receipt over the limit becomes a SYNC_CONFLICT for a manager. ----
    SELECT COALESCE(SUM(amount), 0) INTO v_credit_sum FROM invoice_payments
    WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id AND payment_method = 'CREDIT';
    IF NOT v_inv.is_return AND v_credit_sum > 0 THEN
        SELECT * INTO v_cust FROM parties WHERE tenant_id = p_tenant_id AND id = v_inv.customer_id FOR UPDATE;
        IF v_cust.credit_limit > 0 AND v_inv.credit_override_by IS NULL THEN
            v_cust_bal := fn_party_balance(p_tenant_id, v_inv.customer_id, v_set.customers_control_account_id, v_inv.invoice_date);
            IF v_cust_bal + v_credit_sum > v_cust.credit_limit THEN
                v_msg := format('CREDIT_LIMIT_EXCEEDED: customer balance %s + this sale %s exceeds the limit %s', v_cust_bal, v_credit_sum, v_cust.credit_limit);
                IF v_inv.sync_status IN ('PENDING_SYNC', 'SYNC_CONFLICT') THEN
                    IF v_reason IS NULL THEN v_reason := v_msg; END IF;
                ELSE
                    RAISE EXCEPTION '%', v_msg;
                END IF;
            END IF;
        END IF;
    END IF;

    -- ---- PASS 1: lock stock rows in deterministic order and CHECK availability. Nothing is mutated here. ----
    IF v_reason IS NULL THEN
        FOR v_line IN SELECT item_id, SUM(base_qty) AS need
                      FROM sales_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id
                      GROUP BY item_id ORDER BY item_id LOOP
            INSERT INTO stock_balances (tenant_id, warehouse_id, item_id, qty_on_hand, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 0, 0)
            ON CONFLICT (tenant_id, warehouse_id, item_id) DO NOTHING;

            SELECT * INTO v_bal FROM stock_balances
            WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id FOR UPDATE;

            IF NOT v_inv.is_return AND v_bal.qty_on_hand < v_line.need THEN
                v_reason := format('INSUFFICIENT_STOCK: item %s need %s, available %s', v_line.item_id, v_line.need, v_bal.qty_on_hand);
                EXIT;
            END IF;
        END LOOP;
    END IF;

    IF v_reason IS NOT NULL THEN
        IF v_inv.sync_status IN ('PENDING_SYNC', 'SYNC_CONFLICT') THEN
            -- Offline receipt: keep the document, record the conflict, change NOTHING else (all-or-nothing).
            UPDATE sales_invoices SET sync_status = 'SYNC_CONFLICT', sync_conflict_reason = v_reason
            WHERE tenant_id = p_tenant_id AND id = v_inv.id;
            RETURN QUERY SELECT v_inv.invoice_no, NULL::UUID, 'SYNC_CONFLICT'::sync_status_enum;
            RETURN;
        END IF;
        RAISE EXCEPTION '%', v_reason;
    END IF;

    -- ---- PASS 2: apply stock movements (all rows already locked) ----
    FOR v_line IN SELECT * FROM sales_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id
                  ORDER BY item_id, id LOOP
        SELECT * INTO v_bal FROM stock_balances
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;

        IF NOT v_inv.is_return THEN
            v_cost      := v_bal.moving_avg_cost;
            v_line_cost := ROUND(v_line.base_qty * v_cost, 4);
            UPDATE sales_invoice_lines SET unit_cost = v_cost WHERE tenant_id = p_tenant_id AND id = v_line.id;
            UPDATE stock_balances SET qty_on_hand = qty_on_hand - v_line.base_qty, updated_at = NOW()
            WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_out, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'SALES', v_inv.id, v_line.base_qty, v_cost, v_line_cost,
                    v_bal.qty_on_hand - v_line.base_qty, v_bal.moving_avg_cost);
        ELSE
            -- return: restore at the ORIGINAL sale cost (server-side, client value ignored) and re-average
            SELECT unit_cost INTO v_cost FROM sales_invoice_lines WHERE tenant_id = p_tenant_id AND id = v_line.original_line_id;
            v_line_cost := ROUND(v_line.base_qty * v_cost, 4);
            v_new_qty   := v_bal.qty_on_hand + v_line.base_qty;
            v_new_avg   := CASE WHEN v_new_qty > 0
                                THEN ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost + v_line.base_qty * v_cost) / v_new_qty, 6)
                                ELSE v_cost END;
            UPDATE sales_invoice_lines SET unit_cost = v_cost WHERE tenant_id = p_tenant_id AND id = v_line.id;
            UPDATE stock_balances SET qty_on_hand = v_new_qty, moving_avg_cost = v_new_avg, updated_at = NOW()
            WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_in, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'SALES_RETURN', v_inv.id, v_line.base_qty, v_cost, v_line_cost,
                    v_new_qty, v_new_avg);
        END IF;
        v_total_cogs := v_total_cogs + v_line_cost;
    END LOOP;

    -- ---- journal entry (base currency, rate 1: exact, no rounding) ----
    v_no := fn_next_no(p_tenant_id, v_inv.fiscal_year_id, CASE WHEN v_inv.is_return THEN 'SALES_RETURN' ELSE 'SALES' END);

    INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description, status, created_by, device_info)
    VALUES (p_tenant_id, v_inv.branch_id, v_inv.fiscal_year_id, v_inv.invoice_date,
            CASE WHEN v_inv.is_return THEN 'SALES_RETURN' ELSE 'SALES' END, v_inv.id,
            format('%s رقم %s', CASE WHEN v_inv.is_return THEN 'مردود مبيعات' ELSE 'فاتورة مبيعات' END, v_no),
            'DRAFT', p_user_id, p_device_info)
    RETURNING id INTO v_je_id;

    FOR v_pay IN SELECT * FROM invoice_payments WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id LOOP
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, party_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        VALUES (p_tenant_id, v_je_id, v_pay.account_id,
                CASE WHEN v_pay.payment_method = 'CREDIT' THEN v_inv.customer_id END, v_base_cur,
                CASE WHEN NOT v_inv.is_return THEN v_pay.amount ELSE 0 END, CASE WHEN NOT v_inv.is_return THEN v_pay.amount ELSE 0 END,
                CASE WHEN v_inv.is_return THEN v_pay.amount ELSE 0 END,     CASE WHEN v_inv.is_return THEN v_pay.amount ELSE 0 END);
    END LOOP;

    IF v_inv.discount_amount > 0 THEN
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        VALUES (p_tenant_id, v_je_id, v_set.allowed_discount_account_id, v_base_cur,
                CASE WHEN NOT v_inv.is_return THEN v_inv.discount_amount ELSE 0 END, CASE WHEN NOT v_inv.is_return THEN v_inv.discount_amount ELSE 0 END,
                CASE WHEN v_inv.is_return THEN v_inv.discount_amount ELSE 0 END,     CASE WHEN v_inv.is_return THEN v_inv.discount_amount ELSE 0 END);
    END IF;

    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
    VALUES (p_tenant_id, v_je_id, CASE WHEN v_inv.is_return THEN v_set.sales_return_account_id ELSE v_set.sales_revenue_account_id END, v_base_cur,
            CASE WHEN v_inv.is_return THEN v_inv.subtotal ELSE 0 END,     CASE WHEN v_inv.is_return THEN v_inv.subtotal ELSE 0 END,
            CASE WHEN NOT v_inv.is_return THEN v_inv.subtotal ELSE 0 END, CASE WHEN NOT v_inv.is_return THEN v_inv.subtotal ELSE 0 END);

    IF v_inv.tax_amount > 0 THEN
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        VALUES (p_tenant_id, v_je_id, v_set.vat_output_account_id, v_base_cur,
                CASE WHEN v_inv.is_return THEN v_inv.tax_amount ELSE 0 END,     CASE WHEN v_inv.is_return THEN v_inv.tax_amount ELSE 0 END,
                CASE WHEN NOT v_inv.is_return THEN v_inv.tax_amount ELSE 0 END, CASE WHEN NOT v_inv.is_return THEN v_inv.tax_amount ELSE 0 END);
    END IF;

    IF v_total_cogs > 0 THEN
        -- COGS line / inventory line (return: inventory Dr, COGS Cr)
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        VALUES (p_tenant_id, v_je_id, v_set.cogs_account_id, v_base_cur,
                CASE WHEN NOT v_inv.is_return THEN v_total_cogs ELSE 0 END, CASE WHEN NOT v_inv.is_return THEN v_total_cogs ELSE 0 END,
                CASE WHEN v_inv.is_return THEN v_total_cogs ELSE 0 END,     CASE WHEN v_inv.is_return THEN v_total_cogs ELSE 0 END);
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        VALUES (p_tenant_id, v_je_id, v_wh_inv_acc, v_base_cur,
                CASE WHEN v_inv.is_return THEN v_total_cogs ELSE 0 END,     CASE WHEN v_inv.is_return THEN v_total_cogs ELSE 0 END,
                CASE WHEN NOT v_inv.is_return THEN v_total_cogs ELSE 0 END, CASE WHEN NOT v_inv.is_return THEN v_total_cogs ELSE 0 END);
    END IF;

    UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id
    WHERE tenant_id = p_tenant_id AND id = v_je_id;

    UPDATE sales_invoices SET status = 'POSTED', sync_status = 'SYNCED', sync_conflict_reason = NULL,
                              invoice_no = v_no, journal_entry_id = v_je_id
    WHERE tenant_id = p_tenant_id AND id = v_inv.id;

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'POST', 'sales_invoices', v_inv.id, p_device_info,
            jsonb_build_object('journal_entry_id', v_je_id, 'invoice_no', v_no, 'net_total', v_inv.net_total));

    RETURN QUERY SELECT v_no, v_je_id, 'SYNCED'::sync_status_enum;
END $$;

-- ----------------------------------------------------------------------------
-- 10.2 submit_offline_sale : server-side idempotency (offline_uuid + server-computed payload hash)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_offline_sale(
    p_tenant_id   UUID,
    p_payload     JSONB,
    p_user_id     UUID,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS TABLE (out_invoice_id UUID, out_invoice_no BIGINT, out_journal_entry_id UUID,
               out_sync_status sync_status_enum, out_replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uuid      UUID := (p_payload ->> 'offline_uuid')::uuid;
    v_hash      TEXT;
    v_id        UUID;
    v_old_hash  TEXT;
    v_date      DATE := (p_payload ->> 'invoice_date')::date;
    v_fy        UUID;
    v_subtotal  NUMERIC(18,4);
    v_disc      NUMERIC(18,4) := COALESCE((p_payload ->> 'discount_amount')::numeric, 0);
    v_tax       NUMERIC(18,4) := COALESCE((p_payload ->> 'tax_amount')::numeric, 0);
    v_replayed  BOOLEAN := FALSE;
    r           RECORD;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    IF v_uuid IS NULL THEN RAISE EXCEPTION 'OFFLINE_INVALID: offline_uuid is required'; END IF;
    v_hash := encode(digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');   -- never trust a client hash

    SELECT id, offline_payload_hash INTO v_id, v_old_hash
    FROM sales_invoices WHERE tenant_id = p_tenant_id AND offline_uuid = v_uuid FOR UPDATE;

    IF FOUND THEN
        IF v_old_hash IS DISTINCT FROM v_hash THEN
            RAISE EXCEPTION 'OFFLINE_UUID_REUSED: offline_uuid (%) already used with a different payload', v_uuid;
        END IF;
        v_replayed := TRUE;
    ELSE
        v_fy := fn_fiscal_year_for(p_tenant_id, v_date);
        IF v_fy IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: no open fiscal year for %', v_date; END IF;

        SELECT COALESCE(SUM(ROUND(x.qty * x.unit_price, 4) - COALESCE(x.line_discount, 0)), 0) INTO v_subtotal
        FROM jsonb_to_recordset(p_payload -> 'lines') AS x(qty numeric, unit_price numeric, line_discount numeric);

        IF p_payload ? 'net_total' AND (p_payload ->> 'net_total')::numeric <> v_subtotal - v_disc + v_tax THEN
            RAISE EXCEPTION 'OFFLINE_INVALID: net_total in payload does not match its lines';
        END IF;

        INSERT INTO sales_invoices (tenant_id, branch_id, fiscal_year_id, offline_uuid, offline_payload_hash, sync_status,
                                    offline_receipt_no, invoice_date, customer_id, warehouse_id, shift_id,
                                    subtotal, discount_amount, tax_amount, net_total, notes, status, created_by, device_info)
        VALUES (p_tenant_id, (p_payload ->> 'branch_id')::uuid, v_fy, v_uuid, v_hash, 'PENDING_SYNC',
                p_payload ->> 'receipt_no', v_date, (p_payload ->> 'customer_id')::uuid, (p_payload ->> 'warehouse_id')::uuid,
                (p_payload ->> 'shift_id')::uuid, v_subtotal, v_disc, v_tax, v_subtotal - v_disc + v_tax,
                p_payload ->> 'notes', 'DRAFT', p_user_id, p_device_info)
        ON CONFLICT (tenant_id, offline_uuid) DO NOTHING
        RETURNING id INTO v_id;

        IF v_id IS NULL THEN          -- lost a race with a concurrent identical submit: replay it
            SELECT id, offline_payload_hash INTO v_id, v_old_hash FROM sales_invoices
            WHERE tenant_id = p_tenant_id AND offline_uuid = v_uuid FOR UPDATE;
            IF v_old_hash IS DISTINCT FROM v_hash THEN
                RAISE EXCEPTION 'OFFLINE_UUID_REUSED: offline_uuid (%) already used with a different payload', v_uuid;
            END IF;
            v_replayed := TRUE;
        ELSE
            INSERT INTO sales_invoice_lines (tenant_id, invoice_id, item_id, unit_id, qty, base_qty, unit_price, line_discount, line_total, original_line_id)
            SELECT p_tenant_id, v_id, x.item_id, x.unit_id, x.qty, x.base_qty, x.unit_price, COALESCE(x.line_discount, 0),
                   ROUND(x.qty * x.unit_price, 4) - COALESCE(x.line_discount, 0), x.original_line_id
            FROM jsonb_to_recordset(p_payload -> 'lines')
                 AS x(item_id uuid, unit_id uuid, qty numeric, base_qty numeric, unit_price numeric, line_discount numeric, original_line_id uuid);

            INSERT INTO invoice_payments (tenant_id, invoice_id, payment_method, account_id, amount, reference_no)
            SELECT p_tenant_id, v_id, x.payment_method::payment_method_enum, x.account_id, x.amount, x.reference_no
            FROM jsonb_to_recordset(p_payload -> 'payments')
                 AS x(payment_method text, account_id uuid, amount numeric, reference_no text);
        END IF;
    END IF;

    SELECT * INTO r FROM post_sales_invoice(p_tenant_id, v_id, p_user_id, p_device_info);
    RETURN QUERY SELECT v_id, r.out_invoice_no, r.out_journal_entry_id, r.out_sync_status, v_replayed;
END $$;

-- ----------------------------------------------------------------------------
-- 10.3 reverse_sales_invoice : document-level reversal (journal + stock together)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_sales_invoice(
    p_tenant_id   UUID,
    p_invoice_id  UUID,
    p_user_id     UUID,
    p_reason      TEXT,
    p_shift_id    UUID DEFAULT NULL,
    p_date        DATE DEFAULT CURRENT_DATE,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_can_rev   BOOLEAN;
    v_inv       sales_invoices%ROWTYPE;
    v_shift     pos_shifts%ROWTYPE;
    v_line      RECORD;
    v_bal       stock_balances%ROWTYPE;
    v_fy        UUID;
    v_je        UUID;
    v_orig_je   journal_entries%ROWTYPE;
    v_new_qty   NUMERIC(18,4);
    v_new_avg   NUMERIC(18,6);
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_reverse INTO v_can_rev
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_rev IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: User (%) lacks can_reverse permission', p_user_id;
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: a reason is required';
    END IF;

    SELECT * INTO v_inv FROM sales_invoices WHERE tenant_id = p_tenant_id AND id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Sales invoice (%)', p_invoice_id; END IF;
    IF v_inv.status <> 'POSTED' THEN RAISE EXCEPTION 'REVERSAL_INVALID: only POSTED invoices can be reversed'; END IF;
    IF EXISTS (SELECT 1 FROM document_reversals WHERE tenant_id = p_tenant_id AND source_type = 'SALES_INVOICE' AND source_id = v_inv.id) THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: invoice already reversed';
    END IF;
    IF NOT v_inv.is_return AND EXISTS (SELECT 1 FROM sales_invoices WHERE tenant_id = p_tenant_id AND original_invoice_id = v_inv.id AND status = 'POSTED'
                                  AND NOT EXISTS (SELECT 1 FROM document_reversals dr WHERE dr.tenant_id = sales_invoices.tenant_id
                                                  AND dr.source_type = 'SALES_INVOICE' AND dr.source_id = sales_invoices.id)) THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: invoice has posted returns; reverse the returns first';
    END IF;

    v_fy := fn_fiscal_year_for(p_tenant_id, p_date);
    IF v_fy IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: no open fiscal year for %', p_date; END IF;

    IF EXISTS (SELECT 1 FROM invoice_payments WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id AND payment_method = 'CASH') THEN
        IF p_shift_id IS NULL THEN RAISE EXCEPTION 'REVERSAL_INVALID: cash invoice reversal requires an OPEN shift'; END IF;
        SELECT * INTO v_shift FROM pos_shifts WHERE tenant_id = p_tenant_id AND id = p_shift_id FOR SHARE;
        IF NOT FOUND OR v_shift.status <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_CLOSED: reversal needs an OPEN shift'; END IF;
        IF EXISTS (SELECT 1 FROM invoice_payments WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id
                   AND payment_method = 'CASH' AND account_id <> v_shift.cash_account_id) THEN
            RAISE EXCEPTION 'REVERSAL_INVALID: shift drawer differs from the invoice cash account';
        END IF;
    END IF;

    -- lock stock in order; a reversed RETURN must still find the stock to remove
    FOR v_line IN SELECT item_id, SUM(base_qty) AS q FROM sales_invoice_lines
                  WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id GROUP BY item_id ORDER BY item_id LOOP
        SELECT * INTO v_bal FROM stock_balances
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id FOR UPDATE;
        IF v_inv.is_return AND v_bal.qty_on_hand < v_line.q THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: cannot reverse return, item % available %, needed %', v_line.item_id, v_bal.qty_on_hand, v_line.q;
        END IF;
    END LOOP;

    FOR v_line IN SELECT * FROM sales_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id ORDER BY item_id, id LOOP
        SELECT * INTO v_bal FROM stock_balances
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;
        IF NOT v_inv.is_return THEN           -- undo a sale: goods come back at the cost they left at
            v_new_qty := v_bal.qty_on_hand + v_line.base_qty;
            v_new_avg := CASE WHEN v_new_qty > 0
                              THEN ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost + v_line.base_qty * v_line.unit_cost) / v_new_qty, 6)
                              ELSE v_line.unit_cost END;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_in, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'SALES_REVERSAL', v_inv.id, v_line.base_qty, v_line.unit_cost,
                    ROUND(v_line.base_qty * v_line.unit_cost, 4), v_new_qty, v_new_avg);
        ELSE                                   -- undo a return: goods leave again
            PERFORM fn_assert_cost_consistent(v_bal.qty_on_hand, v_bal.moving_avg_cost, v_line.base_qty, ROUND(v_line.base_qty * v_line.unit_cost, 4));
            v_new_qty := v_bal.qty_on_hand - v_line.base_qty;
            v_new_avg := CASE WHEN v_new_qty > 0
                              THEN GREATEST(ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost - v_line.base_qty * v_line.unit_cost) / v_new_qty, 6), 0)
                              ELSE v_bal.moving_avg_cost END;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_out, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'SALES_RETURN_REVERSAL', v_inv.id, v_line.base_qty, v_line.unit_cost,
                    ROUND(v_line.base_qty * v_line.unit_cost, 4), v_new_qty, v_new_avg);
        END IF;
        UPDATE stock_balances SET qty_on_hand = v_new_qty, moving_avg_cost = v_new_avg, updated_at = NOW()
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;
    END LOOP;

    SELECT * INTO v_orig_je FROM journal_entries WHERE tenant_id = p_tenant_id AND id = v_inv.journal_entry_id;
    INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description,
                                 status, reverses_entry_id, created_by, device_info)
    VALUES (p_tenant_id, v_inv.branch_id, v_fy, p_date, 'SALES_REVERSAL', v_inv.id,
            format('عكس فاتورة رقم %s: %s', v_inv.invoice_no, p_reason), 'DRAFT', v_orig_je.id, p_user_id, p_device_info)
    RETURNING id INTO v_je;

    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, cost_center_id, party_id, currency_id, exchange_rate,
                               debit_original, credit_original, debit_base, credit_base, line_description)
    SELECT tenant_id, v_je, account_id, cost_center_id, party_id, currency_id, exchange_rate,
           credit_original, debit_original, credit_base, debit_base, line_description
    FROM journal_lines WHERE tenant_id = p_tenant_id AND journal_entry_id = v_orig_je.id;

    UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id
    WHERE tenant_id = p_tenant_id AND id = v_je;

    INSERT INTO document_reversals (tenant_id, source_type, source_id, reversal_journal_entry_id, shift_id, reversal_date, reason, reversed_by)
    VALUES (p_tenant_id, 'SALES_INVOICE', v_inv.id, v_je, p_shift_id, p_date, p_reason, p_user_id);

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'REVERSE', 'sales_invoices', v_inv.id, p_device_info,
            jsonb_build_object('reversal_journal_entry_id', v_je, 'reason', p_reason));
    RETURN v_je;
END $$;

-- ----------------------------------------------------------------------------
-- 10.4 post_journal_entry (manual entries, S14/S15) and post_voucher (S12/S13/petty cash)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_journal_entry(p_tenant_id UUID, p_je_id UUID, p_user_id UUID, p_device_info VARCHAR DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_can_post BOOLEAN; v_status doc_status_enum;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_post INTO v_can_post FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'PERMISSION_DENIED: lacks can_post'; END IF;
    SELECT status INTO v_status FROM journal_entries WHERE tenant_id = p_tenant_id AND id = p_je_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: journal entry (%)', p_je_id; END IF;
    IF v_status = 'POSTED' THEN RETURN; END IF;
    UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id
    WHERE tenant_id = p_tenant_id AND id = p_je_id;
    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info)
    VALUES (p_tenant_id, p_user_id, 'POST', 'journal_entries', p_je_id, p_device_info);
END $$;

CREATE OR REPLACE FUNCTION post_voucher(p_tenant_id UUID, p_voucher_id UUID, p_user_id UUID, p_device_info VARCHAR DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_can_post BOOLEAN; v        vouchers%ROWTYPE; v_shift pos_shifts%ROWTYPE; v_je UUID;
    v_cash_dr  BOOLEAN;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_post INTO v_can_post FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'PERMISSION_DENIED: lacks can_post'; END IF;

    SELECT * INTO v FROM vouchers WHERE tenant_id = p_tenant_id AND id = p_voucher_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: voucher (%)', p_voucher_id; END IF;
    IF v.status = 'POSTED' THEN RETURN v.journal_entry_id; END IF;
    IF v.cash_account_id = v.counter_account_id THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: cash and counter accounts are identical'; END IF;
    IF ABS(ROUND(v.amount_original * v.exchange_rate, 4) - v.amount_base) > 0.0001 THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: amount_base does not match amount_original * exchange_rate';
    END IF;

    IF v.shift_id IS NOT NULL THEN
        SELECT * INTO v_shift FROM pos_shifts WHERE tenant_id = p_tenant_id AND id = v.shift_id FOR SHARE;
        IF NOT FOUND OR v_shift.status <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_CLOSED: voucher shift is not OPEN'; END IF;
        IF v.cash_account_id <> v_shift.cash_account_id THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: voucher cash account must be the shift drawer';
        END IF;
    ELSIF v.voucher_type = 'PETTY_CASH' THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: PETTY_CASH voucher requires a shift';
    END IF;

    v_cash_dr := (v.voucher_type = 'RECEIPT');
    INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, reference_no, description, status, created_by, device_info)
    VALUES (p_tenant_id, v.branch_id, v.fiscal_year_id, v.voucher_date, 'VOUCHER_' || v.voucher_type::text, v.id, v.reference_no,
            COALESCE(v.description, format('سند %s رقم %s', v.voucher_type, v.voucher_no)), 'DRAFT', p_user_id, p_device_info)
    RETURNING id INTO v_je;

    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, exchange_rate, debit_original, debit_base, credit_original, credit_base)
    VALUES (p_tenant_id, v_je, v.cash_account_id, v.currency_id, v.exchange_rate,
            CASE WHEN v_cash_dr THEN v.amount_original ELSE 0 END, CASE WHEN v_cash_dr THEN v.amount_base ELSE 0 END,
            CASE WHEN v_cash_dr THEN 0 ELSE v.amount_original END, CASE WHEN v_cash_dr THEN 0 ELSE v.amount_base END);
    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, party_id, cost_center_id, currency_id, exchange_rate, debit_original, debit_base, credit_original, credit_base)
    VALUES (p_tenant_id, v_je, v.counter_account_id, v.party_id, v.cost_center_id, v.currency_id, v.exchange_rate,
            CASE WHEN v_cash_dr THEN 0 ELSE v.amount_original END, CASE WHEN v_cash_dr THEN 0 ELSE v.amount_base END,
            CASE WHEN v_cash_dr THEN v.amount_original ELSE 0 END, CASE WHEN v_cash_dr THEN v.amount_base ELSE 0 END);

    UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;
    UPDATE vouchers SET status = 'POSTED', journal_entry_id = v_je WHERE tenant_id = p_tenant_id AND id = v.id;
    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'POST', 'vouchers', v.id, p_device_info, jsonb_build_object('journal_entry_id', v_je));
    RETURN v_je;
END $$;

-- ----------------------------------------------------------------------------
-- 10.5 post_purchase_invoice  (purchase / purchase return)
--      Cost policy: moving weighted average, 6 decimals.
--        purchase: stock value rises by line_total exactly; avg = (Q*A + line_total) / (Q + q)
--        return  : leaves at the ORIGINAL effective unit cost (line_total / base_qty of the purchased line),
--                  so the supplier credit, the inventory GL and the stock valuation move together.
--      Accounting (net_total = subtotal - discount + tax):
--        purchase: Dr Inventory subtotal, Dr VAT input tax | Cr Cash/Wallet/Suppliers net_total, Cr Discount earned discount
--        return  : the exact mirror
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_purchase_invoice(
    p_tenant_id   UUID,
    p_invoice_id  UUID,
    p_user_id     UUID,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS TABLE (out_invoice_no BIGINT, out_journal_entry_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_inv        purchase_invoices%ROWTYPE;
    v_set        tenant_accounting_settings%ROWTYPE;
    v_can_post   BOOLEAN;
    v_base_cur   UUID;
    v_wh_inv_acc UUID;
    v_line       RECORD;
    v_bal        stock_balances%ROWTYPE;
    v_acc        accounts%ROWTYPE;
    v_sup        parties%ROWTYPE;
    v_cnt        INT;
    v_sum        NUMERIC(18,4);
    v_pay_acc    UUID;
    v_party      UUID;
    v_cost       NUMERIC(18,6);
    v_new_qty    NUMERIC(18,4);
    v_new_avg    NUMERIC(18,6);
    v_je         UUID;
    v_no         BIGINT;
    v_ret        BOOLEAN;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);

    SELECT r.can_post INTO v_can_post
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: User (%) lacks can_post permission', p_user_id;
    END IF;

    SELECT * INTO v_inv FROM purchase_invoices WHERE tenant_id = p_tenant_id AND id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Purchase invoice (%) not found', p_invoice_id; END IF;
    IF v_inv.status = 'POSTED' THEN          -- idempotent replay
        RETURN QUERY SELECT v_inv.invoice_no, v_inv.journal_entry_id;
        RETURN;
    END IF;
    v_ret := v_inv.is_return;

    SELECT * INTO v_set FROM tenant_accounting_settings WHERE tenant_id = p_tenant_id;
    IF v_inv.discount_amount > 0 AND v_set.earned_discount_account_id IS NULL THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: earned_discount_account_id is required for discounts';
    END IF;
    IF v_inv.tax_amount > 0 AND v_set.vat_input_account_id IS NULL THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: vat_input_account_id is required for tax';
    END IF;
    SELECT inventory_account_id INTO v_wh_inv_acc FROM warehouses WHERE tenant_id = p_tenant_id AND id = v_inv.warehouse_id;
    v_base_cur := fn_base_currency(p_tenant_id);
    IF v_base_cur IS NULL THEN RAISE EXCEPTION 'SETTINGS_INCOMPLETE: no base currency'; END IF;

    -- ---- structure ----
    SELECT COUNT(*), COALESCE(SUM(line_total), 0) INTO v_cnt, v_sum
    FROM purchase_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id;
    IF v_cnt = 0 THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Invoice has no lines'; END IF;
    IF EXISTS (SELECT 1 FROM purchase_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id
               AND line_total <> ROUND(qty * unit_price, 4) - line_discount) THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: line_total <> qty * unit_price - line_discount';
    END IF;
    IF EXISTS (SELECT 1 FROM purchase_invoice_lines l
               JOIN items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
               LEFT JOIN item_units iu ON iu.tenant_id = l.tenant_id AND iu.item_id = l.item_id AND iu.unit_id = l.unit_id
               WHERE l.tenant_id = p_tenant_id AND l.invoice_id = v_inv.id
                 AND l.base_qty IS DISTINCT FROM CASE WHEN l.unit_id = i.base_unit_id THEN l.qty
                                                      ELSE ROUND(l.qty * iu.conversion_factor, 4) END) THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: base_qty does not match unit conversion';
    END IF;
    IF v_inv.subtotal <> v_sum THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: subtotal (%) <> sum of lines (%)', v_inv.subtotal, v_sum;
    END IF;
    IF v_inv.discount_amount > v_inv.subtotal THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: discount exceeds subtotal'; END IF;
    IF v_inv.net_total <> v_inv.subtotal - v_inv.discount_amount + v_inv.tax_amount THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: net_total <> subtotal - discount + tax';
    END IF;
    IF v_inv.net_total <= 0 THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: net_total must be positive'; END IF;

    -- ---- settlement account ----
    IF v_inv.payment_method = 'CREDIT' THEN
        IF v_inv.supplier_id IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: Credit purchase requires a supplier_id'; END IF;
        IF v_set.suppliers_control_account_id IS NULL THEN RAISE EXCEPTION 'SETTINGS_INCOMPLETE: suppliers_control_account_id'; END IF;
        v_pay_acc := v_set.suppliers_control_account_id;
    ELSE
        IF v_inv.cash_account_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_INVALID: cash_account_id is required for % payments', v_inv.payment_method; END IF;
        SELECT * INTO v_acc FROM accounts WHERE tenant_id = p_tenant_id AND id = v_inv.cash_account_id;
        IF NOT v_acc.is_analytical OR NOT v_acc.is_active OR v_acc.account_type <> 'ASSET'
           OR v_acc.id IN (v_set.customers_control_account_id, v_set.suppliers_control_account_id) THEN
            RAISE EXCEPTION 'PAYMENT_INVALID: settlement account must be an active analytical cash/wallet/bank ASSET account';
        END IF;
        v_pay_acc := v_inv.cash_account_id;
        IF EXISTS (SELECT 1 FROM pos_shifts WHERE tenant_id = p_tenant_id AND cash_account_id = v_pay_acc) THEN
            RAISE EXCEPTION 'PAYMENT_INVALID: a POS drawer account cannot settle a purchase (use a petty-cash voucher so the shift reconciles)';
        END IF;
    END IF;
    v_party := NULL;
    IF v_inv.supplier_id IS NOT NULL THEN
        SELECT * INTO v_sup FROM parties WHERE tenant_id = p_tenant_id AND id = v_inv.supplier_id;
        IF v_sup.party_type NOT IN ('SUPPLIER', 'BOTH') OR NOT v_sup.is_active THEN
            RAISE EXCEPTION 'PAYMENT_INVALID: party (%) is not an active supplier', v_inv.supplier_id;
        END IF;
        IF v_inv.payment_method = 'CREDIT' THEN v_party := v_inv.supplier_id; END IF;
    END IF;

    -- ---- purchase vs return linkage ----
    IF NOT v_ret THEN
        IF EXISTS (SELECT 1 FROM purchase_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id AND original_line_id IS NOT NULL) THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: original_line_id is only valid on return lines';
        END IF;
    ELSE
        PERFORM 1 FROM purchase_invoices o
        WHERE o.tenant_id = p_tenant_id AND o.id = v_inv.original_invoice_id AND o.status = 'POSTED' AND NOT o.is_return
        FOR UPDATE;                                   -- serialises concurrent returns of one invoice
        IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_INVALID: original invoice must be a POSTED purchase'; END IF;
        IF EXISTS (SELECT 1 FROM document_reversals WHERE tenant_id = p_tenant_id AND source_type = 'PURCHASE_INVOICE' AND source_id = v_inv.original_invoice_id) THEN
            RAISE EXCEPTION 'RETURN_INVALID: original invoice was reversed';
        END IF;
        IF EXISTS (SELECT 1 FROM purchase_invoice_lines l
                   LEFT JOIN purchase_invoice_lines ol ON ol.tenant_id = l.tenant_id AND ol.id = l.original_line_id
                   WHERE l.tenant_id = p_tenant_id AND l.invoice_id = v_inv.id
                     AND (ol.id IS NULL OR ol.invoice_id <> v_inv.original_invoice_id OR ol.item_id <> l.item_id
                          -- must go back at the original effective cost, otherwise a price variance would leak
                          OR ABS(l.line_total - ROUND(l.base_qty * ol.line_total / ol.base_qty, 4)) > 0.0001)) THEN
            RAISE EXCEPTION 'RETURN_INVALID: each return line must reference a line of the original invoice (same item, original cost)';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM (SELECT original_line_id, SUM(base_qty) q FROM purchase_invoice_lines
                  WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id GROUP BY original_line_id) cur
            JOIN purchase_invoice_lines ol ON ol.tenant_id = p_tenant_id AND ol.id = cur.original_line_id
            WHERE cur.q + COALESCE((SELECT SUM(r.base_qty) FROM purchase_invoice_lines r
                                    JOIN purchase_invoices rs ON rs.tenant_id = r.tenant_id AND rs.id = r.invoice_id
                                    WHERE r.tenant_id = p_tenant_id AND r.original_line_id = ol.id
                                      AND rs.status = 'POSTED' AND rs.id <> v_inv.id
                                      AND NOT EXISTS (SELECT 1 FROM document_reversals dr WHERE dr.tenant_id = rs.tenant_id
                                                      AND dr.source_type = 'PURCHASE_INVOICE' AND dr.source_id = rs.id)), 0) > ol.base_qty) THEN
            RAISE EXCEPTION 'RETURN_EXCEEDS_PURCHASED: returned quantity exceeds the quantity purchased';
        END IF;
    END IF;

    -- ---- PASS 1: lock stock rows in deterministic order, check availability for returns ----
    FOR v_line IN SELECT item_id, SUM(base_qty) AS need
                  FROM purchase_invoice_lines WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id
                  GROUP BY item_id ORDER BY item_id LOOP
        INSERT INTO stock_balances (tenant_id, warehouse_id, item_id, qty_on_hand, moving_avg_cost)
        VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 0, 0)
        ON CONFLICT (tenant_id, warehouse_id, item_id) DO NOTHING;
        SELECT * INTO v_bal FROM stock_balances
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id FOR UPDATE;
        IF v_ret AND v_bal.qty_on_hand < v_line.need THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: Item (%) available=%, to return=%', v_line.item_id, v_bal.qty_on_hand, v_line.need;
        END IF;
    END LOOP;

    -- ---- PASS 2: stock movements ----
    FOR v_line IN SELECT l.*, ol.line_total AS o_total, ol.base_qty AS o_qty
                  FROM purchase_invoice_lines l
                  LEFT JOIN purchase_invoice_lines ol ON ol.tenant_id = l.tenant_id AND ol.id = l.original_line_id
                  WHERE l.tenant_id = p_tenant_id AND l.invoice_id = v_inv.id
                  ORDER BY l.item_id, l.id LOOP
        SELECT * INTO v_bal FROM stock_balances
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;

        IF NOT v_ret THEN
            v_cost    := v_line.line_total / v_line.base_qty;
            v_new_qty := v_bal.qty_on_hand + v_line.base_qty;
            v_new_avg := ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost + v_line.line_total) / v_new_qty, 6);
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_in, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'PURCHASE', v_inv.id, v_line.base_qty, ROUND(v_cost, 6), v_line.line_total, v_new_qty, v_new_avg);
        ELSE
            v_cost    := v_line.o_total / v_line.o_qty;
            PERFORM fn_assert_cost_consistent(v_bal.qty_on_hand, v_bal.moving_avg_cost, v_line.base_qty, v_line.line_total);
            v_new_qty := v_bal.qty_on_hand - v_line.base_qty;
            v_new_avg := CASE WHEN v_new_qty > 0
                              THEN GREATEST(ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost - v_line.base_qty * v_cost) / v_new_qty, 6), 0)
                              ELSE v_bal.moving_avg_cost END;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_out, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'PURCHASE_RETURN', v_inv.id, v_line.base_qty, ROUND(v_cost, 6), v_line.line_total, v_new_qty, v_new_avg);
        END IF;
        UPDATE stock_balances SET qty_on_hand = v_new_qty, moving_avg_cost = v_new_avg, updated_at = NOW()
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;
    END LOOP;

    -- ---- journal entry ----
    v_no := fn_next_no(p_tenant_id, v_inv.fiscal_year_id, CASE WHEN v_ret THEN 'PURCHASE_RETURN' ELSE 'PURCHASE' END);
    INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, reference_no, description, status, created_by, device_info)
    VALUES (p_tenant_id, v_inv.branch_id, v_inv.fiscal_year_id, v_inv.invoice_date,
            CASE WHEN v_ret THEN 'PURCHASE_RETURN' ELSE 'PURCHASE' END, v_inv.id, v_inv.reference_no,
            format('%s رقم %s', CASE WHEN v_ret THEN 'مردود مشتريات' ELSE 'فاتورة مشتريات' END, v_no), 'DRAFT', p_user_id, p_device_info)
    RETURNING id INTO v_je;

    -- inventory
    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
    VALUES (p_tenant_id, v_je, v_wh_inv_acc, v_base_cur,
            CASE WHEN NOT v_ret THEN v_inv.subtotal ELSE 0 END, CASE WHEN NOT v_ret THEN v_inv.subtotal ELSE 0 END,
            CASE WHEN v_ret THEN v_inv.subtotal ELSE 0 END,     CASE WHEN v_ret THEN v_inv.subtotal ELSE 0 END);
    -- input VAT
    IF v_inv.tax_amount > 0 THEN
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        VALUES (p_tenant_id, v_je, v_set.vat_input_account_id, v_base_cur,
                CASE WHEN NOT v_ret THEN v_inv.tax_amount ELSE 0 END, CASE WHEN NOT v_ret THEN v_inv.tax_amount ELSE 0 END,
                CASE WHEN v_ret THEN v_inv.tax_amount ELSE 0 END,     CASE WHEN v_ret THEN v_inv.tax_amount ELSE 0 END);
    END IF;
    -- settlement (cash / wallet / bank / supplier)
    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, party_id, currency_id, debit_original, debit_base, credit_original, credit_base)
    VALUES (p_tenant_id, v_je, v_pay_acc, v_party, v_base_cur,
            CASE WHEN v_ret THEN v_inv.net_total ELSE 0 END,     CASE WHEN v_ret THEN v_inv.net_total ELSE 0 END,
            CASE WHEN NOT v_ret THEN v_inv.net_total ELSE 0 END, CASE WHEN NOT v_ret THEN v_inv.net_total ELSE 0 END);
    -- discount earned
    IF v_inv.discount_amount > 0 THEN
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        VALUES (p_tenant_id, v_je, v_set.earned_discount_account_id, v_base_cur,
                CASE WHEN v_ret THEN v_inv.discount_amount ELSE 0 END,     CASE WHEN v_ret THEN v_inv.discount_amount ELSE 0 END,
                CASE WHEN NOT v_ret THEN v_inv.discount_amount ELSE 0 END, CASE WHEN NOT v_ret THEN v_inv.discount_amount ELSE 0 END);
    END IF;

    UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;
    UPDATE purchase_invoices SET status = 'POSTED', invoice_no = v_no, journal_entry_id = v_je WHERE tenant_id = p_tenant_id AND id = v_inv.id;

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'POST', 'purchase_invoices', v_inv.id, p_device_info,
            jsonb_build_object('journal_entry_id', v_je, 'invoice_no', v_no, 'net_total', v_inv.net_total));
    RETURN QUERY SELECT v_no, v_je;
END $$;

-- ----------------------------------------------------------------------------
-- 10.6 post_stock_document : IN / OUT / TRANSFER / ADJUSTMENT / SWAP_ITEM  (S22-S24)
--      Locking: every (warehouse_id, item_id) row touched -- source AND target warehouse, whatever the direction --
--      is locked in ONE global order (warehouse_id, item_id) before anything is read or changed, so two opposite
--      transfers between the same warehouses queue up instead of deadlocking.
--      Accounting (inventory account comes from each warehouse):
--        IN        Dr Inventory               | Cr counter_account
--        OUT       Dr counter_account         | Cr Inventory (at moving average)
--        TRANSFER  Dr target Inventory        | Cr source Inventory   (no entry when both warehouses share one account)
--        ADJUST    surplus: Dr Inventory | Cr stock_adjustment ;  shortage/damaged: Dr stock_adjustment | Cr Inventory
--        SWAP_ITEM no entry (same inventory account); the IN item inherits exactly the value of the OUT item
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_stock_document(
    p_tenant_id   UUID,
    p_doc_id      UUID,
    p_user_id     UUID,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS TABLE (out_doc_no BIGINT, out_journal_entry_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_doc       stock_documents%ROWTYPE;
    v_set       tenant_accounting_settings%ROWTYPE;
    v_can_post  BOOLEAN;
    v_base_cur  UUID;
    v_src_acc   UUID;
    v_dst_acc   UUID;
    v_acc       accounts%ROWTYPE;
    v_cnt       INT;
    v_n_in      INT;
    v_n_out     INT;
    v_k         RECORD;
    v_line      RECORD;
    v_bal       stock_balances%ROWTYPE;
    v_tbal      stock_balances%ROWTYPE;
    v_cost      NUMERIC(18,6);
    v_value     NUMERIC(18,4);
    v_new_qty   NUMERIC(18,4);
    v_new_avg   NUMERIC(18,6);
    v_tot_in    NUMERIC(18,4) := 0;   -- value received (IN docs, surplus)
    v_tot_out   NUMERIC(18,4) := 0;   -- value issued (OUT docs, transfers, shortage)
    v_swap_val  NUMERIC(18,4) := 0;
    v_je        UUID;
    v_no        BIGINT;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);

    SELECT r.can_post INTO v_can_post
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: User (%) lacks can_post permission', p_user_id;
    END IF;

    SELECT * INTO v_doc FROM stock_documents WHERE tenant_id = p_tenant_id AND id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Stock document (%) not found', p_doc_id; END IF;
    IF v_doc.status = 'POSTED' THEN
        RETURN QUERY SELECT v_doc.doc_no, v_doc.journal_entry_id;
        RETURN;
    END IF;

    SELECT * INTO v_set FROM tenant_accounting_settings WHERE tenant_id = p_tenant_id;
    v_base_cur := fn_base_currency(p_tenant_id);
    IF v_base_cur IS NULL THEN RAISE EXCEPTION 'SETTINGS_INCOMPLETE: no base currency'; END IF;
    SELECT inventory_account_id INTO v_src_acc FROM warehouses WHERE tenant_id = p_tenant_id AND id = v_doc.warehouse_id AND is_active;
    IF v_src_acc IS NULL THEN RAISE EXCEPTION 'STOCK_DOC_INVALID: source warehouse is missing or inactive'; END IF;
    IF v_doc.doc_type = 'TRANSFER' THEN
        SELECT inventory_account_id INTO v_dst_acc FROM warehouses WHERE tenant_id = p_tenant_id AND id = v_doc.target_warehouse_id AND is_active;
        IF v_dst_acc IS NULL THEN RAISE EXCEPTION 'STOCK_DOC_INVALID: target warehouse is missing or inactive'; END IF;
    END IF;

    -- ---- structure ----
    SELECT COUNT(*), COUNT(*) FILTER (WHERE direction = 'IN'), COUNT(*) FILTER (WHERE direction = 'OUT')
    INTO v_cnt, v_n_in, v_n_out FROM stock_document_lines WHERE tenant_id = p_tenant_id AND document_id = v_doc.id;
    IF v_cnt = 0 THEN RAISE EXCEPTION 'STOCK_DOC_INVALID: document has no lines'; END IF;

    IF EXISTS (SELECT 1 FROM stock_document_lines l
               JOIN items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
               LEFT JOIN item_units iu ON iu.tenant_id = l.tenant_id AND iu.item_id = l.item_id AND iu.unit_id = l.unit_id
               WHERE l.tenant_id = p_tenant_id AND l.document_id = v_doc.id
                 AND l.base_qty IS DISTINCT FROM CASE WHEN l.unit_id = i.base_unit_id THEN l.qty
                                                      ELSE ROUND(l.qty * iu.conversion_factor, 4) END) THEN
        RAISE EXCEPTION 'STOCK_DOC_INVALID: base_qty does not match unit conversion';
    END IF;

    CASE v_doc.doc_type
        WHEN 'IN' THEN
            IF v_n_out > 0 THEN RAISE EXCEPTION 'STOCK_DOC_INVALID: IN document cannot contain OUT lines'; END IF;
            IF EXISTS (SELECT 1 FROM stock_document_lines WHERE tenant_id = p_tenant_id AND document_id = v_doc.id AND unit_cost <= 0) THEN
                RAISE EXCEPTION 'STOCK_DOC_INVALID: IN lines require a unit_cost > 0';
            END IF;
        WHEN 'OUT', 'TRANSFER' THEN
            IF v_n_in > 0 THEN RAISE EXCEPTION 'STOCK_DOC_INVALID: % document cannot contain IN lines', v_doc.doc_type; END IF;
        WHEN 'ADJUSTMENT' THEN
            IF v_doc.notes IS NULL OR length(btrim(v_doc.notes)) = 0 THEN
                RAISE EXCEPTION 'STOCK_DOC_INVALID: an adjustment requires a documented reason in notes';
            END IF;
            IF v_set.stock_adjustment_account_id IS NULL THEN RAISE EXCEPTION 'SETTINGS_INCOMPLETE: stock_adjustment_account_id'; END IF;
        WHEN 'SWAP_ITEM' THEN
            IF v_n_in <> 1 OR v_n_out <> 1 THEN RAISE EXCEPTION 'STOCK_DOC_INVALID: SWAP_ITEM needs exactly one OUT line and one IN line'; END IF;
            IF (SELECT COUNT(DISTINCT item_id) FROM stock_document_lines WHERE tenant_id = p_tenant_id AND document_id = v_doc.id) <> 2 THEN
                RAISE EXCEPTION 'STOCK_DOC_INVALID: SWAP_ITEM must exchange two different items';
            END IF;
    END CASE;

    IF v_doc.doc_type IN ('IN', 'OUT') THEN
        SELECT * INTO v_acc FROM accounts WHERE tenant_id = p_tenant_id AND id = v_doc.counter_account_id;
        IF NOT FOUND OR NOT v_acc.is_analytical OR NOT v_acc.is_active
           OR v_acc.id IN (v_set.customers_control_account_id, v_set.suppliers_control_account_id)
           OR EXISTS (SELECT 1 FROM warehouses WHERE tenant_id = p_tenant_id AND inventory_account_id = v_acc.id) THEN
            RAISE EXCEPTION 'STOCK_DOC_INVALID: counter_account_id must be an active analytical account that is not an inventory or control account';
        END IF;
    END IF;

    -- ---- PASS 1: lock every (warehouse, item) in ONE global order and check availability ----
    FOR v_k IN
        SELECT x.w AS wh, x.item_id, SUM(x.o) AS need
        FROM (SELECT v_doc.warehouse_id AS w, item_id, CASE WHEN direction = 'OUT' THEN base_qty ELSE 0 END AS o
              FROM stock_document_lines WHERE tenant_id = p_tenant_id AND document_id = v_doc.id
              UNION ALL
              SELECT v_doc.target_warehouse_id, item_id, 0
              FROM stock_document_lines WHERE tenant_id = p_tenant_id AND document_id = v_doc.id AND v_doc.doc_type = 'TRANSFER') x
        GROUP BY x.w, x.item_id ORDER BY x.w, x.item_id
    LOOP
        INSERT INTO stock_balances (tenant_id, warehouse_id, item_id, qty_on_hand, moving_avg_cost)
        VALUES (p_tenant_id, v_k.wh, v_k.item_id, 0, 0) ON CONFLICT (tenant_id, warehouse_id, item_id) DO NOTHING;
        SELECT * INTO v_bal FROM stock_balances WHERE tenant_id = p_tenant_id AND warehouse_id = v_k.wh AND item_id = v_k.item_id FOR UPDATE;
        IF v_k.need > v_bal.qty_on_hand THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: Item (%) in warehouse (%) available=%, requested=%', v_k.item_id, v_k.wh, v_bal.qty_on_hand, v_k.need;
        END IF;
    END LOOP;

    -- ---- PASS 2: apply (OUT lines first so a SWAP knows the value it must carry over) ----
    FOR v_line IN SELECT * FROM stock_document_lines WHERE tenant_id = p_tenant_id AND document_id = v_doc.id
                  ORDER BY (direction = 'OUT') DESC, item_id, id LOOP
        SELECT * INTO v_bal FROM stock_balances WHERE tenant_id = p_tenant_id AND warehouse_id = v_doc.warehouse_id AND item_id = v_line.item_id;

        IF v_line.direction = 'OUT' THEN
            v_cost    := v_bal.moving_avg_cost;
            v_value   := ROUND(v_line.base_qty * v_cost, 4);
            v_new_qty := v_bal.qty_on_hand - v_line.base_qty;
            UPDATE stock_balances SET qty_on_hand = v_new_qty, updated_at = NOW()
            WHERE tenant_id = p_tenant_id AND warehouse_id = v_doc.warehouse_id AND item_id = v_line.item_id;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_out, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_doc.warehouse_id, v_line.item_id,
                    CASE v_doc.doc_type WHEN 'TRANSFER' THEN 'TRANSFER_OUT' ELSE 'STOCK_' || v_doc.doc_type::text END,
                    v_doc.id, v_line.base_qty, v_cost, v_value, v_new_qty, v_bal.moving_avg_cost);
            UPDATE stock_document_lines SET unit_cost = v_cost WHERE tenant_id = p_tenant_id AND id = v_line.id;
            v_tot_out := v_tot_out + v_value;
            IF v_doc.doc_type = 'SWAP_ITEM' THEN v_swap_val := v_value; END IF;

            IF v_doc.doc_type = 'TRANSFER' THEN        -- receive at the target warehouse with a re-average
                SELECT * INTO v_tbal FROM stock_balances WHERE tenant_id = p_tenant_id AND warehouse_id = v_doc.target_warehouse_id AND item_id = v_line.item_id;
                v_new_qty := v_tbal.qty_on_hand + v_line.base_qty;
                v_new_avg := ROUND((v_tbal.qty_on_hand * v_tbal.moving_avg_cost + v_value) / v_new_qty, 6);
                UPDATE stock_balances SET qty_on_hand = v_new_qty, moving_avg_cost = v_new_avg, updated_at = NOW()
                WHERE tenant_id = p_tenant_id AND warehouse_id = v_doc.target_warehouse_id AND item_id = v_line.item_id;
                INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_in, unit_cost, total_cost, running_qty, moving_avg_cost)
                VALUES (p_tenant_id, v_doc.target_warehouse_id, v_line.item_id, 'TRANSFER_IN', v_doc.id, v_line.base_qty, v_cost, v_value, v_new_qty, v_new_avg);
            END IF;
        ELSE
            -- IN: explicit cost (IN doc) | value carried over (SWAP) | current average (ADJUSTMENT surplus; explicit cost only if avg = 0)
            IF v_doc.doc_type = 'SWAP_ITEM' THEN
                v_value := v_swap_val;
            ELSIF v_doc.doc_type = 'ADJUSTMENT' THEN
                v_value := ROUND(v_line.base_qty * CASE WHEN v_bal.moving_avg_cost > 0 THEN v_bal.moving_avg_cost ELSE v_line.unit_cost END, 4);
            ELSE
                v_value := ROUND(v_line.base_qty * v_line.unit_cost, 4);
            END IF;
            v_cost    := v_value / v_line.base_qty;
            v_new_qty := v_bal.qty_on_hand + v_line.base_qty;
            v_new_avg := ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost + v_value) / v_new_qty, 6);
            UPDATE stock_balances SET qty_on_hand = v_new_qty, moving_avg_cost = v_new_avg, updated_at = NOW()
            WHERE tenant_id = p_tenant_id AND warehouse_id = v_doc.warehouse_id AND item_id = v_line.item_id;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_in, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_doc.warehouse_id, v_line.item_id, 'STOCK_' || v_doc.doc_type::text, v_doc.id, v_line.base_qty, ROUND(v_cost, 6), v_value, v_new_qty, v_new_avg);
            IF v_doc.doc_type <> 'IN' THEN
                UPDATE stock_document_lines SET unit_cost = ROUND(v_cost, 6) WHERE tenant_id = p_tenant_id AND id = v_line.id;
            END IF;
            v_tot_in := v_tot_in + v_value;
        END IF;
    END LOOP;

    IF v_doc.doc_type = 'SWAP_ITEM' AND v_tot_in <> v_tot_out THEN
        RAISE EXCEPTION 'STOCK_DOC_INVALID: swap value mismatch (in %, out %)', v_tot_in, v_tot_out;   -- cannot happen; guards the invariant
    END IF;

    -- ---- journal entry (only when value actually moves between GL accounts) ----
    IF (v_doc.doc_type = 'IN' AND v_tot_in > 0)
       OR (v_doc.doc_type = 'OUT' AND v_tot_out > 0)
       OR (v_doc.doc_type = 'TRANSFER' AND v_tot_out > 0 AND v_src_acc <> v_dst_acc)
       OR (v_doc.doc_type = 'ADJUSTMENT' AND (v_tot_in > 0 OR v_tot_out > 0)) THEN

        v_no := NULL;
        INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, reference_no, description, status, created_by, device_info)
        VALUES (p_tenant_id, v_doc.branch_id, v_doc.fiscal_year_id, v_doc.doc_date, 'STOCK_' || v_doc.doc_type::text, v_doc.id, v_doc.reference_no,
                format('مستند مخزني %s', v_doc.doc_type), 'DRAFT', p_user_id, p_device_info)
        RETURNING id INTO v_je;

        IF v_doc.doc_type = 'IN' THEN
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base) VALUES (p_tenant_id, v_je, v_src_acc, v_base_cur, v_tot_in, v_tot_in);
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base) VALUES (p_tenant_id, v_je, v_doc.counter_account_id, v_base_cur, v_tot_in, v_tot_in);
        ELSIF v_doc.doc_type = 'OUT' THEN
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base) VALUES (p_tenant_id, v_je, v_doc.counter_account_id, v_base_cur, v_tot_out, v_tot_out);
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base) VALUES (p_tenant_id, v_je, v_src_acc, v_base_cur, v_tot_out, v_tot_out);
        ELSIF v_doc.doc_type = 'TRANSFER' THEN
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base) VALUES (p_tenant_id, v_je, v_dst_acc, v_base_cur, v_tot_out, v_tot_out);
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base) VALUES (p_tenant_id, v_je, v_src_acc, v_base_cur, v_tot_out, v_tot_out);
        ELSE   -- ADJUSTMENT
            IF v_tot_in > 0 THEN
                INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base) VALUES (p_tenant_id, v_je, v_src_acc, v_base_cur, v_tot_in, v_tot_in);
                INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base) VALUES (p_tenant_id, v_je, v_set.stock_adjustment_account_id, v_base_cur, v_tot_in, v_tot_in);
            END IF;
            IF v_tot_out > 0 THEN
                INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base) VALUES (p_tenant_id, v_je, v_set.stock_adjustment_account_id, v_base_cur, v_tot_out, v_tot_out);
                INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base) VALUES (p_tenant_id, v_je, v_src_acc, v_base_cur, v_tot_out, v_tot_out);
            END IF;
        END IF;
        UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;
    END IF;

    v_no := fn_next_no(p_tenant_id, v_doc.fiscal_year_id, 'STOCK_' || v_doc.doc_type::text);
    UPDATE stock_documents SET status = 'POSTED', doc_no = v_no, journal_entry_id = v_je WHERE tenant_id = p_tenant_id AND id = v_doc.id;

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'POST', 'stock_documents', v_doc.id, p_device_info,
            jsonb_build_object('doc_type', v_doc.doc_type, 'doc_no', v_no, 'journal_entry_id', v_je, 'value_in', v_tot_in, 'value_out', v_tot_out));
    RETURN QUERY SELECT v_no, v_je;
END $$;

-- ----------------------------------------------------------------------------
-- 10.7 reverse_voucher : mirror entry; a voucher that moved a POS drawer is reversed inside an OPEN shift of the SAME drawer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_voucher(
    p_tenant_id   UUID,
    p_voucher_id  UUID,
    p_user_id     UUID,
    p_reason      TEXT,
    p_shift_id    UUID DEFAULT NULL,
    p_date        DATE DEFAULT CURRENT_DATE,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_can_rev  BOOLEAN;
    v          vouchers%ROWTYPE;
    v_shift    pos_shifts%ROWTYPE;
    v_fy       UUID;
    v_je       UUID;
    v_orig_je  journal_entries%ROWTYPE;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_reverse INTO v_can_rev
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_rev IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: User (%) lacks can_reverse permission', p_user_id;
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: a reason is required';
    END IF;

    SELECT * INTO v FROM vouchers WHERE tenant_id = p_tenant_id AND id = p_voucher_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: voucher (%)', p_voucher_id; END IF;
    IF v.status <> 'POSTED' THEN RAISE EXCEPTION 'REVERSAL_INVALID: only POSTED vouchers can be reversed'; END IF;
    IF EXISTS (SELECT 1 FROM document_reversals WHERE tenant_id = p_tenant_id AND source_type = 'VOUCHER' AND source_id = v.id) THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: voucher already reversed';
    END IF;
    IF p_date < v.voucher_date THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: reversal date (%) is before the voucher date (%)', p_date, v.voucher_date;
    END IF;

    v_fy := fn_fiscal_year_for(p_tenant_id, p_date);
    IF v_fy IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: no open fiscal year for %', p_date; END IF;

    IF v.shift_id IS NOT NULL THEN
        IF p_shift_id IS NULL THEN RAISE EXCEPTION 'REVERSAL_INVALID: reversing a drawer voucher requires an OPEN shift'; END IF;
        SELECT * INTO v_shift FROM pos_shifts WHERE tenant_id = p_tenant_id AND id = p_shift_id FOR SHARE;
        IF NOT FOUND OR v_shift.status <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_CLOSED: reversal needs an OPEN shift'; END IF;
        IF v_shift.cash_account_id <> v.cash_account_id THEN
            RAISE EXCEPTION 'REVERSAL_INVALID: shift drawer differs from the voucher cash account';
        END IF;
    ELSIF p_shift_id IS NOT NULL THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: this voucher was not issued in a shift; do not pass a shift';
    END IF;

    SELECT * INTO v_orig_je FROM journal_entries WHERE tenant_id = p_tenant_id AND id = v.journal_entry_id;
    INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description,
                                 status, reverses_entry_id, created_by, device_info)
    VALUES (p_tenant_id, v.branch_id, v_fy, p_date, 'VOUCHER_REVERSAL', v.id,
            format('عكس سند %s رقم %s: %s', v.voucher_type, v.voucher_no, p_reason), 'DRAFT', v_orig_je.id, p_user_id, p_device_info)
    RETURNING id INTO v_je;

    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, cost_center_id, party_id, currency_id, exchange_rate,
                               debit_original, credit_original, debit_base, credit_base, line_description)
    SELECT tenant_id, v_je, account_id, cost_center_id, party_id, currency_id, exchange_rate,
           credit_original, debit_original, credit_base, debit_base, line_description
    FROM journal_lines WHERE tenant_id = p_tenant_id AND journal_entry_id = v_orig_je.id;

    UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;

    INSERT INTO document_reversals (tenant_id, source_type, source_id, reversal_journal_entry_id, shift_id, reversal_date, reason, reversed_by)
    VALUES (p_tenant_id, 'VOUCHER', v.id, v_je, p_shift_id, p_date, p_reason, p_user_id);

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'REVERSE', 'vouchers', v.id, p_device_info,
            jsonb_build_object('reversal_journal_entry_id', v_je, 'reason', p_reason));
    RETURN v_je;
END $$;

-- ----------------------------------------------------------------------------
-- 10.8 reverse_purchase_invoice : journal mirror + stock, at the cost the document itself moved
--      purchase  reversal : goods leave again at line_total / base_qty   (needs the stock to still be there)
--      return    reversal : goods come back at the ORIGINAL effective cost
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_purchase_invoice(
    p_tenant_id   UUID,
    p_invoice_id  UUID,
    p_user_id     UUID,
    p_reason      TEXT,
    p_date        DATE DEFAULT CURRENT_DATE,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_can_rev  BOOLEAN;
    v_inv      purchase_invoices%ROWTYPE;
    v_line     RECORD;
    v_bal      stock_balances%ROWTYPE;
    v_fy       UUID;
    v_je       UUID;
    v_orig_je  journal_entries%ROWTYPE;
    v_cost     NUMERIC(18,6);
    v_new_qty  NUMERIC(18,4);
    v_new_avg  NUMERIC(18,6);
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_reverse INTO v_can_rev
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_rev IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: User (%) lacks can_reverse permission', p_user_id;
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: a reason is required';
    END IF;

    SELECT * INTO v_inv FROM purchase_invoices WHERE tenant_id = p_tenant_id AND id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Purchase invoice (%)', p_invoice_id; END IF;
    IF v_inv.status <> 'POSTED' THEN RAISE EXCEPTION 'REVERSAL_INVALID: only POSTED invoices can be reversed'; END IF;
    IF EXISTS (SELECT 1 FROM document_reversals WHERE tenant_id = p_tenant_id AND source_type = 'PURCHASE_INVOICE' AND source_id = v_inv.id) THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: invoice already reversed';
    END IF;
    IF p_date < v_inv.invoice_date THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: reversal date (%) is before the invoice date (%)', p_date, v_inv.invoice_date;
    END IF;
    IF NOT v_inv.is_return AND EXISTS (
           SELECT 1 FROM purchase_invoices r WHERE r.tenant_id = p_tenant_id AND r.original_invoice_id = v_inv.id AND r.status = 'POSTED'
             AND NOT EXISTS (SELECT 1 FROM document_reversals dr WHERE dr.tenant_id = r.tenant_id AND dr.source_type = 'PURCHASE_INVOICE' AND dr.source_id = r.id)) THEN
        RAISE EXCEPTION 'REVERSAL_INVALID: invoice has posted returns; reverse the returns first';
    END IF;
    IF v_inv.is_return THEN       -- serialise against a concurrent reversal / return of the same original, and keep it consistent
        PERFORM 1 FROM purchase_invoices o WHERE o.tenant_id = p_tenant_id AND o.id = v_inv.original_invoice_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM document_reversals WHERE tenant_id = p_tenant_id AND source_type = 'PURCHASE_INVOICE' AND source_id = v_inv.original_invoice_id) THEN
            RAISE EXCEPTION 'REVERSAL_INVALID: the original purchase was reversed';
        END IF;
    END IF;

    v_fy := fn_fiscal_year_for(p_tenant_id, p_date);
    IF v_fy IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: no open fiscal year for %', p_date; END IF;

    -- PASS 1: lock stock rows in a fixed order and check that the goods can leave
    FOR v_line IN SELECT item_id, SUM(base_qty) AS q FROM purchase_invoice_lines
                  WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id GROUP BY item_id ORDER BY item_id LOOP
        INSERT INTO stock_balances (tenant_id, warehouse_id, item_id, qty_on_hand, moving_avg_cost)
        VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 0, 0) ON CONFLICT (tenant_id, warehouse_id, item_id) DO NOTHING;
        SELECT * INTO v_bal FROM stock_balances
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id FOR UPDATE;
        IF NOT v_inv.is_return AND v_bal.qty_on_hand < v_line.q THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: cannot reverse purchase, item % available %, needed % (goods were already sold or moved)',
                            v_line.item_id, v_bal.qty_on_hand, v_line.q;
        END IF;
    END LOOP;

    -- PASS 2: apply
    FOR v_line IN SELECT l.*, ol.line_total AS o_total, ol.base_qty AS o_qty
                  FROM purchase_invoice_lines l
                  LEFT JOIN purchase_invoice_lines ol ON ol.tenant_id = l.tenant_id AND ol.id = l.original_line_id
                  WHERE l.tenant_id = p_tenant_id AND l.invoice_id = v_inv.id ORDER BY l.item_id, l.id LOOP
        SELECT * INTO v_bal FROM stock_balances
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;
        IF NOT v_inv.is_return THEN           -- undo a purchase: goods leave at the cost they came in at
            PERFORM fn_assert_cost_consistent(v_bal.qty_on_hand, v_bal.moving_avg_cost, v_line.base_qty, v_line.line_total);
            v_cost    := v_line.line_total / v_line.base_qty;
            v_new_qty := v_bal.qty_on_hand - v_line.base_qty;
            v_new_avg := CASE WHEN v_new_qty > 0
                              THEN GREATEST(ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost - v_line.line_total) / v_new_qty, 6), 0)
                              ELSE v_bal.moving_avg_cost END;
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_out, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'PURCHASE_REVERSAL', v_inv.id, v_line.base_qty, ROUND(v_cost, 6), v_line.line_total, v_new_qty, v_new_avg);
        ELSE                                   -- undo a return: goods come back at the original effective cost
            v_cost    := v_line.o_total / v_line.o_qty;
            v_new_qty := v_bal.qty_on_hand + v_line.base_qty;
            v_new_avg := ROUND((v_bal.qty_on_hand * v_bal.moving_avg_cost + v_line.line_total) / v_new_qty, 6);
            INSERT INTO stock_ledger (tenant_id, warehouse_id, item_id, source_type, source_id, qty_in, unit_cost, total_cost, running_qty, moving_avg_cost)
            VALUES (p_tenant_id, v_inv.warehouse_id, v_line.item_id, 'PURCHASE_RETURN_REVERSAL', v_inv.id, v_line.base_qty, ROUND(v_cost, 6), v_line.line_total, v_new_qty, v_new_avg);
        END IF;
        UPDATE stock_balances SET qty_on_hand = v_new_qty, moving_avg_cost = v_new_avg, updated_at = NOW()
        WHERE tenant_id = p_tenant_id AND warehouse_id = v_inv.warehouse_id AND item_id = v_line.item_id;
    END LOOP;

    SELECT * INTO v_orig_je FROM journal_entries WHERE tenant_id = p_tenant_id AND id = v_inv.journal_entry_id;
    INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description,
                                 status, reverses_entry_id, created_by, device_info)
    VALUES (p_tenant_id, v_inv.branch_id, v_fy, p_date, 'PURCHASE_REVERSAL', v_inv.id,
            format('عكس %s رقم %s: %s', CASE WHEN v_inv.is_return THEN 'مردود مشتريات' ELSE 'فاتورة مشتريات' END, v_inv.invoice_no, p_reason),
            'DRAFT', v_orig_je.id, p_user_id, p_device_info)
    RETURNING id INTO v_je;

    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, cost_center_id, party_id, currency_id, exchange_rate,
                               debit_original, credit_original, debit_base, credit_base, line_description)
    SELECT tenant_id, v_je, account_id, cost_center_id, party_id, currency_id, exchange_rate,
           credit_original, debit_original, credit_base, debit_base, line_description
    FROM journal_lines WHERE tenant_id = p_tenant_id AND journal_entry_id = v_orig_je.id;

    UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;

    INSERT INTO document_reversals (tenant_id, source_type, source_id, reversal_journal_entry_id, reversal_date, reason, reversed_by)
    VALUES (p_tenant_id, 'PURCHASE_INVOICE', v_inv.id, v_je, p_date, p_reason, p_user_id);

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'REVERSE', 'purchase_invoices', v_inv.id, p_device_info,
            jsonb_build_object('reversal_journal_entry_id', v_je, 'reason', p_reason));
    RETURN v_je;
END $$;

-- ============================================================================
-- 10.9 YEAR-END: close_fiscal_year / reopen_fiscal_year
--   close : 1) closing entry (dated the last day) zeroes every REVENUE / EXPENSE account into retained earnings
--           2) opening entry (dated the first day of the next year) carries every ASSET / LIABILITY / EQUITY balance,
--              kept per account + party + currency so customer/supplier sub-ledgers and foreign-currency drawers survive
--           3) the year is locked (no further posting of any kind)
--   reopen: mirrors both entries and unlocks the year; refused once the next year has real activity.
-- ============================================================================
CREATE TABLE fiscal_year_closings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    fiscal_year_id      UUID NOT NULL,
    next_fiscal_year_id UUID NOT NULL,
    closing_entry_id    UUID,            -- NULL when the year had no income-statement activity
    opening_entry_id    UUID,            -- NULL when there were no balances to carry
    net_result          NUMERIC(18, 4) NOT NULL,   -- profit (+) / loss (-)
    closed_by           UUID NOT NULL,
    closed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reopened_by         UUID,
    reopened_at         TIMESTAMPTZ,
    reopen_reason       TEXT,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, fiscal_year_id)      REFERENCES fiscal_years(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, next_fiscal_year_id) REFERENCES fiscal_years(tenant_id, id)    ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, closing_entry_id)    REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, opening_entry_id)    REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, closed_by)           REFERENCES users(tenant_id, id)           ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, reopened_by)         REFERENCES users(tenant_id, id)           ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_active_year_closing ON fiscal_year_closings(tenant_id, fiscal_year_id) WHERE reopened_at IS NULL;

-- Fiscal-year guard: no overlapping years, closed years are frozen, and open<->closed flips only through the two functions
CREATE OR REPLACE FUNCTION fn_guard_fiscal_year() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_flag TEXT := COALESCE(current_setting('erp.fy_op', TRUE), '');
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_closed THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: a closed fiscal year cannot be deleted'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.is_closed AND NEW.is_closed THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: fiscal year (%) is closed and immutable', OLD.id;
        END IF;
        IF OLD.is_closed AND NOT NEW.is_closed AND v_flag <> 'reopen' THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: a fiscal year is reopened only through reopen_fiscal_year()';
        END IF;
        IF NOT OLD.is_closed AND NEW.is_closed AND v_flag <> 'close' THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: a fiscal year is closed only through close_fiscal_year()';
        END IF;
        IF (NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date)
           AND EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id = OLD.tenant_id AND fiscal_year_id = OLD.id) THEN
            RAISE EXCEPTION 'ACCOUNTING_VIOLATION: dates of a fiscal year with journal entries cannot change';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM fiscal_years f
               WHERE f.tenant_id = NEW.tenant_id AND f.id <> NEW.id
                 AND NOT (f.end_date < NEW.start_date OR f.start_date > NEW.end_date)) THEN
        RAISE EXCEPTION 'ACCOUNTING_VIOLATION: fiscal year % overlaps an existing fiscal year', NEW.name;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_fiscal_year_guard BEFORE INSERT OR UPDATE OR DELETE ON fiscal_years
FOR EACH ROW EXECUTE FUNCTION fn_guard_fiscal_year();

CREATE OR REPLACE FUNCTION close_fiscal_year(
    p_tenant_id   UUID,
    p_fy_id       UUID,
    p_user_id     UUID,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_ok        BOOLEAN;
    v_fy        fiscal_years%ROWTYPE;
    v_next      fiscal_years%ROWTYPE;
    v_set       tenant_accounting_settings%ROWTYPE;
    v_re        accounts%ROWTYPE;
    v_branch    UUID;
    v_base_cur  UUID;
    v_cl_je     UUID;
    v_op_je     UUID;
    v_net_dr    NUMERIC(18,4);       -- net debit of all P&L accounts: > 0 loss, < 0 profit
    v_n_closed  INT := 0;
    v_n_open    INT := 0;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT (r.can_post AND r.can_reverse) INTO v_ok
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_ok IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: closing a fiscal year requires both can_post and can_reverse';
    END IF;

    -- exclusive lock: waits for every in-flight posting (they hold FOR SHARE), blocks the new ones
    SELECT * INTO v_fy FROM fiscal_years WHERE tenant_id = p_tenant_id AND id = p_fy_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: fiscal year (%)', p_fy_id; END IF;
    IF v_fy.is_closed THEN RAISE EXCEPTION 'YEAR_CLOSE_INVALID: fiscal year % is already closed', v_fy.name; END IF;

    IF EXISTS (SELECT 1 FROM fiscal_years WHERE tenant_id = p_tenant_id AND end_date < v_fy.start_date AND NOT is_closed) THEN
        RAISE EXCEPTION 'YEAR_CLOSE_INVALID: an earlier fiscal year is still open; close years in order';
    END IF;
    SELECT * INTO v_next FROM fiscal_years WHERE tenant_id = p_tenant_id AND start_date = v_fy.end_date + 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'YEAR_CLOSE_INVALID: the next fiscal year (starting %) does not exist; create it first', v_fy.end_date + 1; END IF;
    IF v_next.is_closed THEN RAISE EXCEPTION 'YEAR_CLOSE_INVALID: the next fiscal year is already closed'; END IF;

    -- nothing may be left half-done
    IF EXISTS (SELECT 1 FROM journal_entries   WHERE tenant_id = p_tenant_id AND fiscal_year_id = p_fy_id AND status = 'DRAFT')
    OR EXISTS (SELECT 1 FROM sales_invoices    WHERE tenant_id = p_tenant_id AND fiscal_year_id = p_fy_id AND status = 'DRAFT' AND sync_status <> 'REJECTED')
    OR EXISTS (SELECT 1 FROM purchase_invoices WHERE tenant_id = p_tenant_id AND fiscal_year_id = p_fy_id AND status = 'DRAFT')
    OR EXISTS (SELECT 1 FROM vouchers          WHERE tenant_id = p_tenant_id AND fiscal_year_id = p_fy_id AND status = 'DRAFT')
    OR EXISTS (SELECT 1 FROM stock_documents   WHERE tenant_id = p_tenant_id AND fiscal_year_id = p_fy_id AND status = 'DRAFT') THEN
        RAISE EXCEPTION 'YEAR_CLOSE_INVALID: draft documents / entries (including pending sync conflicts) exist in fiscal year %; post or delete them first', v_fy.name;
    END IF;
    IF EXISTS (SELECT 1 FROM pos_shifts WHERE tenant_id = p_tenant_id AND status = 'OPEN') THEN
        RAISE EXCEPTION 'YEAR_CLOSE_INVALID: close every open POS shift first';
    END IF;

    SELECT * INTO v_set FROM tenant_accounting_settings WHERE tenant_id = p_tenant_id;
    SELECT * INTO v_re FROM accounts WHERE tenant_id = p_tenant_id AND id = v_set.retained_earnings_account_id;
    IF NOT FOUND OR v_re.account_type <> 'EQUITY' OR NOT v_re.is_analytical OR NOT v_re.is_active THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: retained_earnings_account_id must be an active analytical EQUITY account';
    END IF;
    v_base_cur := fn_base_currency(p_tenant_id);
    IF v_base_cur IS NULL THEN RAISE EXCEPTION 'SETTINGS_INCOMPLETE: no base currency'; END IF;
    SELECT id INTO v_branch FROM branches WHERE tenant_id = p_tenant_id ORDER BY created_at, id LIMIT 1;
    IF v_branch IS NULL THEN RAISE EXCEPTION 'SETTINGS_INCOMPLETE: no branch'; END IF;

    -- ---------------- 1) closing entry ----------------
    CREATE TEMP TABLE IF NOT EXISTS _fy_pl (account_id UUID, net NUMERIC(18,4)) ON COMMIT DROP;
    TRUNCATE _fy_pl;
    INSERT INTO _fy_pl
    SELECT jl.account_id, SUM(jl.debit_base - jl.credit_base)
    FROM journal_lines jl
    JOIN journal_entries je ON je.tenant_id = jl.tenant_id AND je.id = jl.journal_entry_id
    JOIN accounts a         ON a.tenant_id = jl.tenant_id  AND a.id = jl.account_id
    WHERE jl.tenant_id = p_tenant_id AND je.fiscal_year_id = p_fy_id AND je.status = 'POSTED'
      AND a.account_type IN ('REVENUE', 'EXPENSE')
    GROUP BY jl.account_id HAVING SUM(jl.debit_base - jl.credit_base) <> 0;
    SELECT COUNT(*), COALESCE(SUM(net), 0) INTO v_n_closed, v_net_dr FROM _fy_pl;

    IF v_n_closed > 0 THEN
        INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description, status, created_by, device_info)
        VALUES (p_tenant_id, v_branch, p_fy_id, v_fy.end_date, 'YEAR_CLOSING', p_fy_id,
                format('قيد إقفال السنة المالية %s', v_fy.name), 'DRAFT', p_user_id, p_device_info)
        RETURNING id INTO v_cl_je;
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
        SELECT p_tenant_id, v_cl_je, account_id, v_base_cur,
               CASE WHEN net < 0 THEN -net ELSE 0 END, CASE WHEN net < 0 THEN -net ELSE 0 END,
               CASE WHEN net > 0 THEN  net ELSE 0 END, CASE WHEN net > 0 THEN  net ELSE 0 END
        FROM _fy_pl;
        IF v_net_dr <> 0 THEN      -- the result goes to retained earnings: loss = debit, profit = credit
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base, line_description)
            VALUES (p_tenant_id, v_cl_je, v_re.id, v_base_cur,
                    GREATEST(v_net_dr, 0), GREATEST(v_net_dr, 0), GREATEST(-v_net_dr, 0), GREATEST(-v_net_dr, 0),
                    CASE WHEN v_net_dr < 0 THEN 'صافي ربح السنة' ELSE 'صافي خسارة السنة' END);
        END IF;
        UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_cl_je;
    END IF;

    -- ---------------- 2) opening entry for the next year ----------------
    -- cumulative balances of every balance-sheet account up to the end of this year (closing entry included),
    -- per account + party + currency. A foreign-currency line is kept in its currency only when original x rate = base exactly;
    -- anything else is carried in the base currency.
    CREATE TEMP TABLE IF NOT EXISTS _fy_bs (account_id UUID, party_id UUID, currency_id UUID, rate NUMERIC(18,6), side CHAR(1), amt_orig NUMERIC(18,4), amt_base NUMERIC(18,4)) ON COMMIT DROP;
    TRUNCATE _fy_bs;
    INSERT INTO _fy_bs
    SELECT g.account_id, g.party_id,
           CASE WHEN keep THEN g.currency_id ELSE v_base_cur END,
           CASE WHEN keep THEN ROUND(ABS(g.nb) / ABS(g.no), 6) ELSE 1 END,
           CASE WHEN g.nb > 0 THEN 'D' ELSE 'C' END,
           CASE WHEN keep THEN ABS(g.no) ELSE ABS(g.nb) END,
           ABS(g.nb)
    FROM (SELECT x.*, (x.currency_id <> v_base_cur AND x.no <> 0 AND SIGN(x.no) = SIGN(x.nb)
                       AND ABS(ROUND(ABS(x.no) * ROUND(ABS(x.nb) / ABS(x.no), 6), 4) - ABS(x.nb)) <= 0.0001) AS keep
          FROM (SELECT jl.account_id, jl.party_id, jl.currency_id,
                       SUM(jl.debit_original - jl.credit_original) AS no, SUM(jl.debit_base - jl.credit_base) AS nb
                FROM journal_lines jl
                JOIN journal_entries je ON je.tenant_id = jl.tenant_id AND je.id = jl.journal_entry_id
                JOIN fiscal_years fy    ON fy.tenant_id = je.tenant_id AND fy.id = je.fiscal_year_id
                JOIN accounts a         ON a.tenant_id = jl.tenant_id  AND a.id = jl.account_id
                WHERE jl.tenant_id = p_tenant_id AND je.status = 'POSTED' AND fy.end_date <= v_fy.end_date
                  AND a.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')
                GROUP BY jl.account_id, jl.party_id, jl.currency_id) x) g
    WHERE g.nb <> 0;
    SELECT COUNT(*) INTO v_n_open FROM _fy_bs;

    IF v_n_open > 0 THEN
        INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description, status, created_by, device_info)
        VALUES (p_tenant_id, v_branch, v_next.id, v_next.start_date, 'OPENING', p_fy_id,
                format('قيد افتتاح السنة المالية %s (مرحَّل من %s)', v_next.name, v_fy.name), 'DRAFT', p_user_id, p_device_info)
        RETURNING id INTO v_op_je;
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, party_id, currency_id, exchange_rate,
                                   debit_original, debit_base, credit_original, credit_base)
        SELECT p_tenant_id, v_op_je, account_id, party_id, currency_id, rate,
               CASE WHEN side = 'D' THEN amt_orig ELSE 0 END, CASE WHEN side = 'D' THEN amt_base ELSE 0 END,
               CASE WHEN side = 'C' THEN amt_orig ELSE 0 END, CASE WHEN side = 'C' THEN amt_base ELSE 0 END
        FROM _fy_bs;
        UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_op_je;
    END IF;

    -- ---------------- 3) lock the year ----------------
    PERFORM set_config('erp.fy_op', 'close', TRUE);
    UPDATE fiscal_years SET is_closed = TRUE, closed_at = NOW(), closed_by = p_user_id WHERE tenant_id = p_tenant_id AND id = p_fy_id;
    PERFORM set_config('erp.fy_op', '', TRUE);

    INSERT INTO fiscal_year_closings (tenant_id, fiscal_year_id, next_fiscal_year_id, closing_entry_id, opening_entry_id, net_result, closed_by)
    VALUES (p_tenant_id, p_fy_id, v_next.id, v_cl_je, v_op_je, -v_net_dr, p_user_id);

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'CLOSE_YEAR', 'fiscal_years', p_fy_id, p_device_info,
            jsonb_build_object('closing_entry_id', v_cl_je, 'opening_entry_id', v_op_je, 'net_result', -v_net_dr));
    RETURN jsonb_build_object('fiscal_year', v_fy.name, 'net_result', -v_net_dr, 'accounts_closed', v_n_closed,
                              'opening_lines', v_n_open, 'closing_entry_id', v_cl_je, 'opening_entry_id', v_op_je);
END $$;

CREATE OR REPLACE FUNCTION reopen_fiscal_year(
    p_tenant_id   UUID,
    p_fy_id       UUID,
    p_user_id     UUID,
    p_reason      TEXT,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_ok      BOOLEAN;
    v_fy      fiscal_years%ROWTYPE;
    v_next    fiscal_years%ROWTYPE;
    v_cl      fiscal_year_closings%ROWTYPE;
    v_branch  UUID;
    v_je      UUID;
    v_orig    journal_entries%ROWTYPE;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT (r.can_post AND r.can_reverse) INTO v_ok
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_ok IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: reopening a fiscal year requires both can_post and can_reverse';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'REOPEN_INVALID: a reason is required'; END IF;

    SELECT * INTO v_fy FROM fiscal_years WHERE tenant_id = p_tenant_id AND id = p_fy_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: fiscal year (%)', p_fy_id; END IF;
    IF NOT v_fy.is_closed THEN RAISE EXCEPTION 'REOPEN_INVALID: fiscal year % is not closed', v_fy.name; END IF;
    SELECT * INTO v_cl FROM fiscal_year_closings WHERE tenant_id = p_tenant_id AND fiscal_year_id = p_fy_id AND reopened_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REOPEN_INVALID: fiscal year % was not closed through close_fiscal_year (no closing record)', v_fy.name; END IF;

    SELECT * INTO v_next FROM fiscal_years WHERE tenant_id = p_tenant_id AND id = v_cl.next_fiscal_year_id FOR UPDATE;
    IF v_next.is_closed THEN RAISE EXCEPTION 'REOPEN_INVALID: the next fiscal year is closed; reopen it first'; END IF;
    IF EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id = p_tenant_id AND fiscal_year_id = v_next.id AND status = 'POSTED'
                 AND id IS DISTINCT FROM v_cl.opening_entry_id
                 AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.tenant_id = p_tenant_id AND r.reverses_entry_id = journal_entries.id AND r.status = 'POSTED')
                 AND reverses_entry_id IS NULL) THEN
        RAISE EXCEPTION 'REOPEN_INVALID: the next fiscal year already has posted activity; it cannot be unwound';
    END IF;
    SELECT id INTO v_branch FROM branches WHERE tenant_id = p_tenant_id ORDER BY created_at, id LIMIT 1;

    PERFORM set_config('erp.fy_op', 'reopen', TRUE);
    UPDATE fiscal_years SET is_closed = FALSE, closed_at = NULL, closed_by = NULL WHERE tenant_id = p_tenant_id AND id = p_fy_id;
    PERFORM set_config('erp.fy_op', '', TRUE);

    IF v_cl.closing_entry_id IS NOT NULL THEN
        SELECT * INTO v_orig FROM journal_entries WHERE tenant_id = p_tenant_id AND id = v_cl.closing_entry_id;
        INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description, status, reverses_entry_id, created_by, device_info)
        VALUES (p_tenant_id, v_branch, p_fy_id, v_fy.end_date, 'YEAR_CLOSING_REVERSAL', p_fy_id,
                format('عكس قيد إقفال %s: %s', v_fy.name, p_reason), 'DRAFT', v_orig.id, p_user_id, p_device_info) RETURNING id INTO v_je;
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, cost_center_id, party_id, currency_id, exchange_rate,
                                   debit_original, credit_original, debit_base, credit_base, line_description)
        SELECT tenant_id, v_je, account_id, cost_center_id, party_id, currency_id, exchange_rate,
               credit_original, debit_original, credit_base, debit_base, line_description
        FROM journal_lines WHERE tenant_id = p_tenant_id AND journal_entry_id = v_orig.id;
        UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;
    END IF;
    IF v_cl.opening_entry_id IS NOT NULL THEN
        SELECT * INTO v_orig FROM journal_entries WHERE tenant_id = p_tenant_id AND id = v_cl.opening_entry_id;
        INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description, status, reverses_entry_id, created_by, device_info)
        VALUES (p_tenant_id, v_branch, v_next.id, v_next.start_date, 'OPENING_REVERSAL', p_fy_id,
                format('عكس قيد افتتاح %s: %s', v_next.name, p_reason), 'DRAFT', v_orig.id, p_user_id, p_device_info) RETURNING id INTO v_je;
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, cost_center_id, party_id, currency_id, exchange_rate,
                                   debit_original, credit_original, debit_base, credit_base, line_description)
        SELECT tenant_id, v_je, account_id, cost_center_id, party_id, currency_id, exchange_rate,
               credit_original, debit_original, credit_base, debit_base, line_description
        FROM journal_lines WHERE tenant_id = p_tenant_id AND journal_entry_id = v_orig.id;
        UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;
    END IF;

    UPDATE fiscal_year_closings SET reopened_at = NOW(), reopened_by = p_user_id, reopen_reason = p_reason WHERE tenant_id = p_tenant_id AND id = v_cl.id;
    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'REOPEN_YEAR', 'fiscal_years', p_fy_id, p_device_info, jsonb_build_object('reason', p_reason));
END $$;

-- ============================================================================
-- 10.10 SYNC_CONFLICT resolution (screen S48)
--   A conflicted offline receipt is a DRAFT that never touched stock or the ledger. A manager resolves it with ONE of:
--     RETRY           post it again as it is (typically after the missing stock was received)         needs can_post
--     REASSIGN_SHIFT  move it to an OPEN shift (SHIFT_CLOSED conflicts) and post it                    needs can_reverse
--     REJECT          the sale is not accepted: nothing is posted, the receipt and its offline_uuid
--                     are kept forever (so a device replay learns the verdict)                         needs can_reverse
--   Every decision is logged in sync_conflict_resolutions (who, what, why, before/after).
--   Cash note: REASSIGN_SHIFT assumes the cash of the receipt is physically handed to the new shift's drawer.
--   If it was already counted at the closing of the old shift, that shift's over/short entry must be corrected by a manual entry.
-- ============================================================================
CREATE TABLE sync_conflict_resolutions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id          UUID NOT NULL,
    action              VARCHAR(20) NOT NULL CHECK (action IN ('RETRY', 'REASSIGN_SHIFT', 'REJECT')),
    reason              TEXT,
    conflict_before     TEXT,
    old_shift_id        UUID,
    new_shift_id        UUID,
    result_sync_status  sync_status_enum NOT NULL,
    resolved_by         UUID NOT NULL,
    resolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, invoice_id)   REFERENCES sales_invoices(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, old_shift_id) REFERENCES pos_shifts(tenant_id, id)     ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, new_shift_id) REFERENCES pos_shifts(tenant_id, id)     ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, resolved_by)  REFERENCES users(tenant_id, id)          ON DELETE RESTRICT
);
CREATE INDEX idx_scr_invoice ON sync_conflict_resolutions(tenant_id, invoice_id);

CREATE OR REPLACE FUNCTION resolve_sync_conflict(
    p_tenant_id   UUID,
    p_invoice_id  UUID,
    p_user_id     UUID,
    p_action      TEXT,
    p_reason      TEXT DEFAULT NULL,
    p_shift_id    UUID DEFAULT NULL,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_can_post  BOOLEAN;
    v_can_rev   BOOLEAN;
    v_inv       sales_invoices%ROWTYPE;
    v_shift     pos_shifts%ROWTYPE;
    v_before    TEXT;
    v_old_shift UUID;
    v_new_shift UUID;
    v_res       RECORD;
    v_status    sync_status_enum;
    v_has_cash  BOOLEAN;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    IF p_action IS NULL OR p_action NOT IN ('RETRY', 'REASSIGN_SHIFT', 'REJECT') THEN
        RAISE EXCEPTION 'CONFLICT_INVALID: action must be RETRY, REASSIGN_SHIFT or REJECT';
    END IF;
    SELECT r.can_post, r.can_reverse INTO v_can_post, v_can_rev
    FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'PERMISSION_DENIED: lacks can_post'; END IF;
    IF p_action <> 'RETRY' AND v_can_rev IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: % requires can_reverse', p_action;
    END IF;
    IF p_action <> 'RETRY' AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
        RAISE EXCEPTION 'CONFLICT_INVALID: a reason is required for %', p_action;
    END IF;

    SELECT * INTO v_inv FROM sales_invoices WHERE tenant_id = p_tenant_id AND id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Sales invoice (%)', p_invoice_id; END IF;
    IF v_inv.status = 'POSTED' THEN RAISE EXCEPTION 'CONFLICT_INVALID: invoice is already POSTED'; END IF;
    IF v_inv.sync_status = 'REJECTED' THEN RAISE EXCEPTION 'CONFLICT_INVALID: invoice was already rejected'; END IF;
    IF v_inv.sync_status <> 'SYNC_CONFLICT' THEN RAISE EXCEPTION 'CONFLICT_INVALID: invoice is not in SYNC_CONFLICT (state %)', v_inv.sync_status; END IF;
    v_before := v_inv.sync_conflict_reason;
    v_old_shift := v_inv.shift_id;
    v_new_shift := v_inv.shift_id;

    IF p_action = 'REJECT' THEN
        UPDATE sales_invoices SET sync_status = 'REJECTED', sync_conflict_reason = 'REJECTED: ' || btrim(p_reason)
        WHERE tenant_id = p_tenant_id AND id = v_inv.id;
        v_status := 'REJECTED';

    ELSE
        IF p_action = 'REASSIGN_SHIFT' THEN
            SELECT EXISTS (SELECT 1 FROM invoice_payments WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id AND payment_method = 'CASH') INTO v_has_cash;
            IF p_shift_id IS NULL AND v_has_cash THEN
                RAISE EXCEPTION 'CONFLICT_INVALID: an invoice with cash payments must be moved to an OPEN shift';
            END IF;
            IF p_shift_id IS NOT NULL THEN
                SELECT * INTO v_shift FROM pos_shifts WHERE tenant_id = p_tenant_id AND id = p_shift_id FOR SHARE;
                IF NOT FOUND OR v_shift.status <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_CLOSED: the target shift must be OPEN'; END IF;
                IF v_shift.branch_id <> v_inv.branch_id THEN RAISE EXCEPTION 'CONFLICT_INVALID: the target shift belongs to another branch'; END IF;
            END IF;
            UPDATE invoice_payments SET account_id = v_shift.cash_account_id
            WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id AND payment_method = 'CASH' AND p_shift_id IS NOT NULL;
            UPDATE sales_invoices SET shift_id = p_shift_id WHERE tenant_id = p_tenant_id AND id = v_inv.id;
            v_new_shift := p_shift_id;
        END IF;

        SELECT * INTO v_res FROM post_sales_invoice(p_tenant_id, v_inv.id, p_user_id, p_device_info);
        v_status := v_res.out_sync_status;
    END IF;

    INSERT INTO sync_conflict_resolutions (tenant_id, invoice_id, action, reason, conflict_before, old_shift_id, new_shift_id, result_sync_status, resolved_by)
    VALUES (p_tenant_id, v_inv.id, p_action, p_reason, v_before, v_old_shift, v_new_shift, v_status, p_user_id);
    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, old_json, new_json)
    VALUES (p_tenant_id, p_user_id, 'RESOLVE_CONFLICT', 'sales_invoices', v_inv.id, p_device_info,
            jsonb_build_object('conflict', v_before, 'shift_id', v_old_shift),
            jsonb_build_object('action', p_action, 'reason', p_reason, 'result', v_status, 'shift_id', v_new_shift));

    RETURN jsonb_build_object('action', p_action, 'sync_status', v_status,
                              'invoice_no', (SELECT invoice_no FROM sales_invoices WHERE tenant_id = p_tenant_id AND id = v_inv.id),
                              'journal_entry_id', (SELECT journal_entry_id FROM sales_invoices WHERE tenant_id = p_tenant_id AND id = v_inv.id),
                              'conflict', (SELECT sync_conflict_reason FROM sales_invoices WHERE tenant_id = p_tenant_id AND id = v_inv.id));
END $$;

-- ============================================================================
-- 10.11 approve_credit_override : a manager lets ONE invoice exceed the customer's credit limit
--       (then post it normally, or RETRY the SYNC_CONFLICT it caused). Needs can_reverse and a written reason.
-- ============================================================================
CREATE OR REPLACE FUNCTION approve_credit_override(
    p_tenant_id   UUID,
    p_invoice_id  UUID,
    p_user_id     UUID,
    p_reason      TEXT,
    p_device_info VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_can_rev BOOLEAN; v_inv sales_invoices%ROWTYPE;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_reverse INTO v_can_rev FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_rev IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'PERMISSION_DENIED: a credit override requires can_reverse'; END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'OVERRIDE_INVALID: a reason is required'; END IF;

    SELECT * INTO v_inv FROM sales_invoices WHERE tenant_id = p_tenant_id AND id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Sales invoice (%)', p_invoice_id; END IF;
    IF v_inv.status = 'POSTED' THEN RAISE EXCEPTION 'OVERRIDE_INVALID: invoice is already POSTED'; END IF;
    IF v_inv.sync_status = 'REJECTED' THEN RAISE EXCEPTION 'OVERRIDE_INVALID: invoice was rejected'; END IF;
    IF v_inv.is_return THEN RAISE EXCEPTION 'OVERRIDE_INVALID: a return has no credit limit'; END IF;
    IF NOT EXISTS (SELECT 1 FROM invoice_payments WHERE tenant_id = p_tenant_id AND invoice_id = v_inv.id AND payment_method = 'CREDIT') THEN
        RAISE EXCEPTION 'OVERRIDE_INVALID: the invoice has no credit payment';
    END IF;

    PERFORM set_config('erp.credit_override_ok', 'on', TRUE);
    UPDATE sales_invoices SET credit_override_by = p_user_id, credit_override_at = NOW(), credit_override_reason = btrim(p_reason)
    WHERE tenant_id = p_tenant_id AND id = v_inv.id;
    PERFORM set_config('erp.credit_override_ok', '', TRUE);

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'CREDIT_OVERRIDE', 'sales_invoices', v_inv.id, p_device_info, jsonb_build_object('reason', p_reason));
END $$;

-- ============================================================================
-- 11a. TENANT ONBOARDING SEED (unchanged from V2)
-- ============================================================================
-- ============================================================================
-- Standard Arabic Chart of Accounts & Auto-Linking Seed Function (PostgreSQL)
-- ============================================================================
-- Usage when onboarding ANY new company (Tenant):
--   SELECT fn_seed_tenant_accounting('<tenant-uuid>', 'YER');
--
-- Creates:
--   1. Default Currencies (YER base, SAR, USD)
--   2. Complete 3-Level Arabic Chart of Accounts (MAIN -> SUB -> ANALYTICAL)
--      including local wallets (Jaib, Jawali, OneCash, Kuraimi)
--   3. Automatic population of tenant_accounting_settings for instant readiness
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_seed_tenant_accounting(
    p_tenant_id          UUID,
    p_base_currency_code VARCHAR DEFAULT 'YER'
)
RETURNS VOID AS $$
DECLARE
    v_base_curr_id UUID;

    -- Level 1 (MAIN)
    v_1 UUID; v_2 UUID; v_3 UUID; v_4 UUID; v_5 UUID;

    -- Level 2 (SUB)
    v_11 UUID; v_12 UUID;
    v_1101 UUID; v_1102 UUID; v_1103 UUID; v_1104 UUID; v_1105 UUID; v_1201 UUID;
    v_21 UUID; v_2101 UUID; v_2102 UUID;
    v_31 UUID; v_3101 UUID;
    v_41 UUID; v_42 UUID; v_4101 UUID; v_4201 UUID;
    v_51 UUID; v_52 UUID; v_5101 UUID; v_5201 UUID;

    -- Key Level 3 (ANALYTICAL) IDs for auto-linking settings
    v_main_cash_id      UUID;
    v_pos_cash_id       UUID;
    v_customers_ctrl_id UUID;
    v_inventory_id      UUID;
    v_vat_input_id      UUID;
    v_suppliers_ctrl_id UUID;
    v_vat_output_id     UUID;
    v_retained_earn_id  UUID;
    v_sales_rev_id      UUID;
    v_sales_ret_id      UUID;
    v_allowed_disc_id   UUID;
    v_earned_disc_id    UUID;
    v_cogs_id           UUID;
    v_stock_adj_id      UUID;
    v_cash_over_short_id UUID;
    v_fx_diff_id        UUID;
BEGIN
    -- ------------------------------------------------------------------------
    -- 1. DEFAULT CURRENCIES
    -- ------------------------------------------------------------------------
    INSERT INTO currencies (tenant_id, code, name_ar, symbol, is_base)
    VALUES
        (p_tenant_id, 'YER', 'ريال يمني',   'ر.ي', p_base_currency_code = 'YER'),
        (p_tenant_id, 'SAR', 'ريال سعودي',  'ر.س', p_base_currency_code = 'SAR'),
        (p_tenant_id, 'USD', 'دولار أمريكي', '$',   p_base_currency_code = 'USD')
    ON CONFLICT (tenant_id, code) DO NOTHING;

    SELECT id INTO v_base_curr_id
    FROM currencies
    WHERE tenant_id = p_tenant_id AND is_base = TRUE
    LIMIT 1;

    -- ------------------------------------------------------------------------
    -- 2. LEVEL 1 — MAIN ACCOUNTS (رئيسي)
    -- ------------------------------------------------------------------------
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, NULL, '1', 'الأصول', 'Assets', 'MAIN', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_1;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, NULL, '2', 'الالتزامات (الخصوم)', 'Liabilities', 'MAIN', 'LIABILITY', 'CREDIT', TRUE) RETURNING id INTO v_2;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, NULL, '3', 'حقوق الملكية', 'Equity', 'MAIN', 'EQUITY', 'CREDIT', TRUE) RETURNING id INTO v_3;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, NULL, '4', 'الإيرادات', 'Revenues', 'MAIN', 'REVENUE', 'CREDIT', TRUE) RETURNING id INTO v_4;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, NULL, '5', 'المصروفات والتكاليف', 'Expenses & COGS', 'MAIN', 'EXPENSE', 'DEBIT', TRUE) RETURNING id INTO v_5;

    -- ------------------------------------------------------------------------
    -- 3. LEVEL 2 — SUB ACCOUNTS (فرعي)
    -- ------------------------------------------------------------------------
    -- Assets Sub
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_1, '11', 'الأصول المتداولة', 'Current Assets', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_11;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_1, '12', 'الأصول الثابتة', 'Fixed Assets', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_12;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_11, '1101', 'النقدية والصناديق', 'Cash & Safes', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_1101;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_11, '1102', 'المحافظ الإلكترونية والبنوك', 'Wallets & Banks', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_1102;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_11, '1103', 'الذمم المدينة والعملاء', 'Accounts Receivable', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_1103;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_11, '1104', 'المخزون السلعي', 'Inventory', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_1104;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_11, '1105', 'ضرائب المشتريات القابلة للاسترداد', 'Input VAT', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_1105;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_12, '1201', 'الممتلكات والمعدات', 'Property & Equipment', 'SUB', 'ASSET', 'DEBIT', TRUE) RETURNING id INTO v_1201;

    -- Liabilities Sub
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_2, '21', 'الالتزامات المتداولة', 'Current Liabilities', 'SUB', 'LIABILITY', 'CREDIT', TRUE) RETURNING id INTO v_21;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_21, '2101', 'الذمم الدائنة والموردون', 'Accounts Payable', 'SUB', 'LIABILITY', 'CREDIT', TRUE) RETURNING id INTO v_2101;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_21, '2102', 'المصروفات المستحقة والضرائب', 'Accruals & Taxes Payable', 'SUB', 'LIABILITY', 'CREDIT', TRUE) RETURNING id INTO v_2102;

    -- Equity Sub
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_3, '31', 'رأس المال والأرباح', 'Capital & Retained Earnings', 'SUB', 'EQUITY', 'CREDIT', TRUE) RETURNING id INTO v_31;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_31, '3101', 'حسابات الملكية', 'Owner Equity Accounts', 'SUB', 'EQUITY', 'CREDIT', TRUE) RETURNING id INTO v_3101;

    -- Revenues Sub
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_4, '41', 'إيرادات النشاط', 'Operating Revenues', 'SUB', 'REVENUE', 'CREDIT', TRUE) RETURNING id INTO v_41;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_4, '42', 'إيرادات أخرى', 'Other Revenues', 'SUB', 'REVENUE', 'CREDIT', TRUE) RETURNING id INTO v_42;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_41, '4101', 'المبيعات ومردوداتها', 'Sales & Returns', 'SUB', 'REVENUE', 'CREDIT', TRUE) RETURNING id INTO v_4101;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_42, '4201', 'إيرادات متنوعة وفروقات', 'Misc Revenues', 'SUB', 'REVENUE', 'CREDIT', TRUE) RETURNING id INTO v_4201;

    -- Expenses Sub
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_5, '51', 'تكلفة المبيعات', 'Cost of Goods Sold', 'SUB', 'EXPENSE', 'DEBIT', TRUE) RETURNING id INTO v_51;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_5, '52', 'المصروفات التشغيلية والإدارية', 'Operating Expenses', 'SUB', 'EXPENSE', 'DEBIT', TRUE) RETURNING id INTO v_52;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_51, '5101', 'تكاليف البضاعة والمخزون', 'COGS & Stock Variances', 'SUB', 'EXPENSE', 'DEBIT', TRUE) RETURNING id INTO v_5101;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system)
    VALUES (p_tenant_id, v_52, '5201', 'مصروفات عامة وبيعية', 'General & Selling Expenses', 'SUB', 'EXPENSE', 'DEBIT', TRUE) RETURNING id INTO v_5201;

    -- ------------------------------------------------------------------------
    -- 4. LEVEL 3 — ANALYTICAL ACCOUNTS (تحليلي — الوحيدة القابلة للترحيل)
    -- ------------------------------------------------------------------------
    -- Cash & Safes
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_1101, '110101', 'الصندوق الرئيسي', 'Main Safe', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_main_cash_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_1101, '110102', 'صندوق الكاشير (نقطة البيع)', 'POS Cash Drawer', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_pos_cash_id;

    -- Local Electronic Wallets & Banks (Separate Analytical Accounts!)
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system) VALUES
        (p_tenant_id, v_1102, '110201', 'محفظة جيب (Jaib)',     'Jaib Wallet',    'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_1102, '110202', 'محفظة جوالي (Jawali)', 'Jawali Wallet',  'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_1102, '110203', 'محفظة ون كاش (OneCash)', 'OneCash Wallet', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_1102, '110204', 'بنك الكريمي الإسلامي', 'Kuraimi Bank',   'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, FALSE);

    -- Receivables & Inventory & VAT Input
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_1103, '110301', 'العملاء (حساب رقابي)', 'Customers Control', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_customers_ctrl_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_1103, '110302', 'أوراق قبض وشيكات تحت التحصيل', 'Notes Receivable', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, FALSE);

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_1104, '110401', 'مخزون البضاعة — المخزن الرئيسي', 'Main Warehouse Inventory', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_inventory_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_1105, '110501', 'ضريبة المشتريات (مدخلات)', 'VAT Input', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_vat_input_id;

    -- Fixed Assets
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system) VALUES
        (p_tenant_id, v_1201, '120101', 'أثاث وتجهيزات',          'Furniture & Fixtures', 'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_1201, '120102', 'أجهزة حاسوب ونقاط بيع',  'POS & IT Equipment',   'ANALYTICAL', 'ASSET', 'DEBIT', v_base_curr_id, FALSE);

    -- Liabilities Analytical
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_2101, '210101', 'الموردون (حساب رقابي)', 'Suppliers Control', 'ANALYTICAL', 'LIABILITY', 'CREDIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_suppliers_ctrl_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_2101, '210102', 'أوراق دفع وشيكات صادرة', 'Notes Payable', 'ANALYTICAL', 'LIABILITY', 'CREDIT', v_base_curr_id, FALSE);

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_2102, '210201', 'ضريبة المبيعات (مخرجات)', 'VAT Output', 'ANALYTICAL', 'LIABILITY', 'CREDIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_vat_output_id;

    -- Equity Analytical
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_3101, '310101', 'رأس المال', 'Share Capital', 'ANALYTICAL', 'EQUITY', 'CREDIT', v_base_curr_id, TRUE);

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_3101, '310102', 'الأرباح المحتجزة (المرحّلة)', 'Retained Earnings', 'ANALYTICAL', 'EQUITY', 'CREDIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_retained_earn_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_3101, '310103', 'جاري الشركاء / المالك', 'Owner Current Account', 'ANALYTICAL', 'EQUITY', 'CREDIT', v_base_curr_id, FALSE);

    -- Revenues Analytical
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_4101, '410101', 'إيرادات المبيعات', 'Sales Revenue', 'ANALYTICAL', 'REVENUE', 'CREDIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_sales_rev_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_4101, '410102', 'مردودات المبيعات', 'Sales Returns', 'ANALYTICAL', 'REVENUE', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_sales_ret_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_4101, '410103', 'خصم مسموح به', 'Sales Discount Allowed', 'ANALYTICAL', 'REVENUE', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_allowed_disc_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_4201, '420101', 'خصم مكتسب (مشتريات)', 'Purchase Discount Earned', 'ANALYTICAL', 'REVENUE', 'CREDIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_earned_disc_id;

    -- Expenses & COGS Analytical
    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_5101, '510101', 'تكلفة البضاعة المباعة (COGS)', 'Cost of Goods Sold', 'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_cogs_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_5101, '510102', 'فروقات الجرد والتالف', 'Inventory Adjustment & Spoilage', 'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_stock_adj_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_5201, '520105', 'فروقات الصندوق (عجز / زيادة)', 'Cash Over & Short', 'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_cash_over_short_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system)
    VALUES (p_tenant_id, v_5201, '520106', 'فروق تقييم العملة (FX)', 'FX Gain / Loss', 'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, TRUE)
    RETURNING id INTO v_fx_diff_id;

    INSERT INTO accounts (tenant_id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, default_currency_id, is_system) VALUES
        (p_tenant_id, v_5201, '520101', 'الرواتب والأجور',              'Salaries & Wages',      'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_5201, '520102', 'الإيجارات',                    'Rent Expense',          'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_5201, '520103', 'كهرباء ومياه وإنترنت',         'Utilities & Internet',  'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_5201, '520104', 'مصروفات نثرية / درج الكاشير',  'POS Petty Cash Expense','ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, FALSE),
        (p_tenant_id, v_5201, '520107', 'عمولات المحافظ والتحويلات',    'Wallet & Bank Fees',    'ANALYTICAL', 'EXPENSE', 'DEBIT', v_base_curr_id, FALSE);

    -- ------------------------------------------------------------------------
    -- 5. AUTO-LINK TENANT ACCOUNTING SETTINGS
    -- ------------------------------------------------------------------------
    INSERT INTO tenant_accounting_settings (
        tenant_id,
        default_cash_account_id,
        sales_revenue_account_id,
        sales_return_account_id,
        cogs_account_id,
        default_inventory_account_id,
        allowed_discount_account_id,
        earned_discount_account_id,
        fx_gain_loss_account_id,
        cash_over_short_account_id,
        stock_adjustment_account_id,
        retained_earnings_account_id,
        customers_control_account_id,
        suppliers_control_account_id,
        vat_output_account_id,
        vat_input_account_id,
        default_vat_rate
    ) VALUES (
        p_tenant_id,
        v_main_cash_id,
        v_sales_rev_id,
        v_sales_ret_id,
        v_cogs_id,
        v_inventory_id,
        v_allowed_disc_id,
        v_earned_disc_id,
        v_fx_diff_id,
        v_cash_over_short_id,
        v_stock_adj_id,
        v_retained_earn_id,
        v_customers_ctrl_id,
        v_suppliers_ctrl_id,
        v_vat_output_id,
        v_vat_input_id,
        0.0000
    )
    ON CONFLICT (tenant_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 11. SHIFT LIFECYCLE: open_shift / fn_shift_report (Z-Report) / close_shift
-- ============================================================================
CREATE OR REPLACE FUNCTION open_shift(
    p_tenant_id UUID, p_branch_id UUID, p_cashier_user_id UUID, p_cash_account_id UUID,
    p_opening_float NUMERIC, p_user_id UUID, p_open_date DATE DEFAULT CURRENT_DATE, p_device_info VARCHAR DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_can_post BOOLEAN; v_set tenant_accounting_settings%ROWTYPE; v_acc accounts%ROWTYPE;
    v_fy UUID; v_shift UUID; v_je UUID; v_cur UUID;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_post INTO v_can_post FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'PERMISSION_DENIED: lacks can_post'; END IF;
    IF p_opening_float < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID: negative opening float'; END IF;

    SELECT * INTO v_acc FROM accounts WHERE tenant_id = p_tenant_id AND id = p_cash_account_id;
    IF NOT FOUND OR NOT v_acc.is_analytical OR v_acc.account_type <> 'ASSET' OR NOT v_acc.is_active THEN
        RAISE EXCEPTION 'SHIFT_INVALID: drawer must be an active analytical ASSET account';
    END IF;
    SELECT * INTO v_set FROM tenant_accounting_settings WHERE tenant_id = p_tenant_id;
    IF p_opening_float > 0 AND v_set.default_cash_account_id IS NULL THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: default_cash_account_id required for an opening float';
    END IF;
    v_fy := fn_fiscal_year_for(p_tenant_id, p_open_date);
    IF v_fy IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: no open fiscal year for %', p_open_date; END IF;

    INSERT INTO pos_shifts (tenant_id, branch_id, fiscal_year_id, cashier_user_id, cash_account_id, opening_float)
    VALUES (p_tenant_id, p_branch_id, v_fy, p_cashier_user_id, p_cash_account_id, p_opening_float)
    RETURNING id INTO v_shift;      -- unique index rejects a second OPEN shift on the same drawer

    IF p_opening_float > 0 THEN
        v_cur := fn_base_currency(p_tenant_id);
        INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description, status, created_by, device_info)
        VALUES (p_tenant_id, p_branch_id, v_fy, p_open_date, 'SHIFT_OPEN', v_shift, 'عهدة افتتاح وردية', 'DRAFT', p_user_id, p_device_info)
        RETURNING id INTO v_je;
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base)
        VALUES (p_tenant_id, v_je, p_cash_account_id, v_cur, p_opening_float, p_opening_float);
        INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base)
        VALUES (p_tenant_id, v_je, v_set.default_cash_account_id, v_cur, p_opening_float, p_opening_float);
        UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;
    END IF;
    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'OPEN_SHIFT', 'pos_shifts', v_shift, p_device_info, jsonb_build_object('opening_float', p_opening_float));
    RETURN v_shift;
END $$;

-- Z-Report: derived from DOCUMENTS (sales, refunds, reversals, vouchers) -- independent of the GL,
-- so close_shift can cross-check the two.
CREATE OR REPLACE FUNCTION fn_shift_report(p_tenant_id UUID, p_shift_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
    v_shift pos_shifts%ROWTYPE;
    v_cash NUMERIC(18,4); v_credit NUMERIC(18,4); v_wallets JSONB;
    v_rcpt NUMERIC(18,4); v_pay NUMERIC(18,4); v_petty NUMERIC(18,4); v_expected NUMERIC(18,4);
BEGIN
    SELECT * INTO v_shift FROM pos_shifts WHERE tenant_id = p_tenant_id AND id = p_shift_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: shift (%)', p_shift_id; END IF;

    WITH r AS (
        SELECT ip.payment_method AS m, CASE WHEN si.is_return THEN -ip.amount ELSE ip.amount END AS amt
        FROM invoice_payments ip JOIN sales_invoices si ON si.tenant_id = ip.tenant_id AND si.id = ip.invoice_id
        WHERE si.tenant_id = p_tenant_id AND si.shift_id = p_shift_id AND si.status = 'POSTED'
        UNION ALL        -- reversals executed in THIS shift (the original sale stays in its own shift's report)
        SELECT ip.payment_method, CASE WHEN si.is_return THEN ip.amount ELSE -ip.amount END
        FROM document_reversals dr
        JOIN sales_invoices si ON si.tenant_id = dr.tenant_id AND si.id = dr.source_id
        JOIN invoice_payments ip ON ip.tenant_id = si.tenant_id AND ip.invoice_id = si.id
        WHERE dr.tenant_id = p_tenant_id AND dr.shift_id = p_shift_id AND dr.source_type = 'SALES_INVOICE'
    ), agg AS (SELECT m, SUM(amt) AS s FROM r GROUP BY m)
    SELECT COALESCE(MAX(s) FILTER (WHERE m = 'CASH'), 0),
           COALESCE(MAX(s) FILTER (WHERE m = 'CREDIT'), 0),
           COALESCE(jsonb_object_agg(m::text, s) FILTER (WHERE m NOT IN ('CASH', 'CREDIT')), '{}'::jsonb)
    INTO v_cash, v_credit, v_wallets FROM agg;

    SELECT COALESCE(SUM(amount_base) FILTER (WHERE voucher_type = 'RECEIPT'), 0),
           COALESCE(SUM(amount_base) FILTER (WHERE voucher_type = 'PAYMENT'), 0),
           COALESCE(SUM(amount_base) FILTER (WHERE voucher_type = 'PETTY_CASH'), 0)
    INTO v_rcpt, v_pay, v_petty
    FROM vouchers WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND status = 'POSTED'
                    AND cash_account_id = v_shift.cash_account_id;

    -- voucher reversals executed in THIS shift take cash back out of (or into) the drawer
    SELECT v_rcpt - COALESCE(SUM(v.amount_base) FILTER (WHERE v.voucher_type = 'RECEIPT'), 0),
           v_pay  - COALESCE(SUM(v.amount_base) FILTER (WHERE v.voucher_type = 'PAYMENT'), 0),
           v_petty - COALESCE(SUM(v.amount_base) FILTER (WHERE v.voucher_type = 'PETTY_CASH'), 0)
    INTO v_rcpt, v_pay, v_petty
    FROM document_reversals dr JOIN vouchers v ON v.tenant_id = dr.tenant_id AND v.id = dr.source_id
    WHERE dr.tenant_id = p_tenant_id AND dr.shift_id = p_shift_id AND dr.source_type = 'VOUCHER'
      AND v.cash_account_id = v_shift.cash_account_id;

    v_expected := v_shift.opening_float + v_cash + v_rcpt - v_pay - v_petty;
    RETURN jsonb_build_object(
        'shift_id', p_shift_id, 'status', v_shift.status, 'opening_float', v_shift.opening_float,
        'net_cash_sales', v_cash, 'cash_receipts', v_rcpt, 'cash_payments', v_pay, 'petty_cash', v_petty,
        'expected_cash', v_expected, 'counted_cash', v_shift.counted_cash, 'variance', v_shift.variance_amount,
        'wallets', v_wallets, 'credit_sales', v_credit);
END $$;

CREATE OR REPLACE FUNCTION close_shift(
    p_tenant_id UUID, p_shift_id UUID, p_user_id UUID, p_counted_cash NUMERIC,
    p_close_date DATE DEFAULT CURRENT_DATE, p_device_info VARCHAR DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_can_post BOOLEAN; v_shift pos_shifts%ROWTYPE; v_set tenant_accounting_settings%ROWTYPE;
    v_report JSONB; v_expected NUMERIC(18,4); v_gl NUMERIC(18,4); v_var NUMERIC(18,4);
    v_je UUID; v_cur UUID;
BEGIN
    PERFORM fn_assert_tenant(p_tenant_id);
    SELECT r.can_post INTO v_can_post FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id AND u.is_active;
    IF v_can_post IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'PERMISSION_DENIED: lacks can_post'; END IF;
    IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID: counted cash must be >= 0'; END IF;

    SELECT * INTO v_shift FROM pos_shifts WHERE tenant_id = p_tenant_id AND id = p_shift_id FOR UPDATE;  -- waits for in-flight postings
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: shift (%)', p_shift_id; END IF;
    IF v_shift.status <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_INVALID: shift already closed'; END IF;

    IF EXISTS (SELECT 1 FROM sales_invoices WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND status = 'DRAFT' AND sync_status <> 'REJECTED') THEN
        RAISE EXCEPTION 'SHIFT_HAS_PENDING_INVOICES: resolve pending / SYNC_CONFLICT invoices before closing';
    END IF;
    IF EXISTS (SELECT 1 FROM vouchers WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND status = 'DRAFT') THEN
        RAISE EXCEPTION 'SHIFT_HAS_DRAFT_VOUCHERS: post or delete draft vouchers before closing';
    END IF;

    SELECT * INTO v_set FROM tenant_accounting_settings WHERE tenant_id = p_tenant_id;
    v_report   := fn_shift_report(p_tenant_id, p_shift_id);
    v_expected := (v_report ->> 'expected_cash')::numeric;

    SELECT COALESCE(SUM(jl.debit_base - jl.credit_base), 0) INTO v_gl
    FROM journal_lines jl JOIN journal_entries je ON je.tenant_id = jl.tenant_id AND je.id = jl.journal_entry_id
    WHERE jl.tenant_id = p_tenant_id AND jl.account_id = v_shift.cash_account_id AND je.status = 'POSTED';
    IF v_gl <> v_expected THEN
        RAISE EXCEPTION 'RECONCILIATION_MISMATCH: drawer ledger balance (%) <> document-derived expected cash (%)', v_gl, v_expected;
    END IF;
    IF v_expected < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID: drawer balance is negative (%)', v_expected; END IF;

    v_var := p_counted_cash - v_expected;
    IF (p_counted_cash > 0 AND v_set.default_cash_account_id IS NULL) OR (v_var <> 0 AND v_set.cash_over_short_account_id IS NULL) THEN
        RAISE EXCEPTION 'SETTINGS_INCOMPLETE: default cash / cash over-short accounts required';
    END IF;

    IF v_expected > 0 OR p_counted_cash > 0 THEN
        v_cur := fn_base_currency(p_tenant_id);
        INSERT INTO journal_entries (tenant_id, branch_id, fiscal_year_id, entry_date, source_type, source_id, description, status, created_by, device_info)
        VALUES (p_tenant_id, v_shift.branch_id, v_shift.fiscal_year_id, p_close_date, 'SHIFT_CLOSE', v_shift.id, 'تصفية وردية كاشير', 'DRAFT', p_user_id, p_device_info)
        RETURNING id INTO v_je;
        IF p_counted_cash > 0 THEN
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base)
            VALUES (p_tenant_id, v_je, v_set.default_cash_account_id, v_cur, p_counted_cash, p_counted_cash);
        END IF;
        IF v_var < 0 THEN
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base)
            VALUES (p_tenant_id, v_je, v_set.cash_over_short_account_id, v_cur, -v_var, -v_var);
        END IF;
        IF v_expected > 0 THEN
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base)
            VALUES (p_tenant_id, v_je, v_shift.cash_account_id, v_cur, v_expected, v_expected);
        END IF;
        IF v_var > 0 THEN
            INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, currency_id, credit_original, credit_base)
            VALUES (p_tenant_id, v_je, v_set.cash_over_short_account_id, v_cur, v_var, v_var);
        END IF;
        UPDATE journal_entries SET status = 'POSTED', posted_at = NOW(), posted_by = p_user_id WHERE tenant_id = p_tenant_id AND id = v_je;
    END IF;

    UPDATE pos_shifts SET status = 'CLOSED', closed_at = NOW(), expected_cash = v_expected, counted_cash = p_counted_cash,
                          variance_amount = v_var, closing_journal_entry_id = v_je
    WHERE tenant_id = p_tenant_id AND id = p_shift_id;

    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, device_info, new_json)
    VALUES (p_tenant_id, p_user_id, 'CLOSE_SHIFT', 'pos_shifts', p_shift_id, p_device_info,
            jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'variance', v_var, 'journal_entry_id', v_je));
    RETURN fn_shift_report(p_tenant_id, p_shift_id);
END $$;

-- ============================================================================
-- 12. AUTH LOOKUP (login happens BEFORE the tenant is known, so RLS would hide the user row)
--     Owner is switched to a dedicated BYPASSRLS role by 01_post_install.sql.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_auth_lookup(p_tenant_code VARCHAR, p_username VARCHAR)
RETURNS TABLE (out_user_id UUID, out_tenant_id UUID, out_password_hash TEXT, out_two_fa_enabled BOOLEAN,
               out_is_active BOOLEAN, out_role_id UUID, out_can_post BOOLEAN, out_can_reverse BOOLEAN,
               out_can_view_cost BOOLEAN, out_can_view_cash_balance BOOLEAN, out_can_give_discount BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT u.id, u.tenant_id, u.password_hash, u.two_fa_enabled, u.is_active, u.role_id,
           r.can_post, r.can_reverse, r.can_view_cost, r.can_view_cash_balance, r.can_give_discount
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
    WHERE t.code = p_tenant_code AND t.is_active AND u.username = p_username
$$;

-- ============================================================================
-- 13. ACCOUNT STATEMENT VIEW (POSTED ONLY, security_invoker so RLS of the caller applies)
-- ============================================================================
CREATE OR REPLACE VIEW v_account_statement WITH (security_invoker = true) AS
SELECT
    je.tenant_id, je.branch_id, je.fiscal_year_id, je.entry_date, je.entry_no, je.source_type, je.source_id,
    je.reference_no, je.reverses_entry_id,
    EXISTS (SELECT 1 FROM journal_entries rev
            WHERE rev.tenant_id = je.tenant_id AND rev.reverses_entry_id = je.id AND rev.status = 'POSTED') AS is_reversed,
    jl.account_id, a.code AS account_code, a.name_ar AS account_name_ar, a.parent_id AS parent_account_id,
    jl.cost_center_id, jl.party_id, jl.currency_id, jl.exchange_rate,
    jl.debit_original, jl.credit_original, jl.debit_base, jl.credit_base,
    COALESCE(jl.line_description, je.description) AS description,
    je.created_by, je.device_info, je.created_at
FROM journal_entries je
JOIN journal_lines jl ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
JOIN accounts a       ON a.tenant_id = jl.tenant_id  AND a.id = jl.account_id
WHERE je.status = 'POSTED';

-- Trial balance PER FISCAL YEAR. After a year-end the opening entry restates every balance-sheet balance in the new
-- year, so balances must always be read within ONE fiscal year (summing across years would count them twice).
CREATE OR REPLACE VIEW v_trial_balance WITH (security_invoker = true) AS
SELECT je.tenant_id, je.fiscal_year_id, jl.account_id, a.code AS account_code, a.name_ar AS account_name_ar, a.account_type,
       SUM(jl.debit_base) AS debit_base, SUM(jl.credit_base) AS credit_base, SUM(jl.debit_base - jl.credit_base) AS net_base
FROM journal_entries je
JOIN journal_lines jl ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
JOIN accounts a       ON a.tenant_id = jl.tenant_id  AND a.id = jl.account_id
WHERE je.status = 'POSTED'
GROUP BY je.tenant_id, je.fiscal_year_id, jl.account_id, a.code, a.name_ar, a.account_type;

-- ============================================================================
-- 14. UNIVERSAL RLS (NULLIF makes an empty-string setting safe after RESET in pooled connections)
-- ============================================================================
DO $$
DECLARE
    v_tbl TEXT;
    v_tables TEXT[] := ARRAY[
        'branches', 'fiscal_years', 'roles', 'users', 'currencies', 'exchange_rates',
        'accounts', 'cost_centers', 'tenant_accounting_settings', 'parties',
        'journal_entries', 'journal_lines', 'pos_shifts', 'vouchers',
        'warehouses', 'item_groups', 'units', 'items', 'item_units',
        'stock_balances', 'stock_documents', 'stock_ledger',
        'purchase_invoices', 'purchase_invoice_lines',
        'sales_invoices', 'sales_invoice_lines', 'invoice_payments', 'stock_document_lines',
        'audit_logs', 'doc_counters', 'document_reversals', 'fiscal_year_closings', 'sync_conflict_resolutions'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', v_tbl);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = fn_current_tenant()) WITH CHECK (tenant_id = fn_current_tenant())', v_tbl);
    END LOOP;
    -- tenants itself (v2.0 left it unprotected: any tenant could read every company row)
    ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON tenants;
    CREATE POLICY tenant_isolation ON tenants USING (id = fn_current_tenant()) WITH CHECK (id = fn_current_tenant());
END $$;

-- ============================================================================
-- 15. PRIVILEGES: the application role can read everything it may see, write drafts / masters,
--     but can NOT touch stock, ledgers, counters, shifts or document status directly.
--     All state transitions go through the SECURITY DEFINER functions above.
-- ============================================================================
DO $$
DECLARE f RECORD;
BEGIN   -- only OUR functions (extension-owned ones such as pgcrypto are left alone)
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace
               AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig); END LOOP;
END $$;

DO $$
DECLARE
    r RECORD; v_cols TEXT; v_t TEXT;
BEGIN
    GRANT USAGE ON SCHEMA public TO erp_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO erp_app;

    -- masters: full DML
    FOREACH v_t IN ARRAY ARRAY['branches','roles','users','currencies','exchange_rates','accounts','cost_centers',
                               'tenant_accounting_settings','parties','warehouses','item_groups','units','items','item_units']
    LOOP EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %I TO erp_app', v_t); END LOOP;
    GRANT INSERT (tenant_id, name, start_date, end_date) ON fiscal_years TO erp_app;   -- is_closed only flips through close_/reopen_fiscal_year

    -- documents: insert/delete drafts; UPDATE only on non-status columns
    FOREACH v_t IN ARRAY ARRAY['sales_invoices','sales_invoice_lines','invoice_payments','purchase_invoices',
                               'purchase_invoice_lines','vouchers','stock_documents','stock_document_lines','journal_entries','journal_lines']
    LOOP EXECUTE format('GRANT INSERT, DELETE ON %I TO erp_app', v_t); END LOOP;

    FOR r IN SELECT * FROM (VALUES
        ('sales_invoices',        ARRAY['status','sync_status','sync_conflict_reason','offline_payload_hash','journal_entry_id','invoice_no','credit_override_by','credit_override_at','credit_override_reason']),
        ('vouchers',              ARRAY['status','journal_entry_id']),
        ('purchase_invoices',     ARRAY['status','journal_entry_id','invoice_no']),
        ('stock_documents',       ARRAY['status','journal_entry_id','doc_no']),
        ('stock_document_lines',  ARRAY[]::text[]),
        ('journal_entries',       ARRAY['status','posted_at','posted_by','entry_no','reverses_entry_id']),
        ('sales_invoice_lines',   ARRAY['unit_cost']),
        ('invoice_payments',      ARRAY[]::text[]),
        ('purchase_invoice_lines',ARRAY[]::text[]),
        ('journal_lines',         ARRAY[]::text[])
    ) AS t(tbl, excl) LOOP
        SELECT string_agg(quote_ident(column_name), ', ') INTO v_cols
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = r.tbl AND column_name <> ALL (r.excl);
        EXECUTE format('GRANT UPDATE (%s) ON %I TO erp_app', v_cols, r.tbl);
    END LOOP;

    GRANT INSERT ON audit_logs TO erp_app;
    GRANT USAGE ON SEQUENCE audit_logs_id_seq TO erp_app;
    GRANT SELECT ON v_account_statement TO erp_app;

    -- callable API
    GRANT EXECUTE ON FUNCTION fn_current_tenant(), fn_assert_tenant(UUID), fn_next_no(UUID, UUID, TEXT),
        fn_base_currency(UUID), fn_fiscal_year_for(UUID, DATE),
        post_sales_invoice(UUID, UUID, UUID, VARCHAR), submit_offline_sale(UUID, JSONB, UUID, VARCHAR),
        reverse_sales_invoice(UUID, UUID, UUID, TEXT, UUID, DATE, VARCHAR),
        post_journal_entry(UUID, UUID, UUID, VARCHAR), post_voucher(UUID, UUID, UUID, VARCHAR), post_purchase_invoice(UUID, UUID, UUID, VARCHAR), post_stock_document(UUID, UUID, UUID, VARCHAR),
        resolve_sync_conflict(UUID, UUID, UUID, TEXT, TEXT, UUID, VARCHAR), approve_credit_override(UUID, UUID, UUID, TEXT, VARCHAR), fn_party_balance(UUID, UUID, UUID, DATE), close_fiscal_year(UUID, UUID, UUID, VARCHAR), reopen_fiscal_year(UUID, UUID, UUID, TEXT, VARCHAR),
        reverse_voucher(UUID, UUID, UUID, TEXT, UUID, DATE, VARCHAR), reverse_purchase_invoice(UUID, UUID, UUID, TEXT, DATE, VARCHAR),
        open_shift(UUID, UUID, UUID, UUID, NUMERIC, UUID, DATE, VARCHAR),
        close_shift(UUID, UUID, UUID, NUMERIC, DATE, VARCHAR), fn_shift_report(UUID, UUID),
        fn_auth_lookup(VARCHAR, VARCHAR)
    TO erp_app;
END $$;
