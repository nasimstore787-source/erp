-- Dev/test only: the login role the API connects as (member of erp_app). Run as superuser once per cluster.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_api') THEN
    CREATE ROLE erp_api LOGIN PASSWORD 'erp_api_dev' NOSUPERUSER NOBYPASSRLS IN ROLE erp_app;
  END IF;
END $$;
