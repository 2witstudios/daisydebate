import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { ratingLadders, type RatingLadder } from '@daisy/protocol';
import {
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from './authorization';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { ratingVisibility } from './schema/ratings';

type Scope = { readonly userId: string; readonly actorId: string };
type Visibility = {
  readonly showPolicy: boolean;
  readonly showValue: boolean;
};

type CardRatingRow = {
  readonly actorId: string;
  readonly ladder: RatingLadder;
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
  readonly lastRatedAt: string | null;
};

type CardRecordRow = {
  readonly actorId: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly role: string;
  readonly rounds: number;
};

/** The active season's ratings for a page of people, and their public record. */
export const ratingVisibilityOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readRatingVisibility: (
    scope: Scope,
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'readRatingVisibility', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        const [row] = await tx
          .select({
            showPolicy: ratingVisibility.showPolicy,
            showValue: ratingVisibility.showValue,
          })
          .from(ratingVisibility)
          .where(eq(ratingVisibility.actorId, scope.actorId));
        return row ?? { showPolicy: false, showValue: false };
      }),
    );
  },
  writeRatingVisibility: (
    scope: Scope,
    input: Visibility & { readonly now: string },
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'writeRatingVisibility', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        const values = {
          showPolicy: input.showPolicy,
          showValue: input.showValue,
          updatedAt: new Date(input.now),
        };
        await tx
          .insert(ratingVisibility)
          .values({ actorId: scope.actorId, ...values })
          .onConflictDoUpdate({
            target: ratingVisibility.actorId,
            set: values,
          });
        return { showPolicy: input.showPolicy, showValue: input.showValue };
      }),
    );
  },
  /**
   * What each person's card may show (ADR 0097): every rated ladder they turned
   * on, Freestyle always, in the active season, and the shape of their public
   * record. One read for a page of people. Ladders stay public regardless.
   */
  readMemberCards: (actorIds: readonly string[]) =>
    instrumented(eventSink, 'readMemberCards', async () => {
      if (actorIds.length === 0)
        return { ratings: [], records: [], visibility: [] };
      const ids = sql`array[${sql.join(
        actorIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[]`;
      const visibility = (await database.execute(sql`
        select actor_id as "actorId", show_policy as "showPolicy", show_value as "showValue"
        from rating_visibility where actor_id = any(${ids})`)) as unknown as (Visibility & {
        actorId: string;
      })[];
      const ratings = (await database.execute(sql`
        select r.actor_id as "actorId", r.ladder, r.rating, r.deviation, r.volatility,
          (select max(c.occurred_at) from rating_changes c
            where c.actor_id = r.actor_id and c.ladder = r.ladder and c.season_id = r.season_id) as "lastRatedAt"
        from ratings r join seasons s on s.id = r.season_id and s.status = 'active'
        where r.actor_id = any(${ids})`)) as unknown as (Omit<
        CardRatingRow,
        'lastRatedAt'
      > & { lastRatedAt: Date | string | null })[];
      const records = (await database.execute(sql`
        select p.actor_id as "actorId", r.status, r.outcome, p.role, count(*)::int as rounds
        from round_participants p join rounds r on r.id = p.round_id
        where p.actor_id = any(${ids}) and r.room_id is not null and r.visibility = 'public'
        group by p.actor_id, r.status, r.outcome, p.role`)) as unknown as CardRecordRow[];
      return {
        visibility: [...visibility],
        ratings: ratings
          .filter((row) => ratingLadders.includes(row.ladder))
          .map((row) => ({
            ...row,
            lastRatedAt:
              row.lastRatedAt === null
                ? null
                : new Date(row.lastRatedAt).toISOString(),
          })),
        records: [...records],
      };
    }),
});
