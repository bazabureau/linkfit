#!/bin/sh
# Container entrypoint for every Linkfit API service (api / worker / scheduler).
#
# The image builds with `php artisan config:cache`, but a cached config file is
# read verbatim and IGNORES the runtime `environment:` vars docker-compose
# injects. Worse, the build runs without a real .env (it is .dockerignore'd), so
# any baked config would only hold env-defaults (sqlite, localhost, empty
# APP_KEY) — wrong for production.
#
# Clearing the cached config here makes the framework resolve config from the
# live environment at boot, so the values in docker-compose `environment:`
# always win. config:cache stays in the Dockerfile only to fail fast on syntax
# errors during build; runtime correctness comes from this clear.
set -e

php artisan config:clear >/dev/null 2>&1 || true

# Hand off to the container command (supervisord for `api`, or the queue/
# scheduler overrides for `worker`/`scheduler`).
exec "$@"
