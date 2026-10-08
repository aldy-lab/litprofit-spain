#!/usr/bin/env bash
# Rebuilds db/install.sql -- the one file to paste into the SQL editor.
set -euo pipefail
cd "$(dirname "$0")/.."
sed -n '1,/^begin;$/p' db/install.sql > /tmp/ib-head.sql
{ cat /tmp/ib-head.sql; cat db/iberia.sql; echo; grep -v "^notify pgrst" db/iberia-access.sql; echo
  cat db/iberia-payroll.sql; echo; cat db/iberia-members.sql; echo; echo "commit;"
  echo "notify pgrst, 'reload config';"; echo "notify pgrst, 'reload schema';"; } > db/install.new
mv db/install.new db/install.sql
