-- Run ONCE per PostgreSQL cluster, as a superuser, BEFORE erp_schema_v2.1.sql.
--   erp_owner : owns every table/function. NOT superuser and NOT BYPASSRLS, so FORCE RLS applies to it too.
--   erp_app   : the role the Next.js API connects as (via login role that is a member of it).
--   erp_auth  : owns ONLY fn_auth_lookup(); BYPASSRLS because login happens before the tenant is known.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_owner') THEN CREATE ROLE erp_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app')   THEN CREATE ROLE erp_app   NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_auth')  THEN CREATE ROLE erp_auth  NOLOGIN NOSUPERUSER BYPASSRLS;   END IF;
END $$;
