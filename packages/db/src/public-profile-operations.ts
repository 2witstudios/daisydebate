import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  type PhotoCheckVerdict,
  type ProfilePhotoStatus,
  profilePhotoStatuses,
} from '@daisy/protocol/public-profile';
import { sql, type SQL } from 'drizzle-orm';
import {
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from './authorization';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { run, query as queryRows } from './raw-rows';
import type { Tx, TxSource } from './tx';
import { takeLock, transactionLocks } from './locks';
import { z } from 'zod';

/**
 * The public profile's storage (ADR 0143): a member's display name and bio,
 * and their profile photos' lifecycle rows. What a status means and which
 * transitions exist are the profile feature's decisions; this store applies
 * them and keeps the one-live-photo-per-status invariant its indexes state.
 */

type Scope = { readonly userId: string; readonly actorId: string };

/** A member's own public profile, as they edit it. */
export type OwnPublicProfile = {
  readonly profileId: string | null;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly published: string | null;
  readonly inReview: string | null;
};

/** What a list shows for each member: display name and published photo. */
export type PublicProfileCard = {
  readonly displayName: string | null;
  readonly photoId: string | null;
};

/** One photo, as the image route and the moderation commands read it. */
export type StoredProfilePhoto = {
  readonly photoId: string;
  readonly actorId: string;
  readonly status: ProfilePhotoStatus;
  readonly objectPrefix: string;
  readonly version: number;
};

/** One terminal photo whose stored image the sweep must delete. */
export type PhotoDeletion = {
  readonly photoId: string;
  readonly objectPrefix: string;
  readonly attempts: number;
};

const ownProfile = async (
  tx: Tx,
  actorId: string,
): Promise<OwnPublicProfile> => {
  const [profile] = await queryRows(
    tx,
    z.object({
      id: z.string(),
      display_name: z.string().nullable(),
      bio: z.string().nullable(),
    }),
    sql`select id, display_name, bio from member_profiles where actor_id = ${actorId}`,
  );
  const photos = await queryRows(
    tx,
    z.object({ id: z.string(), status: z.enum(profilePhotoStatuses) }),
    sql`select id, status from profile_photos
      where actor_id = ${actorId} and status in ('published', 'in_review')`,
  );
  const live = (status: ProfilePhotoStatus) =>
    photos.find((photo) => photo.status === status)?.id ?? null;
  return {
    profileId: profile?.id ?? null,
    displayName: profile?.display_name ?? null,
    bio: profile?.bio ?? null,
    published: live('published'),
    inReview: live('in_review'),
  };
};

/**
 * Locks the member's live photos in id order. The operator's commands take
 * the same rows in the same order, so a member's upload and an operator's
 * decision never wait on each other's rows in a cycle.
 */
export async function lockLivePhotos(tx: Tx, actorId: string, alsoId?: string) {
  // The member's photos as a whole first: two first uploads hold no row to
  // lock, so they queue here instead of racing the one-per-status indexes.
  await takeLock(tx, transactionLocks.publicProfile(actorId));
  await run(
    tx,
    sql`select id from profile_photos
    where actor_id = ${actorId}
      and (ended_at is null ${alsoId ? sql`or id = ${alsoId}` : sql``})
    order by id for update`,
  );
}

/**
 * When a field's text changed: the database clock at this statement, after
 * any lock it waited for (not the transaction's start), rounded up to the
 * next millisecond, since a report's `resolved_at` is stored to the
 * millisecond rounded down. A change committed after a resolution is then
 * always later than it; one within the same millisecond before it may count
 * as after, which only lets a repeat report through.
 */
export const changedNow = sql`date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond'`;

/**
 * How close to its lapse a reservation may still be recorded: the web
 * instance that records and the worker that sweeps read different clocks,
 * so recording stops this far before the sweep may take the row.
 */
const RECORD_MARGIN_SECONDS = 300;

/** Ends live photos: their image is owed deletion from `now`. */
const endPhotos = (
  tx: Tx,
  where: SQL,
  status: ProfilePhotoStatus,
  now: string,
) =>
  queryRows(
    tx,
    z.object({ id: z.string() }),
    sql`update profile_photos set status = ${status},
        ended_at = ${now}::timestamptz, delete_after = ${now}::timestamptz,
        version = version + 1
      where status in ('published', 'in_review') and ${where}
      returning id`,
  );

export const publicProfileOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readOwnPublicProfile: (
    scope: Scope,
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'readOwnPublicProfile', () =>
      readOwnCollection(database, scope, authorize, (tx) =>
        ownProfile(tx, scope.actorId),
      ),
    );
  },

  /**
   * Writes the member's display name and bio. A cleared field is null; the
   * row and its id stay for the account's life, so a report naming the
   * profile still finds it after its text is cleared and set again (erasure
   * deletes it). `profileId` names a new row only.
   */
  writePublicProfileText: (
    scope: Scope,
    input: {
      readonly profileId: string;
      readonly displayName: string | null;
      readonly bio: string | null;
      readonly now: string;
    },
    /**
     * The fence for this edit, chosen from the text as it stands in this
     * transaction, locked: whether an edit only clears or keeps is decided
     * against what an operator may just have removed, never a stale read.
     */
    fenceFor: (current: {
      readonly displayName: string | null;
      readonly bio: string | null;
    }) => OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    idSchema.parse(input.profileId);
    return instrumented(eventSink, 'writePublicProfileText', () =>
      readOwnCollection(
        database,
        scope,
        async (fact) => {
          const [current] = await queryRows(
            fact.tx,
            z.object({
              display_name: z.string().nullable(),
              bio: z.string().nullable(),
            }),
            sql`select display_name, bio from member_profiles
              where actor_id = ${scope.actorId} for update`,
          );
          await fenceFor({
            displayName: current?.display_name ?? null,
            bio: current?.bio ?? null,
          })(fact);
        },
        async (tx) => {
          await run(
            tx,
            sql`insert into member_profiles
              (actor_id, id, display_name, bio, display_name_changed_at,
               bio_changed_at, updated_at)
            values (${scope.actorId}, ${input.profileId}, ${input.displayName},
              ${input.bio}, ${changedNow}, ${changedNow}, ${input.now}::timestamptz)
            on conflict (actor_id) do update set
              display_name = excluded.display_name, bio = excluded.bio,
              display_name_changed_at = case
                when excluded.display_name is distinct from member_profiles.display_name
                then ${changedNow} else member_profiles.display_name_changed_at end,
              bio_changed_at = case
                when excluded.bio is distinct from member_profiles.bio
                then ${changedNow} else member_profiles.bio_changed_at end,
              updated_at = excluded.updated_at,
              version = member_profiles.version + 1`,
          );
          return ownProfile(tx, scope.actorId);
        },
      ),
    );
  },

  /**
   * Reserves a checked photo's row before any object is stored: `uploading`,
   * already owing deletion of its prefix at `deleteAfter`. An upload that
   * never finishes, however it fails, is then cleaned up by the ordinary
   * sweep, and no stored object is ever without a row.
   */
  reserveProfilePhoto: (
    scope: Scope,
    input: {
      readonly photoId: string;
      readonly objectPrefix: string;
      readonly checkVerdict: PhotoCheckVerdict | null;
      readonly now: string;
      readonly deleteAfter: string;
    },
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    idSchema.parse(input.photoId);
    return instrumented(eventSink, 'reserveProfilePhoto', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        await run(
          tx,
          sql`insert into profile_photos
            (id, actor_id, status, check_verdict, object_prefix, created_at,
             ended_at, delete_after)
          values (${input.photoId}, ${scope.actorId}, 'uploading',
            ${input.checkVerdict}, ${input.objectPrefix}, ${input.now}::timestamptz,
            ${input.now}::timestamptz, ${input.deleteAfter}::timestamptz)`,
        );
      }),
    );
  },

  /**
   * Makes a reserved photo live once its objects are stored. A photo in
   * review withdraws the member's earlier one in review and leaves the
   * published one showing; a published photo withdraws both. A lapsed
   * reservation (the sweep may be deleting its objects), one the sweep has
   * already tried to delete (its later retry time does not revive it), one
   * the sweep already took, or someone else's, is a conflict: the member
   * uploads again.
   */
  recordProfilePhoto: (
    scope: Scope,
    input: {
      readonly photoId: string;
      readonly status: 'published' | 'in_review';
      readonly now: string;
    },
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    idSchema.parse(input.photoId);
    return instrumented(eventSink, 'recordProfilePhoto', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        await lockLivePhotos(tx, scope.actorId, input.photoId);
        const replaced =
          input.status === 'published'
            ? sql`status in ('published', 'in_review')`
            : sql`status = 'in_review'`;
        await endPhotos(
          tx,
          sql`actor_id = ${scope.actorId} and ${replaced}`,
          'withdrawn',
          input.now,
        );
        const made = await queryRows(
          tx,
          z.object({ id: z.string() }),
          sql`update profile_photos set status = ${input.status},
              ended_at = null, delete_after = null,
              decided_at = ${input.status === 'published' ? input.now : null}::timestamptz,
              version = version + 1
            where id = ${input.photoId} and actor_id = ${scope.actorId}
              and status = 'uploading' and delete_attempts = 0
              and delete_after > ${input.now}::timestamptz + ${`${RECORD_MARGIN_SECONDS} seconds`}::interval
            returning id`,
        );
        if (made.length !== 1) throw createAppError('CONFLICT');
        return ownProfile(tx, scope.actorId);
      }),
    );
  },

  /** The member clears their photo: every live one is withdrawn. */
  withdrawProfilePhotos: (
    scope: Scope,
    input: { readonly now: string },
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'withdrawProfilePhotos', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        await lockLivePhotos(tx, scope.actorId);
        await endPhotos(
          tx,
          sql`actor_id = ${scope.actorId}`,
          'withdrawn',
          input.now,
        );
        return ownProfile(tx, scope.actorId);
      }),
    );
  },

  /** One photo by id, for the image route; null when no row has it. */
  readProfilePhoto: (photoId: string) =>
    instrumented(eventSink, 'readProfilePhoto', async () => {
      if (!idSchema.safeParse(photoId).success) return null;
      const [row] = await queryRows(
        database,
        z.object({
          id: z.string(),
          actor_id: z.string(),
          status: z.enum(profilePhotoStatuses),
          object_prefix: z.string(),
          version: z.number(),
        }),
        sql`select p.id, p.actor_id, p.status, p.object_prefix, p.version
          from profile_photos p
          join actors a on a.id = p.actor_id
          join users u on u.id = a.user_id
          where p.id = ${photoId} and u.deleted_at is null`,
      );
      return row
        ? {
            photoId: row.id,
            actorId: row.actor_id,
            status: row.status,
            objectPrefix: row.object_prefix,
            version: row.version,
          }
        : null;
    }),

  /**
   * Display name and published photo for many members in one statement, so a
   * list's query count does not grow with its length. A closed account has
   * neither: erasure deleted its profile and ended its photos.
   */
  readPublicProfileCards: (actorIds: readonly string[]) =>
    instrumented(eventSink, 'readPublicProfileCards', async () => {
      const ids = [...new Set(actorIds)];
      if (ids.length === 0) return new Map<string, PublicProfileCard>();
      if (ids.length > 500 || ids.some((id) => !idSchema.safeParse(id).success))
        throw createAppError('VALIDATION');
      const found = await queryRows(
        database,
        z.object({
          actor_id: z.string(),
          display_name: z.string().nullable(),
          photo_id: z.string().nullable(),
        }),
        sql`select a.id as actor_id, m.display_name, p.id as photo_id
          from actors a
          left join member_profiles m on m.actor_id = a.id
          left join profile_photos p on p.actor_id = a.id and p.status = 'published'
          where a.id in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
      );
      return new Map(
        found.map((row) => [
          row.actor_id,
          { displayName: row.display_name, photoId: row.photo_id },
        ]),
      );
    }),

  /**
   * The public profile's text and published photo for one member, and the
   * profile row's id, which a report of the display name or bio names.
   */
  readPublicProfile: (actorId: string) =>
    instrumented(eventSink, 'readPublicProfile', async () => {
      idSchema.parse(actorId);
      const [row] = await queryRows(
        database,
        z.object({
          profile_id: z.string().nullable(),
          display_name: z.string().nullable(),
          bio: z.string().nullable(),
          photo_id: z.string().nullable(),
        }),
        sql`select m.id as profile_id, m.display_name, m.bio, p.id as photo_id
          from actors a
          left join member_profiles m on m.actor_id = a.id
          left join profile_photos p on p.actor_id = a.id and p.status = 'published'
          where a.id = ${actorId}`,
      );
      return {
        profileId: row?.profile_id ?? null,
        displayName: row?.display_name ?? null,
        bio: row?.bio ?? null,
        photoId: row?.photo_id ?? null,
      };
    }),

  /** Terminal photos whose image deletion is due, oldest first, bounded. */
  duePhotoDeletions: (input: {
    readonly now: string;
    readonly limit: number;
  }) =>
    instrumented(eventSink, 'duePhotoDeletions', async () => {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 500
      )
        throw createAppError('VALIDATION');
      const found = await queryRows(
        database,
        z.object({
          id: z.string(),
          object_prefix: z.string(),
          delete_attempts: z.number(),
        }),
        sql`select id, object_prefix, delete_attempts from profile_photos
          where ended_at is not null and delete_after <= ${input.now}::timestamptz
          order by delete_after, id limit ${input.limit}`,
      );
      return found.map((row): PhotoDeletion => ({
        photoId: row.id,
        objectPrefix: row.object_prefix,
        attempts: row.delete_attempts,
      }));
    }),

  /** Storage confirmed the image gone: the obligation, and the row, end. */
  completePhotoDeletion: (photoId: string) =>
    instrumented(eventSink, 'completePhotoDeletion', async () => {
      idSchema.parse(photoId);
      await run(
        database,
        sql`delete from profile_photos where id = ${photoId} and ended_at is not null`,
      );
    }),

  /** Storage refused: try again at `retryAt`, the obligation still owed. */
  deferPhotoDeletion: (photoId: string, retryAt: string) =>
    instrumented(eventSink, 'deferPhotoDeletion', async () => {
      idSchema.parse(photoId);
      await run(
        database,
        sql`update profile_photos
        set delete_attempts = delete_attempts + 1, delete_after = ${retryAt}::timestamptz
        where id = ${photoId} and ended_at is not null`,
      );
    }),

  /** How many image deletions are owed, due or not: the sweep's backlog. */
  owedPhotoDeletions: (now: string) =>
    instrumented(eventSink, 'owedPhotoDeletions', async () => {
      const [row] = await queryRows(
        database,
        z.object({ owed: z.number() }),
        sql`select count(*)::int as owed from profile_photos
          where ended_at is not null
            and (delete_after <= ${now}::timestamptz or delete_attempts > 0)`,
      );
      return row?.owed ?? 0;
    }),
});
