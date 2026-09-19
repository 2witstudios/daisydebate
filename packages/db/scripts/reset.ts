import { SQL } from 'bun';
const value = process.env.DATABASE_URL;
if (!value) throw new Error('DATABASE_URL required');
const url = new URL(value);
if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !['/daisy', '/daisy_test'].includes(url.pathname) ||
  process.env.ALLOW_DATABASE_RESET !== 'yes'
)
  throw new Error(
    'Reset requires local daisy/daisy_test and ALLOW_DATABASE_RESET=yes',
  );
const client = new SQL(value, { max: 1 });
try {
  await client`DROP SCHEMA IF EXISTS public CASCADE`;
  await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await client`CREATE SCHEMA public`;
} finally {
  await client.close();
}
await import('./migrate');
