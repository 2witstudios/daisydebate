import type { TournamentNotificationKind } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { loadLobbyAuthority } from '../tab/lobby-authority';
import { rowsOf } from '../raw-rows';

export type TournamentInboxRow = {
  readonly id: string;
  readonly readAt: string | null;
  readonly createdAt: string;
  readonly kind: TournamentNotificationKind;
  readonly handle: string;
  readonly eventId: string;
  readonly tabRoundId: string;
  readonly roomId: string | null;
};
export type TournamentInboxAccess = (
  facts: NonNullable<Awaited<ReturnType<typeof loadLobbyAuthority>>>,
) => boolean;

/** Current account, boundary, actual fixture relationship and recorded opening, under the ordinary Tab read fences. */
export async function readTournamentInbox(
  database: BunSQLDatabase,
  input: {
    readonly userId: string;
    readonly canReadTournament?: TournamentInboxAccess;
  },
): Promise<readonly TournamentInboxRow[]> {
  const canRead = input.canReadTournament;
  if (!canRead) return [];
  return database.transaction(async (tx) => {
    const lobbies = await rowsOf<{ id: string }>(
      tx,
      sql`select distinct notification_lobby_id id from notifications where user_id=${input.userId} and notification_lobby_id is not null order by notification_lobby_id`,
    );
    const visible: TournamentInboxRow[] = [];
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
        join entry_members em on em.entry_id=e.id join actors a on a.id=em.actor_id
        where fe.fixture_id=f.id and e.status='accepted' and e.responsible_kind='self' and a.user_id=n.user_id)`;
      const released = (
        thing: string,
      ) => sql`exists(select 1 from releases rel where rel.tab_round_id=f.tab_round_id and rel.thing=${thing}
        and (rel.audience in ('participants','link','public') or (rel.audience='competitors' and ${competitor}) or (rel.audience='responsible_adults' and ${adult})))`;
      visible.push(
        ...(await rowsOf<TournamentInboxRow>(
          tx,
          sql`select n.id,n.kind,${facts.lobby.handle}::text handle,f.event_id as "eventId",f.tab_round_id as "tabRoundId",f.room_id as "roomId",
        to_char(n.read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "readAt",
        to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
        from notifications n join fixtures f on f.id=n.fixture_id and f.lobby_id=n.notification_lobby_id
        left join rooms ro on ro.id=f.room_id
        where n.user_id=${input.userId} and n.notification_lobby_id=${lobby.id}
        and coalesce((select enabled from notification_preferences p where p.user_id=n.user_id and p.kind=n.kind and p.channel='in_app'),true)
        and (
          (n.kind='judge_assigned' and ${judge})
          or (n.kind in ('judge_replaced','judge_unassigned') and ${removedJudge})
          or (n.kind='tournament_draw_changed' and (${competitor} or ${judge}) and ${released('posting')})
          or (n.kind='tournament_room_ready' and f.status='published' and ro.status='ready' and (${competitor} or ${judge}))
          or (n.kind='tournament_results_released' and f.status='published' and (${competitor} or ${judge}) and ${released('decision')})
        )`,
        )),
      );
    }
    return visible;
  });
}
