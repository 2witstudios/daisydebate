import { roomStatus } from '@daisy/protocol';
import { lifecycleSql } from '../lifecycle-sql';
import type { TournamentNotificationKind } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { loadLobbyAuthority } from '../tab/lobby-authority';
import { query } from '../raw-rows';
import { inTransaction, type TxSource } from '../tx';
import { z } from 'zod';

/** What a standing tournament notification's words and link read (NTF-15). */
export type TournamentNotificationFacts = {
  readonly kind: TournamentNotificationKind;
  readonly handle: string;
  readonly eventId: string;
  readonly tabRoundId: string;
  readonly roomId: string | null;
};
export type TournamentInboxAccess = (
  facts: NonNullable<Awaited<ReturnType<typeof loadLobbyAuthority>>>,
) => boolean;

/**
 * Tab's published standing for its notifications (ADR 0144, NTF-15): which of
 * a member's tournament notifications still stand, with the facts their words
 * need. Tab's rows sit behind lobby-scoped row security, so each lobby is read
 * in its own scope, and only a lobby the member may read now (the ordinary
 * Tab read fences, a minor's closed guardian flag among them) contributes.
 * Within it, a notification stands while the person is still who it was
 * about (an accepted competitor or panel judge of a published fixture, or a
 * judge taken off it) and, for a posting or a result, while a recorded
 * release opens it to them.
 */
export async function standingTournamentNotifications(
  database: TxSource,
  input: {
    readonly userId: string;
    readonly canReadTournament?: TournamentInboxAccess | undefined;
    /**
     * Only unread rows are wanted (the shell's read on every ring): read
     * rows, and lobbies that hold only read ones, are not visited.
     */
    readonly unreadOnly?: boolean;
  },
): Promise<ReadonlyMap<string, TournamentNotificationFacts>> {
  const canRead = input.canReadTournament;
  if (!canRead) return new Map();
  const unread = input.unreadOnly ? sql`and n.read_at is null` : sql``;
  return inTransaction(database, async (tx) => {
    const lobbies = await query(
      tx,
      z.object({ id: z.string() }),
      sql`select distinct n.notification_lobby_id id from notifications n where n.user_id=${input.userId} and n.notification_lobby_id is not null ${unread} order by n.notification_lobby_id`,
    );
    const standing = new Map<string, TournamentNotificationFacts>();
    for (const lobby of lobbies) {
      const facts = await loadLobbyAuthority(tx, {
        viewerUserId: input.userId,
        lobbyId: lobby.id,
      });
      if (!facts || !canRead(facts)) continue;
      const competitor = sql`exists(select 1 from fixture_entries fe join entry_members em on em.entry_id=fe.entry_id
        join actors a on a.id=em.actor_id where fe.fixture_id=f.id and em.entry_status='accepted' and a.user_id=n.user_id)`;
      const judge = sql`exists(select 1 from fixture_judges fj join tournament_judges j on j.id=fj.tournament_judge_id
        join actors a on a.id=j.actor_id where fj.fixture_id=f.id and j.status='accepted' and a.user_id=n.user_id)`;
      const removedJudge = sql`exists(select 1 from tournament_judges j join actors a on a.id=j.actor_id
        where j.lobby_id=f.lobby_id and j.status='accepted' and a.user_id=n.user_id) and not ${judge}`;
      const adult = sql`exists(select 1 from fixture_entries fe join entries e on e.id=fe.entry_id
        join entry_members em on em.entry_id=e.id and em.entry_status='accepted' join actors a on a.id=em.actor_id
        where fe.fixture_id=f.id and e.status='accepted' and e.responsible_kind='self' and a.user_id=n.user_id)`;
      const released = (
        thing: string,
      ) => sql`exists(select 1 from releases rel where rel.tab_round_id=f.tab_round_id and rel.thing=${thing}
        and (rel.audience in ('participants','link','public') or (rel.audience='competitors' and ${competitor}) or (rel.audience='responsible_adults' and ${adult})))`;
      const rows = await query(
        tx,
        z.object({
          kind: z.enum([
            'judge_assigned',
            'judge_replaced',
            'judge_unassigned',
            'tournament_draw_changed',
            'tournament_room_ready',
            'tournament_results_released',
          ]),
          handle: z.string(),
          eventId: z.string(),
          tabRoundId: z.string(),
          roomId: z.string().nullable(),
          id: z.string(),
        }),
        sql`select n.id,n.kind,${facts.lobby.handle}::text handle,f.event_id as "eventId",f.tab_round_id as "tabRoundId",f.room_id as "roomId"
        from notifications n join fixtures f on f.id=n.fixture_id and f.lobby_id=n.notification_lobby_id
        left join rooms ro on ro.id=f.room_id
        where n.user_id=${input.userId} and n.notification_lobby_id=${lobby.id} ${unread}
        and (
          (n.kind='judge_assigned' and f.status='published' and ${judge})
          or (n.kind in ('judge_replaced','judge_unassigned') and f.status='published' and ${removedJudge})
          or (n.kind='tournament_draw_changed' and (${competitor} or ${judge}) and ${released('posting')})
          or (n.kind='tournament_room_ready' and f.status='published' and ro.status=${lifecycleSql(roomStatus.ready)} and (${competitor} or ${judge}))
          or (n.kind='tournament_results_released' and f.status='published' and (${competitor} or ${judge}) and ${released('decision')})
        )`,
      );
      for (const { id, ...row } of rows) standing.set(id, row);
    }
    return standing;
  });
}
