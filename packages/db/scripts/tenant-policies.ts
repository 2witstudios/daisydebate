import { tenantPolicyStatements } from '../src/tenant-isolation';
import { tenantIsolationManifest } from '../src/tenant-isolation-manifest';

/**
 * Prints the row-level security statements for the named tenant-owned
 * tables, or for every one: the hand-written SQL a migration that adds such
 * a table appends (docs/operations/database.md).
 */
const names = new Set(process.argv.slice(2));
for (const entry of tenantIsolationManifest.tables)
  if (names.size === 0 || names.has(entry.table))
    process.stdout.write(
      `${tenantPolicyStatements(entry).join('\n--> statement-breakpoint\n')}\n--> statement-breakpoint\n`,
    );
