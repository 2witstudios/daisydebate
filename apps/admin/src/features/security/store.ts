import { createClient } from '@clickhouse/client-web';
import { z } from 'zod';
import { coverageSql, sections, type SecurityView } from './sections';

/** The read-only role ADR 0084 grants SELECT on `daisy_logs` and nothing else. */
const READER_USER = 'daisy_admin_reader';
/** The client gives up when the reader profile's own time limit does. */
const READ_TIMEOUT_MS = 10_000;

export type LogStoreConfig = {
  readonly url: string;
  readonly password: string;
};
export type Row = Readonly<Record<string, string | number | null>>;
/** A read either answered or did not; a failure is never an empty table. */
export type StoreRead<T> =
  { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'unreachable' };

export type SecurityStore = ReturnType<typeof createSecurityStore>;

/**
 * The coverage rows are parsed, not cast: a malformed heartbeat must never
 * read as a live shipper. Any row outside these shapes makes the read
 * `unreachable`.
 */
const chTimeText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/);
const count = z.union([z.string().regex(/^\d+$/), z.number().int().min(0)]);
export const coverageSchema = z.object({
  heartbeat: z
    .object({ at: chTimeText, nats_state: z.string(), reconnects: count })
    .nullable(),
  apps: z.array(z.object({ app: z.string(), last_received: chTimeText })),
  flow: z.array(z.object({ app: z.string(), admitted: count, dropped: count })),
  oldest: z.array(z.object({ store: z.string(), oldest: chTimeText })),
  lastSweep: chTimeText.nullable(),
});
export type CoverageRows = z.infer<typeof coverageSchema>;

/**
 * Reads the Security page's sections and coverage through the reader role.
 * Every statement is fixed text from `sections.ts` with bind parameters;
 * the client sends no settings, which the read-only profile would refuse.
 */
export function createSecurityStore(config: LogStoreConfig) {
  const client = createClient({
    url: config.url,
    username: READER_USER,
    password: config.password,
    request_timeout: READ_TIMEOUT_MS,
  });
  const rows = async (
    query: string,
    params: Readonly<Record<string, string>>,
  ): Promise<readonly Row[]> => {
    const result = await client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });
    return result.json<Row>();
  };
  /** One query at a time: a page holds at most one of the reader's four slots. */
  const inTurn = async (
    queries: readonly (readonly [string, Readonly<Record<string, string>>])[],
  ) => {
    const results: (readonly Row[])[] = [];
    for (const [query, params] of queries)
      results.push(await rows(query, params));
    return results;
  };
  const read = async <T>(work: () => Promise<T>): Promise<StoreRead<T>> => {
    try {
      return { kind: 'ok', value: await work() };
    } catch {
      return { kind: 'unreachable' };
    }
  };
  return {
    view: (
      view: SecurityView,
      bounds: { readonly from: string; readonly to: string },
    ) =>
      read(() =>
        inTurn(sections[view].map(({ sql }) => [sql, bounds] as const)),
      ),
    coverage: (bounds: { readonly floor: string; readonly recent: string }) =>
      read(async () => {
        const [heartbeat = [], apps = [], flow = [], oldest = [], sweep = []] =
          await inTurn([
            [coverageSql.heartbeat, { floor: bounds.floor }],
            [coverageSql.apps, { floor: bounds.floor }],
            [coverageSql.flow, { recent: bounds.recent }],
            [coverageSql.oldest, {}],
            [coverageSql.sweep, { floor: bounds.floor }],
          ]);
        return coverageSchema.parse({
          heartbeat: heartbeat[0] ?? null,
          apps,
          flow,
          oldest,
          lastSweep: sweep[0]?.last_sweep ?? null,
        });
      }),
  };
}
