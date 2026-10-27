/**
 * The logger's vocabulary (ADR 0015, ADR 0019): the event registry, the
 * loggable fields and their value kinds. It holds no I/O, so the ingest
 * admission (`./ingest`) judges shipped lines by it without loading pino.
 */
export const eventRegistry = {
  'runtime.initialize': 'info',
  'request.unhandled': 'error',
  'http.request.completed': 'info',
  'http.request.cancelled': 'warn',
  'http.request.failed': 'error',
  'invariant.violated': 'error',
  'auth.rate_limit.denied': 'warn',
  'auth.rate_limit.unavailable': 'error',
  'auth.rate_limit.network_denied': 'warn',
  'auth.session.unavailable': 'error',
  'auth.sign_out.failed': 'error',
  'mail.sent': 'info',
  'mail.failed': 'error',
  'mail.receipt_failed': 'error',
  'mail.suppressed': 'info',
  'mail.shed': 'warn',
  'mail.abandoned': 'error',
  'auth.magic_link.verified': 'info',
  'auth.passkey.enrolled': 'info',
  'auth.passkey.authenticated': 'info',
  'auth.passkey.removed': 'info',
  'auth.passkey.notification_failed': 'error',
  'auth.session.revoked': 'info',
  'auth.session.revoked_all': 'info',
  'auth.email_change.requested': 'info',
  'auth.email_change.verified': 'info',
  'auth.email_change.cleanup_failed': 'error',
  'round.media.unsafe': 'error',
  'round.media.fairness_degraded': 'warn',
  'round.judging.failed': 'error',
  'round.coaching.failed': 'error',
  'beta.mail.failed': 'error',
  'operator.request.refused': 'warn',
  'operator.command.applied': 'info',
  'operator.listener.started': 'info',
  'operator.listener.disabled': 'info',
  'round.control.failed': 'error',
  'round.speaking.failed': 'error',
  'round.maintenance.failed': 'error',
  'round.media.recovery_failed': 'error',
  'media.discovery.failed': 'error',
  'media.capture.failed': 'error',
  'realtime.outbox.actor_missing': 'warn',
  'realtime.outbox.drain_failed': 'error',
  'realtime.outbox.delivery_lag_estimated': 'info',
  'realtime.delivery.backlog': 'info',
  'realtime.connection.rejected': 'info',
  'realtime.subscription.unavailable': 'error',
  'db.query.failed': 'error',
  'db.capacity.refused': 'warn',
  'retention.sweep.completed': 'info',
  'retention.sweep.failed': 'error',
  'redis.command.failed': 'error',
  'server.start': 'info',
  'availability.sample_failed': 'error',
  'service.lease_failed': 'error',
  'server.ready': 'info',
  'server.shutdown': 'info',
  'ingress.trusted_proxy.unresolved': 'warn',
  'logship.started': 'info',
  'logship.insert.failed': 'error',
  'telemetry.unknown_event': 'warn',
} as const satisfies Record<string, 'info' | 'warn' | 'error'>;

export type EventName = keyof typeof eventRegistry;

/**
 * What a field value may be, by kind (ADR 0019). No kind admits an object,
 * an array, whitespace or a URL scheme, so a nested secret, a header pair,
 * a Bearer value or a credential URL cannot pass as any of them.
 */
export const fieldKinds = {
  /** An operation name, error code or enum literal. */
  code: (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value),
  /** A request, trace, principal or provider identifier. */
  id: (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value),
  /** A route pattern or URL path, never a query or fragment. */
  path: (value: unknown) =>
    typeof value === 'string' && /^\/[A-Za-z0-9_./[\]-]{0,199}$/.test(value),
  /** A SHA3-256 hex digest. */
  hash: (value: unknown) =>
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
  /** A non-negative integer: a duration, status, port or tally. */
  count: (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0,
} as const;
type FieldKind = keyof typeof fieldKinds;

/**
 * The only fields a log line may carry, each with the kind its value must
 * have; ADR 0019 holds the same table and a drift guard compares them.
 * Anything else, or a listed field of another kind, is left out.
 */
export const loggableFields = {
  operation: 'code',
  errorCode: 'code',
  source: 'code',
  sourceLevel: 'code',
  closeReason: 'code',
  cause: 'code',
  invariantId: 'code',
  requestId: 'id',
  traceId: 'id',
  userId: 'id',
  actorId: 'id',
  providerMessageId: 'id',
  route: 'path',
  path: 'path',
  clientIdHash: 'hash',
  durationMs: 'count',
  status: 'count',
  port: 'count',
  deleted: 'count',
  batches: 'count',
  closeCode: 'count',
  deliverySeqLagEstimate: 'count',
  retained: 'count',
  running: 'count',
  topics: 'count',
  oldestAgeMs: 'count',
  pending: 'count',
  scope: 'code',
  purpose: 'code',
} as const satisfies Record<string, FieldKind>;
