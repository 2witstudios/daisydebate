import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  decidePublish,
  type PublishRefusal,
} from '@daisy/protocol/media-release';
import { sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { readDatabaseTime } from './database-clock';
import { youthRoundPublic } from './media-release-standing';
import { readReleasesOf } from './media-release-records';
import { oweNotifications } from './notifications/owe';
import { readYouthRecordingPeople } from './youth-recording-people';
import { youthRoundShareableSql, youthRoundSql } from './youth-round-sql';
import { run as runStatement, query } from './raw-rows';
import { z } from 'zod';

export type PublishAnswer =
  | { readonly kind: 'published' }
  | { readonly kind: 'refused'; readonly reason: PublishRefusal | 'not_found' };

/**
 * Sharing a Youth Round's Recording publicly (ADR 0151): one of its debaters
 * publishes it once every youth debater holds an active publish release and
 * the youth-publishing flag is open. The releases are read under lock, so a
 * withdrawal either lands first (and this refuses) or ends the publication
 * after it. The flag is read by the caller; closed, nothing is written.
 */
export function createYouthRoundPublications(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    /** Whether a debater's share of this Youth Round stands (the flag is the caller's). */
    readYouthRoundShared: (roundId: string): Promise<boolean> =>
      input.run(async (tx) => {
        const rows = await query(
          tx,
          z.object({ present: z.literal(1) }),
          sql`select 1 as present from youth_round_publications yp
            where yp.round_id = ${roundId} and ${youthRoundPublic(sql`yp`)}`,
        );
        return rows.length > 0;
      }),
    publishYouthRound: (command: {
      readonly roundId: string;
      readonly userId: string;
      readonly open: boolean;
    }): Promise<PublishAnswer> => {
      if (!idSchema.safeParse(command.roundId).success)
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const [round] = await query(
          tx,
          z.object({
            recording: z.string().nullable(),
            ended_at: z.union([z.string(), z.date()]).nullable(),
            published: z.string().nullable(),
            shareable: z.boolean(),
          }),
          sql`select r.id, rc.status as recording, p.ended_at, p.round_id as published,
              ${youthRoundShareableSql(sql`r`)} as shareable
            from rounds r
            left join recordings rc on rc.round_id = r.id
            left join youth_round_publications p on p.round_id = r.id
            where r.id = ${command.roundId} and ${youthRoundSql(sql`r.id`)}
            for update of r`,
        );
        if (round === undefined)
          return { kind: 'refused', reason: 'not_found' };
        const people = await readYouthRecordingPeople(tx, command.roundId);
        const debaterUserIds = people.debaters.map((d) => d.userId);
        // Each debater's account row orders every release command about them.
        for (const id of [...debaterUserIds].sort())
          await runStatement(
            tx,
            sql`select 1 from users where id = ${id} for update`,
          );
        const releases = await readReleasesOf(tx, debaterUserIds, true);
        const decision = decidePublish({
          open: command.open,
          debaterUserIds,
          publisherUserId: command.userId,
          releases,
          available: round.recording === 'ready' && round.shareable,
          published: round.published !== null && round.ended_at === null,
        });
        if (!decision.ok) return { kind: 'refused', reason: decision.refusal };
        const now = await readDatabaseTime(tx);
        await runStatement(
          tx,
          sql`insert into youth_round_publications (round_id, published_by_user_id, published_at)
            values (${command.roundId}, ${command.userId}, ${now.toISOString()})
            on conflict (round_id) do update set published_by_user_id = excluded.published_by_user_id,
              published_at = excluded.published_at, ended_at = null`,
        );
        const publisher = people.debaters.find(
          (d) => d.userId === command.userId,
        );
        await oweNotifications(tx, {
          kind: 'youth_round_published',
          subject: { round_id: command.roundId },
          recipients: debaterUserIds
            .filter((id) => id !== command.userId)
            .map((userId) => ({ userId, about: publisher?.actorId ?? null })),
          at: now.toISOString(),
          nextId: input.nextId,
        });
        return { kind: 'published' };
      });
    },
  };
}
