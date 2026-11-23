import { integer, text } from 'drizzle-orm/pg-core';
import { jsonbColumn, jsonObjectSchema, timestampColumn } from './columns';
/**
 * Both canonical command logs store the same accepted receipt/digest metadata.
 * A log whose CHECK closes its command types passes that list, so `type`
 * carries it.
 */
export const acceptedCommandColumns = <
  const Types extends readonly string[] = readonly string[],
>() => ({
  type: text('type').$type<Types[number]>().notNull(),
  payloadDigest: text('payload_digest').notNull(),
  result: jsonbColumn('result', jsonObjectSchema).notNull(),
  resultingVersion: integer('resulting_version').notNull(),
  appliedAt: timestampColumn('applied_at').notNull(),
});
