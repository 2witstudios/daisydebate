/**
 * The Security page's views (ADR 0081): each one a fixed set of SQL
 * statements over `daisy_logs`, bounded by the `{from}`/`{to}` bind
 * parameters of the chosen window and by a LIMIT. No request text ever
 * reaches the SQL; the reader role's profile bounds the work besides.
 */
export const securityViews = [
  'auth',
  'operator',
  'realtime',
  'invariants',
  'errors',
] as const;
export type SecurityView = (typeof securityViews)[number];

type Column = { readonly key: string; readonly label: string };
export type Section = {
  readonly title: string;
  readonly sql: string;
  readonly columns: readonly Column[];
};

/** Every query reads only rows received inside the window. */
const inWindow =
  'received_at >= {from:DateTime64(3)} AND received_at < {to:DateTime64(3)}';
const authEvents = `event IN ('auth.rate_limit.denied', 'auth.rate_limit.unavailable', 'auth.rate_limit.network_denied', 'auth.session.unavailable')`;
const count: Column = { key: 'n', label: 'Count' };
const when: Column = { key: 'received_at', label: 'Received (UTC)' };

export const sections: Readonly<Record<SecurityView, readonly Section[]>> = {
  auth: [
    {
      title: 'Denials and limiter failures',
      sql: `SELECT event, path, scope, count() AS n FROM daisy_logs.events
        WHERE ${inWindow} AND ${authEvents}
        GROUP BY event, path, scope ORDER BY n DESC LIMIT 100`,
      columns: [
        { key: 'event', label: 'Event' },
        { key: 'path', label: 'Path' },
        { key: 'scope', label: 'Scope' },
        count,
      ],
    },
    {
      title: 'Most limited clients',
      sql: `SELECT client_id_hash, count() AS n FROM daisy_logs.events
        WHERE ${inWindow} AND event = 'auth.rate_limit.denied'
          AND client_id_hash IS NOT NULL
        GROUP BY client_id_hash ORDER BY n DESC LIMIT 20`,
      columns: [{ key: 'client_id_hash', label: 'Client (hashed)' }, count],
    },
    {
      title: 'Latest',
      sql: `SELECT received_at, event, service, path, request_id
        FROM daisy_logs.events WHERE ${inWindow} AND ${authEvents}
        ORDER BY received_at DESC LIMIT 50`,
      columns: [
        when,
        { key: 'event', label: 'Event' },
        { key: 'service', label: 'Service' },
        { key: 'path', label: 'Path' },
        { key: 'request_id', label: 'Request' },
      ],
    },
  ],
  operator: [
    {
      title: 'Refused operator API requests',
      sql: `SELECT cause, count() AS n FROM daisy_logs.events
        WHERE ${inWindow} AND event = 'operator.request.refused'
        GROUP BY cause ORDER BY n DESC LIMIT 50`,
      columns: [{ key: 'cause', label: 'Stage' }, count],
    },
    {
      title: 'Applied operator commands',
      sql: `SELECT received_at, request_id, user_id, cause
        FROM daisy_logs.events
        WHERE ${inWindow} AND event = 'operator.command.applied'
        ORDER BY received_at DESC LIMIT 50`,
      columns: [
        when,
        { key: 'request_id', label: 'Command' },
        { key: 'user_id', label: 'Target' },
        { key: 'cause', label: 'Outcome' },
      ],
    },
  ],
  realtime: [
    {
      title: 'Closed connections',
      sql: `SELECT close_code, close_reason, cause, count() AS n,
          max(received_at) AS last_seen
        FROM daisy_logs.events
        WHERE ${inWindow} AND event = 'realtime.connection.rejected'
        GROUP BY close_code, close_reason, cause ORDER BY n DESC LIMIT 50`,
      columns: [
        { key: 'close_code', label: 'Code' },
        { key: 'close_reason', label: 'Reason' },
        { key: 'cause', label: 'Cause' },
        count,
        { key: 'last_seen', label: 'Last seen (UTC)' },
      ],
    },
  ],
  invariants: [
    {
      title: 'Invariant violations',
      sql: `SELECT invariant_id, operation, count() AS n,
          max(received_at) AS last_seen
        FROM daisy_logs.events
        WHERE ${inWindow} AND event = 'invariant.violated'
        GROUP BY invariant_id, operation ORDER BY n DESC LIMIT 100`,
      columns: [
        { key: 'invariant_id', label: 'Invariant' },
        { key: 'operation', label: 'Operation' },
        count,
        { key: 'last_seen', label: 'Last seen (UTC)' },
      ],
    },
  ],
  errors: [
    {
      title: 'Errors per hour by event and service',
      sql: `SELECT toStartOfHour(received_at) AS hour, event, service,
          count() AS n
        FROM daisy_logs.events WHERE ${inWindow} AND severity = 'error'
        GROUP BY hour, event, service ORDER BY hour DESC, n DESC LIMIT 500`,
      columns: [
        { key: 'hour', label: 'Hour (UTC)' },
        { key: 'event', label: 'Event' },
        { key: 'service', label: 'Service' },
        count,
      ],
    },
    {
      title: 'Lines the shipper refused',
      sql: `SELECT app, reason, sum(count) AS n FROM daisy_logs.shipper_drops
        WHERE minute >= {from:DateTime64(3)} AND minute < {to:DateTime64(3)}
        GROUP BY app, reason ORDER BY n DESC LIMIT 100`,
      columns: [
        { key: 'app', label: 'App' },
        { key: 'reason', label: 'Reason' },
        count,
      ],
    },
  ],
};

/** The coverage reads, independent of any event count. */
export const coverageSql = {
  heartbeat: `SELECT at, nats_state, reconnects, buffered
    FROM daisy_logs.shipper_heartbeats
    WHERE at >= {floor:DateTime64(3)} ORDER BY at DESC LIMIT 1`,
  apps: `SELECT app, max(received_at) AS last_received
    FROM daisy_logs.events WHERE received_at >= {floor:DateTime64(3)}
    GROUP BY app ORDER BY app LIMIT 50`,
  oldest: `SELECT 'events' AS store, min(received_at) AS oldest FROM daisy_logs.events
    UNION ALL SELECT 'shipper_drops', min(minute) FROM daisy_logs.shipper_drops
    UNION ALL SELECT 'shipper_heartbeats', min(at) FROM daisy_logs.shipper_heartbeats`,
} as const;
