import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  photoCheckVerdicts,
  profilePhotoStatuses,
} from '@daisy/protocol/public-profile';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { actors } from './actors';

/**
 * A member's public text (ADR 0143): a display name and a bio, both optional,
 * both public; a cleared field is null and the row keeps its id for the
 * account's life, so reports of it still resolve. The username and the
 * competitive record are not here; erasure deletes the row.
 */
export const memberProfiles = pgTable(
  'member_profiles',
  {
    actorId: text('actor_id')
      .primaryKey()
      .references(() => actors.id, { onDelete: 'cascade' }),
    /** The profile's own id, which a report of its text names. */
    id: text('id').notNull(),
    displayName: text('display_name'),
    bio: text('bio'),
    /**
     * When each field's text last changed, by the database clock (the clock
     * a report's resolution uses): a resolved report of a field reopens only
     * once that field changed after it.
     */
    displayNameChangedAt: timestampColumn('display_name_changed_at'),
    bioChangedAt: timestampColumn('bio_changed_at'),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    uniqueIndex('member_profiles_id_unique').on(table.id),
    check(
      'member_profiles_display_name_length',
      sql`${table.displayName} is null or char_length(${table.displayName}) between 1 and ${sql.raw(String(DISPLAY_NAME_MAX))}`,
    ),
    check(
      'member_profiles_bio_length',
      sql`${table.bio} is null or char_length(${table.bio}) between 1 and ${sql.raw(String(BIO_MAX))}`,
    ),
    versionPositive('member_profiles', table.version),
  ],
);

/**
 * A member's profile photos (ADR 0143). A row exists only once its image was
 * scanned, sanitized, checked and stored under `objectPrefix`. A terminal row
 * is the obligation to delete that image: the storage sweep deletes the
 * objects and then the row, so local erasure survives a storage outage.
 */
export const profilePhotos = pgTable(
  'profile_photos',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    /** What the automated check answered; null when no check was configured. */
    checkVerdict: text('check_verdict'),
    /** Where its renditions are stored; never shown to anyone. */
    objectPrefix: text('object_prefix').notNull(),
    createdAt: createdAtColumn(),
    decidedAt: timestampColumn('decided_at'),
    /** When the status last changed; the sweep reads terminal rows oldest first. */
    endedAt: timestampColumn('ended_at'),
    /** Failed storage deletions; the sweep backs off by them. */
    deleteAttempts: integer('delete_attempts').notNull().default(0),
    deleteAfter: timestampColumn('delete_after'),
    version: versionColumn(),
  },
  (table) => [
    check(
      'profile_photos_status_check',
      oneOf(table.status, profilePhotoStatuses),
    ),
    check(
      'profile_photos_check_verdict_check',
      sql`${table.checkVerdict} is null or ${oneOf(table.checkVerdict, photoCheckVerdicts)}`,
    ),
    // Live rows have no end; a terminal row has one.
    check(
      'profile_photos_ended_check',
      sql`(${table.status} in ('in_review','published')) = (${table.endedAt} is null)`,
    ),
    check(
      'profile_photos_delete_after_check',
      sql`(${table.endedAt} is null) = (${table.deleteAfter} is null)`,
    ),
    check(
      'profile_photos_delete_attempts_check',
      sql`${table.deleteAttempts} >= 0`,
    ),
    // The foreign key's own index: account deletion and per-member reads.
    index('profile_photos_actor_idx').on(table.actorId),
    uniqueIndex('profile_photos_one_published')
      .on(table.actorId)
      .where(sql`${table.status} = 'published'`),
    uniqueIndex('profile_photos_one_in_review')
      .on(table.actorId)
      .where(sql`${table.status} = 'in_review'`),
    uniqueIndex('profile_photos_object_prefix_unique').on(table.objectPrefix),
    index('profile_photos_review_queue_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.status} = 'in_review'`),
    index('profile_photos_deletion_idx')
      .on(table.deleteAfter, table.id)
      .where(sql`${table.endedAt} is not null`),
    versionPositive('profile_photos', table.version),
  ],
);
