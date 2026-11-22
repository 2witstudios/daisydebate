import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol/primitives';
import type { PrivacyAdopter, PrivacyExport } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { query, run } from './raw-rows';
import { z } from 'zod';

/**
 * The public profile's subject rights (ADR 0143). Export: the display name,
 * the bio and each photo's record (the image itself is the member's to
 * download from Settings; an adopter calls no storage). Erasure deletes the
 * text and ends every photo, an upload in flight included, as `erased`: the
 * storage sweep then deletes each
 * image and its row, so erasure commits locally even while storage is down.
 * The username and the record stay (ADR 0087).
 */
export const publicProfilePrivacyAdopter: PrivacyAdopter = {
  id: 'public-profile',
  phase: 'after-close',
  async erase(tx, subject, { now }) {
    const actorId = idSchema.parse(subject.actorId);
    await run(tx, sql`delete from member_profiles where actor_id = ${actorId}`);
    // An upload in flight keeps its reservation: its objects may still be
    // landing, so the sweep must not delete the prefix before they have.
    await run(
      tx,
      sql`update profile_photos set status = 'erased',
        ended_at = ${now}::timestamptz,
        delete_after = case when status = 'uploading'
          then greatest(delete_after, ${now}::timestamptz)
          else ${now}::timestamptz end,
        version = version + 1
      where actor_id = ${actorId}
        and (ended_at is null or status = 'uploading')`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      member_profiles: exportRows(
        await query(
          tx,
          z.object({
            id: z.string(),
            display_name: z.string().nullable(),
            bio: z.string().nullable(),
            display_name_changed_at: z.date().nullable(),
            bio_changed_at: z.date().nullable(),
            updated_at: z.date(),
            version: z.int(),
          }),
          sql`select id, display_name, bio, display_name_changed_at, bio_changed_at,
          updated_at, version from member_profiles where actor_id = ${actorId}`,
        ),
      ),
      // The storage location is internal and never leaves the system.
      profile_photos: exportRows(
        await query(
          tx,
          z.object({
            id: z.string(),
            status: z.string(),
            check_verdict: z.string().nullable(),
            created_at: z.date(),
            decided_at: z.date().nullable(),
            ended_at: z.date().nullable(),
          }),
          sql`select id, status, check_verdict, created_at, decided_at, ended_at
          from profile_photos where actor_id = ${actorId}`,
        ),
      ),
    };
  },
};
