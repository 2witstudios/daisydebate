import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { fileURLToPath } from 'node:url';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const client = new SQL(url, { max: 1 });
try {
  await migrate(drizzle({ client }), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
} finally {
  await client.close();
}
