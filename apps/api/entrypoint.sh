#!/bin/sh
set -e

# Wait for DB if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "Checking database connection..."
  node -e "
    const net = require('net');
    const url = new URL(process.env.DATABASE_URL);
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > 60000) {
        console.error('Timeout waiting for database');
        process.exit(1);
      }
      const client = net.connect({ port: url.port || 5432, host: url.hostname }, () => {
        client.end();
        console.log('Database is reachable');
        process.exit(0);
      });
      client.on('error', () => {
        setTimeout(check, 1000);
      });
    };
    check();
  "
fi

echo "Running database migrations..."
npm run migrate:up:prod

echo "Starting application..."
exec "$@"
