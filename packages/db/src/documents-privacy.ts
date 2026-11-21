import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { run, query } from './raw-rows';
import { z } from 'zod';

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
    await run(
      tx,
      sql`delete from documents where owner_actor_id = ${subject.actorId}`,
    );
    await run(
      tx,
      sql`delete from document_folders where owner_actor_id = ${subject.actorId}`,
    );
  },
  export: async (tx, subject) => {
    const documents = await query(
      tx,
      z.object({
        id: z.string(),
        folder_id: z.string().nullable(),
        title: z.string(),
        html: z.string(),
        revision: z.int(),
        created_at: z.string(),
        updated_at: z.string(),
      }),
      sql`
      select id, folder_id, title, html, revision,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
      from documents where owner_actor_id = ${subject.actorId}
      order by id`,
    );
    const folders = await query(
      tx,
      z.object({
        id: z.string(),
        parent_folder_id: z.string().nullable(),
        name: z.string(),
        created_at: z.string(),
        updated_at: z.string(),
      }),
      sql`
      select id, parent_folder_id, name,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
      from document_folders where owner_actor_id = ${subject.actorId}
      order by id`,
    );
    return { documents, document_folders: folders };
  },
};
