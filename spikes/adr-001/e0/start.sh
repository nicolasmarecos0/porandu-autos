#!/usr/bin/env bash
# E0 · PostgreSQL local + shim de Supabase para iterar el harness del spike.
# NO es evidencia para ADR-001 (ver e0/shim.sql). Debe correr como usuario no-root.
#
#   E0_DATA_DIR=/ruta/escribible PG_BIN=/usr/lib/postgresql/16/bin bash spikes/adr-001/e0/start.sh
set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATA_DIR="${E0_DATA_DIR:?definir E0_DATA_DIR}"
PORT="${E0_PORT:-55432}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$DATA_DIR/postmaster.pid" ]; then
  "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m fast stop || true
fi
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

PWFILE="$(mktemp)"
echo "supabase_admin" > "$PWFILE"
"$PG_BIN/initdb" -D "$DATA_DIR" -U supabase_admin --pwfile="$PWFILE" \
  --auth-host=scram-sha-256 --auth-local=trust -E UTF8 > /dev/null
rm -f "$PWFILE"

"$PG_BIN/pg_ctl" -D "$DATA_DIR" -w -l "$DATA_DIR/server.log" \
  -o "-p $PORT -k $DATA_DIR -c listen_addresses=127.0.0.1" start > /dev/null

"$PG_BIN/psql" -h "$DATA_DIR" -p "$PORT" -U supabase_admin -d postgres \
  -v ON_ERROR_STOP=1 -q -f "$HERE/shim.sql"

echo "E0 listo en 127.0.0.1:$PORT (migración: postgres/postgres)"
