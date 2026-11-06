#!/usr/bin/env bash
# Read-only check that the local tx-agent-kit stack is worth driving.
# Exit 0 only when every component is up, migrated, and owned by this checkout.
set -euo pipefail

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$repo_root"
# shellcheck disable=SC1091
source scripts/lib/source-env.sh
source_env .env

api="http://127.0.0.1:${API_PORT:-4000}"
web="http://127.0.0.1:${WEB_PORT:-3000}"
failures=0

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok    ${label}"
  else
    echo "FAIL  ${label}"
    failures=$((failures + 1))
  fi
}

latest_migration_applied() {
  local latest applied
  latest="$(ls packages/infra/db/drizzle/migrations | grep -E '^[0-9]{4}_.*\.sql$' | sort | tail -n 1)"
  applied="$(psql "$DATABASE_URL" -Atc "select name from __tx_agent_migrations order by name desc limit 1")"
  [[ -n "$latest" && "$latest" == "$applied" ]]
}

worker_polls_task_queue() {
  temporal task-queue describe --address "${TEMPORAL_ADDRESS:-localhost:7233}" \
    --namespace "${TEMPORAL_NAMESPACE:-default}" --task-queue "${TEMPORAL_TASK_QUEUE:-tx-agent-kit}" |
    grep -Eq '^ +[A-Z]+ +workflow +[^ ]+@'
}

orb_services_active() {
  local listing name
  listing="$(amp orb service list)"
  for name in postgres redis temporal api worker web; do
    grep -Eq "^amp-svc-${name} active " <<<"$listing" || return 1
  done
}

if [[ "${AMP_ORB:-}" == "1" ]]; then
  check "orb services postgres redis temporal api worker web are active" orb_services_active
fi
check "postgres reachable at DATABASE_URL" psql "$DATABASE_URL" -Atc 'select 1'
check "latest migration applied" latest_migration_applied
check "redis answers PING" bash -c "[[ \"\$(redis-cli -u '${REDIS_URL:-redis://127.0.0.1:6379}' ping)\" == PONG ]]"
check "temporal cluster SERVING" bash -c "temporal operator cluster health --address '${TEMPORAL_ADDRESS:-localhost:7233}' | grep -q SERVING"
check "worker polls the temporal task queue" worker_polls_task_queue
check "api ${api}/health is healthy" bash -c "curl -fsS --max-time 5 '${api}/health' | grep -q '\"status\":\"healthy\"'"
check "web ${web}/sign-in renders" curl -fsS --max-time 60 -o /dev/null "${web}/sign-in"

if ((failures > 0)); then
  echo "doctor: ${failures} check(s) failed; do not drive this instance"
  exit 1
fi
echo "doctor: stack ready"
