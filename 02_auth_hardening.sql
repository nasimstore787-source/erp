-- Login hardening (run as superuser AFTER erp_schema_v2.1.sql and 01_post_install.sql).
--  * the app role can no longer read password hashes or 2FA secrets, nor write them directly
--  * failed-login throttling that behaves the same for unknown and known users (no account enumeration)
--  * TOTP secrets (encrypted by the API), single-use recovery codes, and token_version so a password change / disabled user kills old sessions
\set ON_ERROR_STOP on

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret_enc     TEXT,
  ADD COLUMN IF NOT EXISTS recovery_hashes     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS totp_last_step      BIGINT,
  ADD COLUMN IF NOT EXISTS token_version       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

REVOKE ALL ON users FROM erp_app;
GRANT SELECT (id, tenant_id, branch_id, role_id, username, full_name_ar, two_fa_enabled, is_active, created_at, token_version) ON users TO erp_app;
GRANT UPDATE (branch_id, role_id, full_name_ar, is_active) ON users TO erp_app;
GRANT UPDATE (totp_last_step, recovery_hashes) ON users TO erp_auth;

-- ---------- throttle: keyed by TEXT (tenant:username), so it works before a user is known ----------
CREATE TABLE IF NOT EXISTS login_throttle (
  key          TEXT PRIMARY KEY,
  fails        INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE login_throttle OWNER TO erp_auth;
REVOKE ALL ON login_throttle FROM PUBLIC;

CREATE OR REPLACE FUNCTION fn_login_gate(p_key TEXT) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT GREATEST(CEIL(EXTRACT(EPOCH FROM (locked_until - now())))::int, 0) FROM login_throttle WHERE key = p_key), 0)
$$;

