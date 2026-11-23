import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = path.resolve(here, '../../db');
export const TEST_DB = 'erp_api_test';
export const TEST_PASSWORD = 'demo1234';

const psqlAsPostgres = (args: string) => execFileSync('su', ['postgres', '-c', `psql -X -q -v ON_ERROR_STOP=1 ${args}`], { stdio: ['ignore', 'pipe', 'pipe'] });

// Fresh database for every run: schema -> dev login role -> demo tenant with bcrypt passwords.
export default function setup() {
  execFileSync('bash', [path.join(db, 'build_db.sh'), TEST_DB], { stdio: 'pipe' });
  psqlAsPostgres(`-d ${TEST_DB} -f ${db}/02_auth_hardening.sql`);
  psqlAsPostgres(`-f ${db}/dev_roles.sql`);
  const hash = bcrypt.hashSync(TEST_PASSWORD, 4);
  psqlAsPostgres(`-d ${TEST_DB} -v pwhash='${hash}' -f ${db}/seed_demo.sql`);
}
