/** PostgreSQL lexical variants shared by the classifier unit test and the real-PG proof. */
export const forbiddenConfiguration = [
  "UPDATE pg_catalog.pg_settings SET setting='0' WHERE name='statement_timeout'",
  'UPDATE "pg_catalog"."pg_settings" SET setting=\'0\' WHERE name=\'idle_in_transaction_session_timeout\'',
  "WITH changed AS (UPDATE pg_settings SET setting='0' WHERE name='lock_timeout' RETURNING name) SELECT * FROM changed",
  "EXPLAIN ANALYZE UPDATE pg_catalog.pg_settings SET setting='0' WHERE name='statement_timeout'",
  "SELECT 1 -- carriage return ends comment\r, pg_catalog.set_config('statement_timeout','0',true)",
  "SELECT 1 -- CRLF ends comment\r\n, pg_catalog.set_config('idle_in_transaction_session_timeout','0',true)",
  "SELECT pg_catalog.\"set_config\"('statement_timeout','0',true)",
  "SELECT pg_catalog.set_config /* documented whitespace */ ('idle_in_transaction_session_timeout','0',true)",
  'SELECT "pg_catalog"."set_config" /* nested /* inner */ outer */ (\'lock_timeout\',\'0\',true)',
  "SELECT pg_catalog.set_config -- newline\n ('statement_timeout','0',true)",
  "SELECT pg_catalog.U&\"set\\005fconfig\"('statement_timeout','0',true)",
  "SELECT pg_catalog.U&\"set!005fconfig\" UESCAPE '!'('statement_timeout','0',true)",
  "SELECT 'harmless set_config', pg_catalog.\"set_config\"('statement_timeout','0',true)",
  "SELECT $$harmless set_config$$, pg_catalog.\"set_config\"('statement_timeout','0',true)",
];

/** Configuration-looking words that PostgreSQL reads as literal data, with the value it returns. */
export const literalConfiguration: readonly (readonly [string, string])[] = [
  ["'set_config'", 'set_config'],
  ["'can''t call set_config'", "can't call set_config"],
  ['$$set_config /* is data */$$', 'set_config /* is data */'],
  [
    '$body$set_config $$ nested delimiter text$body$',
    'set_config $$ nested delimiter text',
  ],
  ["E'set_config\\ntext'", 'set_config\ntext'],
  ["E'can\\'t set_config'", "can't set_config"],
  ["U&'set\\005fconfig'", 'set_config'],
  ["E'prefix'\n'set_config'", 'prefixset_config'],
];