CREATE OR REPLACE FUNCTION fn_login_failed(p_key TEXT, p_max INT, p_lock_secs INT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v INT;
BEGIN
  DELETE FROM login_throttle WHERE updated_at < now() - interval '7 days';
  INSERT INTO login_throttle (key, fails, updated_at) VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE
     SET fails = CASE WHEN login_throttle.updated_at < now() - interval '1 day' THEN 1 ELSE login_throttle.fails + 1 END, updated_at = now()
  RETURNING fails INTO v;
  IF v >= p_max THEN UPDATE login_throttle SET locked_until = now() + make_interval(secs => p_lock_secs) WHERE key = p_key; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fn_login_ok(p_key TEXT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ DELETE FROM login_throttle WHERE key = p_key $$;

-- ---------- pre-login helpers (owned by the BYPASSRLS role) ----------
CREATE OR REPLACE FUNCTION fn_auth_secrets(p_user UUID)
RETURNS TABLE (out_totp_secret_enc TEXT, out_recovery_hashes JSONB, out_token_version INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT totp_secret_enc, recovery_hashes, token_version FROM users WHERE id = p_user
$$;

-- true only if this TOTP step is newer than any step already used (a code cannot be replayed)
CREATE OR REPLACE FUNCTION fn_auth_totp_used(p_user UUID, p_step BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET totp_last_step = p_step WHERE id = p_user AND (totp_last_step IS NULL OR totp_last_step < p_step);
  RETURN FOUND;
END $$;

-- a recovery code is consumed by swapping the whole list; the compare-and-swap makes two simultaneous uses impossible
CREATE OR REPLACE FUNCTION fn_auth_use_recovery(p_user UUID, p_old JSONB, p_new JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET recovery_hashes = p_new WHERE id = p_user AND recovery_hashes = p_old;
  RETURN FOUND;
END $$;

ALTER FUNCTION fn_login_gate(TEXT) OWNER TO erp_auth;
ALTER FUNCTION fn_login_failed(TEXT, INT, INT) OWNER TO erp_auth;
ALTER FUNCTION fn_login_ok(TEXT) OWNER TO erp_auth;
ALTER FUNCTION fn_auth_secrets(UUID) OWNER TO erp_auth;
ALTER FUNCTION fn_auth_totp_used(UUID, BIGINT) OWNER TO erp_auth;
ALTER FUNCTION fn_auth_use_recovery(UUID, JSONB, JSONB) OWNER TO erp_auth;

-- ---------- post-login helpers (tenant-scoped, owned by erp_owner so FORCE RLS and fn_assert_tenant apply) ----------
CREATE OR REPLACE FUNCTION fn_user_credentials(p_tenant UUID, p_user UUID)
RETURNS TABLE (out_password_hash TEXT, out_two_fa_enabled BOOLEAN, out_totp_secret_enc TEXT, out_recovery_hashes JSONB, out_token_version INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM fn_assert_tenant(p_tenant);
  RETURN QUERY SELECT u.password_hash, u.two_fa_enabled, u.totp_secret_enc, u.recovery_hashes, u.token_version FROM users u WHERE u.tenant_id = p_tenant AND u.id = p_user;
END $$;

CREATE OR REPLACE FUNCTION fn_user_set_password(p_tenant UUID, p_user UUID, p_hash TEXT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v INT;
BEGIN
  PERFORM fn_assert_tenant(p_tenant);
  UPDATE users SET password_hash = p_hash, password_changed_at = now(), token_version = token_version + 1
  WHERE tenant_id = p_tenant AND id = p_user RETURNING token_version INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: user'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fn_user_set_2fa(p_tenant UUID, p_user UUID, p_secret_enc TEXT, p_enabled BOOLEAN, p_recovery JSONB, p_bump BOOLEAN) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v INT;
BEGIN
  PERFORM fn_assert_tenant(p_tenant);
  UPDATE users SET totp_secret_enc = p_secret_enc, two_fa_enabled = p_enabled, recovery_hashes = COALESCE(p_recovery, '[]'::jsonb),
                   totp_last_step = CASE WHEN p_secret_enc IS DISTINCT FROM totp_secret_enc THEN NULL ELSE totp_last_step END,
                   token_version = token_version + CASE WHEN p_bump THEN 1 ELSE 0 END
  WHERE tenant_id = p_tenant AND id = p_user RETURNING token_version INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: user'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fn_user_bump_tokens(p_tenant UUID, p_user UUID) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v INT;
BEGIN
  PERFORM fn_assert_tenant(p_tenant);
  UPDATE users SET token_version = token_version + 1 WHERE tenant_id = p_tenant AND id = p_user RETURNING token_version INTO v;
  RETURN v;
END $$;

ALTER FUNCTION fn_user_credentials(UUID, UUID) OWNER TO erp_owner;
ALTER FUNCTION fn_user_set_password(UUID, UUID, TEXT) OWNER TO erp_owner;
ALTER FUNCTION fn_user_set_2fa(UUID, UUID, TEXT, BOOLEAN, JSONB, BOOLEAN) OWNER TO erp_owner;
ALTER FUNCTION fn_user_bump_tokens(UUID, UUID) OWNER TO erp_owner;

REVOKE ALL ON FUNCTION fn_login_gate(TEXT), fn_login_failed(TEXT, INT, INT), fn_login_ok(TEXT), fn_auth_secrets(UUID), fn_auth_totp_used(UUID, BIGINT),
  fn_auth_use_recovery(UUID, JSONB, JSONB), fn_user_credentials(UUID, UUID), fn_user_set_password(UUID, UUID, TEXT),
  fn_user_set_2fa(UUID, UUID, TEXT, BOOLEAN, JSONB, BOOLEAN), fn_user_bump_tokens(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_login_gate(TEXT), fn_login_failed(TEXT, INT, INT), fn_login_ok(TEXT), fn_auth_secrets(UUID), fn_auth_totp_used(UUID, BIGINT),
  fn_auth_use_recovery(UUID, JSONB, JSONB), fn_user_credentials(UUID, UUID), fn_user_set_password(UUID, UUID, TEXT),
  fn_user_set_2fa(UUID, UUID, TEXT, BOOLEAN, JSONB, BOOLEAN), fn_user_bump_tokens(UUID, UUID) TO erp_app;
