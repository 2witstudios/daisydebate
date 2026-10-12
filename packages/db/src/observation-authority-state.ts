import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  observationResourceKey,
  observationBaseSchema,
  type ObservationHeader,
} from '@daisy/protocol';
import { observationEvidence } from './observation-evidence';
import type {
  ObservationAuthorityContext,
  ObservationAuthorityDecision,
  ObservationAuthorityResult,
  ObservationBinding,
} from './observation-contracts';
import { readObservationHeaders } from './observation-headers';

type Session = ObservationAuthorityContext['session'];
const matchingAccount = (
  binding: ObservationBinding,
  account: ObservationAuthorityContext['account'] | undefined,
) =>
  account?.member &&
  !account.erased &&
  account.actorId === binding.principal.actorId &&
  account.userId === binding.principal.userId;
/** The parent account fences are already held; this reads no token or raw identity/profile facts. */
export async function observationSessions(
  tx: Pick<BunSQLDatabase, 'execute'>,
  bindings: readonly ObservationBinding[],
  databaseNow: string,
  accounts: ReadonlyMap<string, ObservationAuthorityContext['account']>,
) {
  const ids = [...new Set(bindings.map((b) => b.principal.sessionId))];
  const rows = await tx.execute(
    sql`select id,user_id as "userId",expires_at as "expiresAt" from public.session where id=any(${`{${ids.join(',')}}`}::text[])`,
  );
  const bySession = new Map(rows.map((row) => [row.id, row]));
  const sessions = new Map<string, Session>();
  for (const binding of bindings) {
    const principal = binding.principal,
      account = accounts.get(principal.actorId),
      row = bySession.get(principal.sessionId);
    if (
      account &&
      matchingAccount(binding, account) &&
      row?.userId === principal.userId &&
      row.expiresAt instanceof Date &&
      row.expiresAt.getTime() > Date.parse(databaseNow)
    )
      sessions.set(principal.sessionId, {
        ...principal,
        expiresAt: row.expiresAt.toISOString(),
        account,
      });
  }
  return sessions;
}
export async function observationCurrentHeaders(
  tx: Pick<BunSQLDatabase, 'execute'>,
  bindings: readonly ObservationBinding[],
) {
  const resources = [
    ...new Map(
      bindings.map((b) => [observationResourceKey(b.resource), b.resource]),
    ).values(),
  ];
  const headers: ObservationHeader[] = [];
  for (let start = 0; start < resources.length; start += 128)
    headers.push(
      ...(await readObservationHeaders(
        tx,
        resources.slice(start, start + 128),
      )),
    );
  return new Map(headers.map((h) => [observationResourceKey(h.resource), h]));
}
export function allowedObservationAuthority(
  binding: ObservationBinding,
  session: Session,
  decision: Extract<ObservationAuthorityDecision, { status: 'allowed' }>,
  header: ObservationHeader,
  databaseNow: string,
): ObservationAuthorityResult {
  const resourceKey = observationResourceKey(binding.resource);
  const subject = observationEvidence(
    [
      {
        key: `account-${binding.principal.actorId}`,
        revision: String(session.account.revision),
        nextBoundary: null,
      },
      {
        key: `session-${session.sessionId}`,
        revision: JSON.stringify([session.userId, session.expiresAt]),
        nextBoundary: session.expiresAt,
      },
    ],
    databaseNow,
    session.expiresAt,
  );
  const cohortFacts = decision.dependencies.filter((d) =>
    /^(account|age|contact|policy)-/.test(d.key),
  );
  const cohort = observationEvidence(
    cohortFacts,
    databaseNow,
    decision.eligibleUntil,
  );
  const entitlement = observationEvidence(
    [
      ...decision.dependencies.filter((d) => !cohortFacts.includes(d)),
      {
        key: `disclosure-${resourceKey}`,
        revision: String(header.disclosureRevision),
        nextBoundary: null,
      },
      {
        key: `purge-${resourceKey}`,
        revision: String(header.purgeGeneration),
        nextBoundary: null,
      },
      {
        key: `partition-${resourceKey}`,
        revision: JSON.stringify(decision.partition),
        nextBoundary: null,
      },
    ],
    databaseNow,
    decision.eligibleUntil,
  );
  const base = observationBaseSchema.safeParse({
    schema: 1,
    resource: binding.resource,
    partition: decision.partition,
    disclosureRevision: header.disclosureRevision,
    window: binding.window,
  });
  if (
    !base.success ||
    [subject, cohort, entitlement].some((e) => e.remainingMs <= 0)
  )
    return { status: 'unavailable' };
  return {
    status: 'allowed',
    subject,
    cohort,
    entitlement,
    base: base.data,
    minimumContentRevision: header.contentRevision,
    purgeGeneration: header.purgeGeneration,
    databaseNow,
    overlay: decision.overlay,
  };
}
