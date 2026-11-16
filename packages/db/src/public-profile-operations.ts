import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type {
  PhotoCheckVerdict,
  ProfilePhotoStatus,
} from '@daisy/protocol/public-profile';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from './authorization';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { rowsOf } from './raw-rows';

/**
 * The public profile's storage (ADR 0143): a member's display name and bio,
 * and their profile photos' lifecycle rows. What a status means and which
 * transitions exist are the profile feature's decisions; this store applies
 * them and keeps the one-live-photo-per-status invariant its indexes state.
 */

type Scope = { readonly userId: string; readonly actorId: string };
type Database = Pick<BunSQLDatabase, 'transaction' | 'execute'>;
type Tx = Pick<BunSQLDatabase, 'execute'>;

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
  const [profile] = await rowsOf<{
    id: string;
    display_name: string | null;
    bio: string | null;
  }>(
    tx,
    sql`select id, display_name, bio from member_profiles where actor_id = ${actorId}`,
  );
  const photos = await rowsOf<{ id: string; status: ProfilePhotoStatus }>(
    tx,
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

/** Ends live photos: their image is owed deletion from `now`. */
const endPhotos = (
  tx: Tx,
  where: SQL,
  status: ProfilePhotoStatus,
  now: string,
) =>
  rowsOf<{ id: string }>(
    tx,
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
  readonly database: Database;
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
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    idSchema.parse(input.profileId);
    return instrumented(eventSink, 'writePublicProfileText', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        await tx.execute(sql`insert into member_profiles
            (actor_id, id, display_name, bio, updated_at)
          values (${scope.actorId}, ${input.profileId}, ${input.displayName},
            ${input.bio}, ${input.now}::timestamptz)
          on conflict (actor_id) do update set
            display_name = excluded.display_name, bio = excluded.bio,
            updated_at = excluded.updated_at,
            version = member_profiles.version + 1`);
        return ownProfile(tx, scope.actorId);
      }),
    );
  },

  /**
   * Records a checked, stored photo. A photo in review withdraws the member's
   * earlier one in review and leaves the published one showing; a published
   * photo withdraws both.
   */
  recordProfilePhoto: (
    scope: Scope,
    input: {
      readonly photoId: string;
      readonly objectPrefix: string;
      readonly status: 'published' | 'in_review';
      readonly checkVerdict: PhotoCheckVerdict | null;
      readonly now: string;
    },
    authorize: OwnCollectionFence<Scope>,
  ) => {
    requireOwnScope(scope);
    idSchema.parse(input.photoId);
    return instrumented(eventSink, 'recordProfilePhoto', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
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
        await tx.execute(sql`insert into profile_photos
            (id, actor_id, status, check_verdict, object_prefix, created_at, decided_at)
          values (${input.photoId}, ${scope.actorId}, ${input.status},
            ${input.checkVerdict}, ${input.objectPrefix}, ${input.now}::timestamptz,
            ${input.status === 'published' ? input.now : null}::timestamptz)`);
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
      const [row] = await rowsOf<{
        id: string;
        actor_id: string;
        status: ProfilePhotoStatus;
        object_prefix: string;
        version: number;
      }>(
        database,
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
      const found = await rowsOf<{
        actor_id: string;
        display_name: string | null;
        photo_id: string | null;
      }>(
        database,
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
      const [row] = await rowsOf<{
        profile_id: string | null;
        display_name: string | null;
        bio: string | null;
        photo_id: string | null;
      }>(
        database,
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
      const found = await rowsOf<{
        id: string;
        object_prefix: string;
        delete_attempts: number;
      }>(
        database,
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
      await database.execute(
        sql`delete from profile_photos where id = ${photoId} and ended_at is not null`,
      );
    }),

  /** Storage refused: try again at `retryAt`, the obligation still owed. */
  deferPhotoDeletion: (photoId: string, retryAt: string) =>
    instrumented(eventSink, 'deferPhotoDeletion', async () => {
      idSchema.parse(photoId);
      await database.execute(sql`update profile_photos
        set delete_attempts = delete_attempts + 1, delete_after = ${retryAt}::timestamptz
        where id = ${photoId} and ended_at is not null`);
    }),

  /** How many image deletions are owed, due or not: the sweep's backlog. */
  owedPhotoDeletions: () =>
    instrumented(eventSink, 'owedPhotoDeletions', async () => {
      const [row] = await rowsOf<{ owed: number }>(
        database,
        sql`select count(*)::int as owed from profile_photos where ended_at is not null`,
      );
      return row?.owed ?? 0;
    }),
});

export type PublicProfileOperations = ReturnType<
  typeof publicProfileOperations
>;
