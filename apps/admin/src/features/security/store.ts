import { createClient } from '@clickhouse/client-web';
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
        Promise.all(sections[view].map(({ sql }) => rows(sql, bounds))),
      ),
    coverage: (bounds: { readonly floor: string; readonly recent: string }) =>
      read(async () => {
        const [heartbeat, apps, flow, oldest, sweep] = await Promise.all([
          rows(coverageSql.heartbeat, { floor: bounds.floor }),
          rows(coverageSql.apps, { floor: bounds.floor }),
          rows(coverageSql.flow, { recent: bounds.recent }),
          rows(coverageSql.oldest, {}),
          rows(coverageSql.sweep, { floor: bounds.floor }),
        ]);
        return {
          heartbeat: heartbeat[0] ?? null,
          apps,
          flow,
          oldest,
          lastSweep: (sweep[0]?.last_sweep as string | undefined) ?? null,
        };
      }),
  };
}
