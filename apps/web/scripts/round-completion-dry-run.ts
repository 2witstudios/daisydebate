#!/usr/bin/env bun
/**
 * Read-only: what ADR 0095 would do to the named Rounds on deploy (ISSUE-906).
 * Metadata only, inside a READ ONLY transaction: no text, no writes.
 *
 *   DATABASE_URL=<read-only target> bun apps/web/scripts/round-completion-dry-run.ts <roundId>...
 */
import { idSchema } from '@daisy/protocol';
import { SQL } from 'bun';
import {
  predictRoundCompletion,
  readDryRunFacts,
} from '../src/features/round-finalization/completion-dry-run';

const roundIds = process.argv.slice(2);
const url = process.env['DATABASE_URL'];
if (
  !url ||
  roundIds.length === 0 ||
  !roundIds.every((id) => idSchema.safeParse(id).success)
) {
  console.error(
    'Usage: DATABASE_URL=... round-completion-dry-run <roundId>...',
  );
  process.exit(2);
}
const sql = new SQL(url, { max: 1 });
try {
  for (const roundId of roundIds) {
    const facts = await readDryRunFacts(sql, roundId);
    console.log(
      JSON.stringify(
        facts ? predictRoundCompletion(facts) : { roundId, found: false },
        null,
        2,
      ),
    );
  }
} finally {
  await sql.close();
}
