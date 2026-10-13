#!/usr/bin/env bash
# Recria a base de dados de teste local e aplica stubs + migrações.
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="psql -v ON_ERROR_STOP=1 -q ${PGTEST_URL:-postgresql://postgres@localhost:54329/postgres}"
DB=${PGTEST_DB:-pioneiros_test}
$PSQL -c "drop database if exists $DB with (force)" -c "create database $DB"
URL="${PGTEST_BASE:-postgresql://postgres@localhost:54329}/$DB"
psql -v ON_ERROR_STOP=1 -q "$URL" -f tests/db/supabase-stubs.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q "$URL" -f "$f"; done
echo "Base de dados de teste pronta: $URL"
