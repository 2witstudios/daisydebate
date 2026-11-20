import { createAppError } from '@daisy/errors';
import type {
  ContentModerationSubject,
  ProfilePhotoReviews,
} from '@daisy/protocol/content-moderation';
import {
  profilePhotoTransition,
  type ProfilePhotoEvent,
  type ProfilePhotoStatus,
} from '@daisy/protocol/public-profile';
import { sql } from 'drizzle-orm';
import { rowsOf, run, query } from './raw-rows';
import { changedNow, lockLivePhotos } from './public-profile-operations';
import type { Tx } from './tx';
import { z } from 'zod';

type Outcome = 'applied' | 'unchanged' | null;
type ProfileTextField = 'display_name' | 'bio';

/** What a report needs: the target is live and shown, and not the reporter's own. */
export type ProfileReportFacts =
  | { readonly kind: 'missing' }
  | { readonly kind: 'profile'; readonly ownedByReporter: boolean };

type PhotoRow = {
  status: ProfilePhotoStatus;
  version: number;
  actor_id: string;
  username: string;
};

const photoRow = async (tx: Tx, photoId: string) => {
  const [row] = await rowsOf<PhotoRow>(
    tx,
    sql`select p.status, p.version, p.actor_id, u.username
      from profile_photos p
      join actors a on a.id = p.actor_id
      join users u on u.id = a.user_id
      where p.id = ${photoId}`,
  );
  return row ?? null;
};

const textColumn = (field: ProfileTextField) =>
  field === 'display_name' ? sql.raw('display_name') : sql.raw('bio');

/** Moves one photo by its lifecycle; the operator's version must be current. */
async function movePhoto(
  tx: Tx,
  input: {
    readonly photoId: string;
    readonly expectedVersion: number;
    readonly event: ProfilePhotoEvent;
    readonly now: Date;
  },
): Promise<Outcome> {
  const owner = await photoRow(tx, input.photoId);
  if (!owner) return null;
  // The member's own writes lock these rows in the same id order.
  await lockLivePhotos(tx, owner.actor_id, input.photoId);
  const row = await photoRow(tx, input.photoId);
  if (!row) return null;
  const next = profilePhotoTransition(row.status, input.event);
  if (next.kind === 'unchanged') return 'unchanged';
  if (next.kind === 'refused' || row.version !== input.expectedVersion)
    throw createAppError('CONFLICT');
  const now = input.now.toISOString();
  if (next.to === 'published')
    // The member's earlier published photo gives way to the approved one.
    await run(
      tx,
      sql`update profile_photos set status = 'withdrawn',
        ended_at = ${now}::timestamptz, delete_after = ${now}::timestamptz,
        version = version + 1
      where actor_id = ${row.actor_id} and status = 'published'`,
    );
  const ended = next.to !== 'published';
  await run(
    tx,
    sql`update profile_photos set status = ${next.to},
      decided_at = ${now}::timestamptz,
      ended_at = ${ended ? now : null}::timestamptz,
      delete_after = ${ended ? now : null}::timestamptz,
      version = version + 1
    where id = ${input.photoId}`,
  );
  return 'applied';
}

