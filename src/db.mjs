import { URL } from 'url';

import { Client } from 'pg';

import { log } from './logs.mjs';

function pgConfigFromEnv() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const u = new URL(dbUrl);
      const cfg = {
        host: u.hostname,
        port: u.port || 5432,
        user: u.username || process.env.PGUSER,
        database: u.pathname ? u.pathname.replace(/^\//, '') : process.env.PGDATABASE,
        connectionTimeoutMillis: 10000,
      };

      if (process.env.PGPASSWORD) {
        cfg.password = process.env.PGPASSWORD;
      } else if (u.password) {
        cfg.password = u.password;
      }

      // Avoid logging possibly sensitive user identifiers or full connection strings.
      const safeUser = cfg.user ? String(cfg.user).replace(/.(?=.{2,}@?)/g, '*') : undefined;
      log(`Using Postgres host=${cfg.host} db=${cfg.database} user=${safeUser}`);
      return cfg;
    } catch {
      // ignore parse errors
    }
  }

  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    connectionTimeoutMillis: 10000,
  };
}

const pgClient = new Client(pgConfigFromEnv());

export async function connectDb() {
  await pgClient.connect();
}

export async function closeDb() {
  try {
    await pgClient.end();
  } catch {
    /* ignore close errors */
  }
}

export { pgClient };
