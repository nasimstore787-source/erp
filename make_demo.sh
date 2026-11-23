#!/bin/bash
# Builds the demo database (dev only):  db/make_demo.sh [dbname]   -> login DEMO / mgr or cashier / password demo1234
set -e; D=$(cd "$(dirname "$0")" && pwd); DB=${1:-erp_demo}
bash "$D/build_db.sh" "$DB"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $D/02_auth_hardening.sql"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -f $D/dev_roles.sql"
HASH=$(cd "$D/../api" && node -e "console.log(require('bcryptjs').hashSync('demo1234', 10))")
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -v pwhash='$HASH' -f $D/seed_demo.sql"
echo "DEMO READY: $DB"
