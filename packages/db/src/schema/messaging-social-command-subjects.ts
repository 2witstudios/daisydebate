import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { messagingActorColumn } from './messaging-columns';
import { messagingSocialCommands } from './messaging-social';
/** Private command/subject associations make multi-recipient fingerprints explicitly erasable. */
export const messagingSocialCommandSubjects = pgTable(
  'messaging_social_command_subjects',
  {
    actorId: text('actor_id').notNull(),
    requestId: text('request_id').notNull(),
    subjectActorId: messagingActorColumn('subject_actor_id'),
  },
  (table) => [
    primaryKey({
      columns: [table.actorId, table.requestId, table.subjectActorId],
    }),
    index('messaging_social_command_subjects_subject_idx').on(
      table.subjectActorId,
    ),
    foreignKey({
      name: 'messaging_social_command_subjects_command_fk',
      columns: [table.actorId, table.requestId],
      foreignColumns: [
        messagingSocialCommands.actorId,
        messagingSocialCommands.requestId,
      ],
    }).onDelete('cascade'),
  ],
);
