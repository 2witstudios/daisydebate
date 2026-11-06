import { sql, type SQL } from 'drizzle-orm';
import { emailTrimCharacters } from '@daisy/protocol/email';

/** The persistence equivalent of the portable normalizeEmail function. */
export const normalizedEmailSql = (email: SQL) =>
  sql`lower(btrim(${email}, ${emailTrimCharacters}))`;
