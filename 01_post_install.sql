-- Run as superuser AFTER erp_schema_v2.1.sql.
ALTER FUNCTION fn_auth_lookup(VARCHAR, VARCHAR) OWNER TO erp_auth;
GRANT USAGE ON SCHEMA public TO erp_auth;
GRANT SELECT ON tenants, users, roles TO erp_auth;
