#!/bin/bash
# usage: build_db.sh <dbname>   (run as root; uses the local postgres superuser)
set -e
DB=${1:-erp_v21}; D=$(cd "$(dirname "$0")" && pwd)
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS $DB'" 2>/dev/null
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -f $D/00_bootstrap_roles.sql"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -c 'CREATE DATABASE $DB OWNER erp_owner'"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -c 'SET ROLE erp_owner' -f $D/erp_schema_v2.1.sql" 2>&1 | grep -v 'NOTICE' || true
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $D/01_post_install.sql"
echo "BUILD OK: $DB"
