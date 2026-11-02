import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
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

/** Which ratings a member shows on their card besides Freestyle (ADR 0098). */
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
});
