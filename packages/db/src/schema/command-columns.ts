import { integer, text } from 'drizzle-orm/pg-core';
import { jsonbColumn, jsonObjectSchema, timestampColumn } from './columns';
/** Both canonical command logs store the same accepted receipt/digest metadata. */
export const acceptedCommandColumns = () => ({
  type: text('type').notNull(),
  payloadDigest: text('payload_digest').notNull(),
  result: jsonbColumn('result', jsonObjectSchema).notNull(),
  resultingVersion: integer('resulting_version').notNull(),
  appliedAt: timestampColumn('applied_at').notNull(),
});