export const publicProfileModeration = {
  readPhotoReportFacts: async (
    tx: Tx,
    input: { readonly photoId: string; readonly reporterActorId: string },
  ): Promise<ProfileReportFacts> => {
    const row = await photoRow(tx, input.photoId);
    return row && row.status === 'published'
      ? {
          kind: 'profile',
          ownedByReporter: row.actor_id === input.reporterActorId,
        }
      : { kind: 'missing' };
  },

  readTextReportFacts: async (
    tx: Tx,
    input: {
      readonly profileId: string;
      readonly field: ProfileTextField;
      readonly reporterActorId: string;
    },
  ): Promise<ProfileReportFacts> => {
    const [row] = await query(
      tx,
      z.object({ actor_id: z.string(), text: z.string().nullable() }),
      sql`select m.actor_id, m.${textColumn(input.field)} as text
        from member_profiles m
        join actors a on a.id = m.actor_id
        join users u on u.id = a.user_id
        where m.id = ${input.profileId} and u.deleted_at is null`,
    );
    return row && row.text !== null
      ? {
          kind: 'profile',
          ownedByReporter: row.actor_id === input.reporterActorId,
        }
      : { kind: 'missing' };
  },

  readPhotoSubject: async (
    tx: Tx,
    photoId: string,
  ): Promise<ContentModerationSubject | null> => {
    const row = await photoRow(tx, photoId);
    return row
      ? {
          kind: 'profile_photo',
          photoId,
          username: row.username,
          status: row.status,
          version: row.version,
        }
      : null;
  },

  readTextSubject: async (
    tx: Tx,
    profileId: string,
    field: ProfileTextField,
  ): Promise<ContentModerationSubject | null> => {
    const [row] = await query(
      tx,
      z.object({
        username: z.string(),
        text: z.string().nullable(),
        version: z.number(),
      }),
      sql`select u.username, m.${textColumn(field)} as text, m.version
        from member_profiles m
        join actors a on a.id = m.actor_id
        join users u on u.id = a.user_id
        where m.id = ${profileId}`,
    );
    return row
      ? {
          kind: 'profile_text',
          profileId,
          username: row.username,
          field,
          text: row.text,
          version: row.version,
        }
      : null;
  },

  /** Photos waiting for an operator, oldest first. */
  listInReview: async (
    tx: Tx,
    limit: number,
  ): Promise<ProfilePhotoReviews['items']> => {
    const found = await rowsOf<{
      id: string;
      username: string;
      check_verdict: 'review' | null;
      created_at: string;
      version: number;
    }>(
      tx,
      sql`select p.id, u.username, p.check_verdict, p.version,
          to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        from profile_photos p
        join actors a on a.id = p.actor_id
        join users u on u.id = a.user_id
        where p.status = 'in_review' and u.deleted_at is null
        order by p.created_at, p.id limit ${limit}`,
    );
    return found.map((row) => ({
      photoId: row.id,
      username: row.username,
      checkVerdict: row.check_verdict,
      uploadedAt: row.created_at,
      version: row.version,
    }));
  },

  /** Where an operator reads a live photo's image from; null once it ended. */
  readOperatorPhoto: async (tx: Tx, photoId: string) => {
    const [row] = await rowsOf<{
      status: ProfilePhotoStatus;
      version: number;
      object_prefix: string;
    }>(
      tx,
      sql`select status, version, object_prefix from profile_photos
        where id = ${photoId} and ended_at is null`,
    );
    return row
      ? {
          status: row.status,
          version: row.version,
          objectPrefix: row.object_prefix,
        }
      : null;
  },

  reviewPhoto: (
    tx: Tx,
    input: {
      readonly photoId: string;
      readonly expectedVersion: number;
      readonly outcome: 'approve' | 'reject';
      readonly now: Date;
    },
  ) => movePhoto(tx, { ...input, event: input.outcome }),

  removePhoto: (
    tx: Tx,
    input: {
      readonly photoId: string;
      readonly expectedVersion: number;
      readonly now: Date;
    },
  ) => movePhoto(tx, { ...input, event: 'remove' }),

  /** Clears one field; an already empty field is unchanged. */
  removeText: async (
    tx: Tx,
    input: {
      readonly profileId: string;
      readonly expectedVersion: number;
      readonly field: ProfileTextField;
      readonly now: Date;
    },
  ): Promise<Outcome> => {
    const column = textColumn(input.field);
    const [row] = await query(
      tx,
      z.object({ text: z.string().nullable(), version: z.number() }),
      sql`select ${column} as text, version from member_profiles
        where id = ${input.profileId} for update`,
    );
    if (!row) return null;
    if (row.text === null) return 'unchanged';
    if (row.version !== input.expectedVersion) throw createAppError('CONFLICT');
    const changedAt =
      input.field === 'display_name'
        ? sql.raw('display_name_changed_at')
        : sql.raw('bio_changed_at');
    await run(
      tx,
      sql`update member_profiles set ${column} = null,
        ${changedAt} = ${changedNow},
        updated_at = ${input.now.toISOString()}::timestamptz, version = version + 1
      where id = ${input.profileId}`,
    );
    return 'applied';
  },
};
