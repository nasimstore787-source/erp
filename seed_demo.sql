-- Demo tenant: psql -v pwhash='<bcrypt>' -f seed_demo.sql   (run as superuser against a freshly built DB)
\set ON_ERROR_STOP on
SELECT set_config('app.seed_pwhash', :'pwhash', false);   -- psql variables are not expanded inside DO bodies
SET ROLE erp_owner;
DO $$
DECLARE
  v_t UUID := gen_random_uuid(); v_branch UUID; v_fy UUID; v_wh UUID; v_unit UUID; v_grp UUID; v_je UUID; v_cur UUID;
  v_mgr_role UUID; v_cash_role UUID; v_total NUMERIC := 0; r RECORD;
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::int;
BEGIN
  PERFORM set_config('app.current_tenant_id', v_t::text, true);
  INSERT INTO tenants(id, code, name_ar) VALUES (v_t, 'DEMO', 'متجر تجريبي');
  PERFORM fn_seed_tenant_accounting(v_t, 'YER');
  INSERT INTO branches(tenant_id, code, name_ar, is_default) VALUES (v_t, 'B1', 'الفرع الرئيسي', true) RETURNING id INTO v_branch;
  INSERT INTO fiscal_years(tenant_id, name, start_date, end_date)
  VALUES (v_t, v_year::text, make_date(v_year,1,1), make_date(v_year,12,31)) RETURNING id INTO v_fy;
  INSERT INTO roles(tenant_id, name_ar, can_post, can_reverse, can_view_cost, can_view_cash_balance, can_give_discount) VALUES (v_t, 'مدير', true, true, true, true, true) RETURNING id INTO v_mgr_role;
  INSERT INTO roles(tenant_id, name_ar, can_post, can_reverse) VALUES (v_t, 'كاشير', true, false) RETURNING id INTO v_cash_role;
  INSERT INTO users(tenant_id, branch_id, role_id, username, full_name_ar, password_hash) VALUES
    (v_t, v_branch, v_mgr_role,  'mgr',     'أحمد المدير',  current_setting('app.seed_pwhash')),
    (v_t, v_branch, v_cash_role, 'cashier', 'سعيد الكاشير', current_setting('app.seed_pwhash')),
    (v_t, v_branch, v_cash_role, 'cashier2', 'خالد الكاشير', current_setting('app.seed_pwhash'));
  INSERT INTO warehouses(tenant_id, branch_id, code, name_ar, inventory_account_id, is_default)
  SELECT v_t, v_branch, 'W1', 'المخزن الرئيسي', a.id, true FROM accounts a WHERE a.tenant_id = v_t AND a.code = '110401' RETURNING id INTO v_wh;
  INSERT INTO item_groups(tenant_id, group_code, name_ar) VALUES (v_t, '201', 'عام') RETURNING id INTO v_grp;
  INSERT INTO units(tenant_id, name_ar) VALUES (v_t, 'قطعة') RETURNING id INTO v_unit;
  SELECT id INTO v_cur FROM currencies WHERE tenant_id = v_t AND is_base;

  INSERT INTO journal_entries(tenant_id, branch_id, fiscal_year_id, entry_date, source_type, created_by)
  SELECT v_t, v_branch, v_fy, make_date(v_year,1,1), 'OPENING', u.id FROM users u WHERE u.tenant_id = v_t AND u.username = 'mgr' RETURNING id INTO v_je;

  FOR r IN SELECT * FROM (VALUES
      ('1001','6281001','أرز بسمتي 5 كجم',        4500, 3200, 40),
      ('1002','6281002','سكر ناعم 1 كجم',         1200,  800, 80),
      ('1003','6281003','زيت طبخ 1.5 لتر',        2600, 1900, 30),
      ('1004','6281004','دقيق أبيض 10 كجم',       5200, 4100, 25),
      ('1005','6281005','شاي أحمر 100 كيس',       1800, 1300, 50),
      ('1006','6281006','حليب مجفف 900 جم',       3900, 3000, 20),
      ('1007','6281007','معكرونة 400 جم',          500,  320, 120),
      ('1008','6281008','تونة معلبة',              900,  650, 60),
      ('1009','6281009','مياه معدنية 600 مل',      200,  120, 200),
      ('1010','6281010','عصير برتقال 1 لتر',       700,  450, 70),
      ('1011','6281011','صابون سائل',             1500, 1000, 35),
      ('1012','6281012','منظف أرضيات',            1100,  750, 3)
  ) x(code, barcode, name, price, cost, qty) LOOP
    INSERT INTO items(tenant_id, group_id, item_code, barcode, name_ar, base_unit_id, default_sale_price, default_purchase_price)
    VALUES (v_t, v_grp, r.code, r.barcode, r.name, v_unit, r.price, r.cost);
    INSERT INTO stock_balances(tenant_id, warehouse_id, item_id, qty_on_hand, moving_avg_cost)
    SELECT v_t, v_wh, i.id, r.qty, r.cost FROM items i WHERE i.tenant_id = v_t AND i.item_code = r.code;
    v_total := v_total + r.qty * r.cost;
  END LOOP;

  INSERT INTO journal_lines(tenant_id, journal_entry_id, account_id, currency_id, debit_original, debit_base, credit_original, credit_base)
  SELECT v_t, v_je, a.id, v_cur, d, d, k, k FROM (VALUES ('110401', v_total, 0::numeric), ('310101', 0::numeric, v_total)) v(code, d, k)
  JOIN accounts a ON a.tenant_id = v_t AND a.code = v.code;
  UPDATE journal_entries SET status = 'POSTED', posted_by = created_by, posted_at = NOW() WHERE id = v_je;

  INSERT INTO parties(tenant_id, party_type, code, name_ar, account_id, credit_limit)
  SELECT v_t, 'CUSTOMER', x.code, x.name, a.id, x.lim FROM accounts a,
    (VALUES ('C001','مؤسسة النور التجارية', 50000), ('C002','بقالة الأمل', 20000), ('C003','عميل بلا سقف', 0)) x(code, name, lim)
  WHERE a.tenant_id = v_t AND a.code = '110301';
END $$;
