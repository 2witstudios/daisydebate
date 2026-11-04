import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';

/**
 * A member's documents and folders are private to them (ADR 0111). Erasure
 * deletes every one (ISSUE-329, ISSUE-383); nothing else references them, so
 * the competitive record is untouched. Export returns them as stored. The
 * caller's user lock is the same fence every drive change takes, so a create
 * racing this step either commits first and is deleted, or is refused after.
 */
export const documentsPrivacyAdopter: PrivacyAdopter = {
  id: 'documents',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from documents where owner_actor_id = ${subject.actorId}`,
    );
    await tx.execute(
      sql`delete from document_folders where owner_actor_id = ${subject.actorId}`,
    );
  },
  export: async (tx, subject) => {
    const documents = (await tx.execute(sql`
      select id, folder_id, title, html, revision,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
      from documents where owner_actor_id = ${subject.actorId}
      order by id`)) as unknown as Record<string, unknown>[];
    const folders = (await tx.execute(sql`
      select id, parent_folder_id, name,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
      from document_folders where owner_actor_id = ${subject.actorId}
      order by id`)) as unknown as Record<string, unknown>[];
    return { documents, document_folders: folders };
  },
};
