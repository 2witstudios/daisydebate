import { defineConfig } from 'drizzle-kit';
// The admin app's own database (ADR 0076); generation needs no connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});
