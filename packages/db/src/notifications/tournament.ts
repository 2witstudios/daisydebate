import type { TournamentNotificationKind } from '@daisy/protocol';
import { buildUserInboxTopic } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { TabTransaction } from '../tab/tab-transaction';
import { appendOutboxEvent } from '../outbox';
import { rowsOf } from '../raw-rows';

/** Actual accepted competitors and panel members of one fixture; never a lobby-wide broadcast. */
export const fixtureNotificationPeople = (
  tx: TabTransaction,
  fixtureId: string,
) =>
  rowsOf<{ userId: string; actorId: string; judgeId: string | null }>(
    tx,
    sql`
    select a.user_id as "userId",a.id as "actorId",null::text as "judgeId"
    from fixture_entries fe join entry_members em on em.entry_id=fe.entry_id and em.entry_status='accepted'
      join actors a on a.id=em.actor_id join users u on u.id=a.user_id and u.deleted_at is null
    where fe.fixture_id=${fixtureId}
    union
    select a.user_id,a.id,j.id from fixture_judges fj
      join tournament_judges j on j.id=fj.tournament_judge_id and j.status='accepted'
      join actors a on a.id=j.actor_id join users u on u.id=a.user_id and u.deleted_at is null
    where fj.fixture_id=${fixtureId}`,
  );

/** Content-free inbox truth and signal commit with the command; the unique subject fences retries. */
export async function oweTournamentNotification(
  tx: TabTransaction,
  input: {
    readonly kind: TournamentNotificationKind;
    readonly fixtureId: string;
    readonly lobbyId: string;
    readonly commandId: string;
    readonly at: string;
    readonly newId: () => string;
    readonly people: readonly {
      readonly userId: string;
      readonly actorId: string;
    }[];
  },
) {
  for (const person of new Map(
    input.people.map((person) => [person.userId, person]),
  ).values()) {
    const id = input.newId();
    const written = await rowsOf(
      tx,
      sql`insert into notifications(id,user_id,kind,fixture_id,notification_lobby_id,tab_command_id,created_at)
      select ${id},u.id,${input.kind},${input.fixtureId},${input.lobbyId},${input.commandId},${input.at}::timestamptz
      from users u where u.id=${person.userId} and u.deleted_at is null
      on conflict do nothing returning id`,
    );
    if (written.length === 0) continue;
    await appendOutboxEvent(tx, {
      topic: buildUserInboxTopic(person.actorId),
      kind: 'user.notification-delivered',
      version: 1,
      payload: {
        entityVersion: 1,
        kind: 'user.notification-delivered',
        ids: [id],
        notificationType: input.kind,
        occurredAt: input.at,
      },
    });
  }
}

/** Only a newly recorded opening can owe results; changing policy never fabricates a release. */
export async function notifyTournamentRelease(
  tx: TabTransaction,
  release: {
    readonly lobbyId: string;
    readonly tabRoundId: string;
    readonly thing: string;
    readonly audience: string;
    readonly commandId: string;
    readonly openedAt: string;
    readonly fixtureId?: string;
  },
  newId: () => string,
) {
  if (release.thing !== 'decision' && release.thing !== 'posting') return;
  const fixtures = await rowsOf<{ id: string }>(
    tx,
    sql`select f.id from fixtures f where f.tab_round_id=${release.tabRoundId}
    and f.lobby_id=${release.lobbyId} and f.status='published'
    ${release.fixtureId ? sql`and f.id=${release.fixtureId}` : sql``}
    ${release.thing === 'decision' ? sql`and exists(select 1 from results r where r.fixture_id=f.id)` : sql``}`,
  );
  for (const fixture of fixtures) {
    const people = await fixtureNotificationPeople(tx, fixture.id);
    // Responsible-adult openings do not imply that children or judges can see the result.
    const eligible =
      release.audience === 'responsible_adults'
        ? await rowsOf<{ userId: string; actorId: string }>(
            tx,
            sql`select a.user_id as "userId", a.id as "actorId"
          from fixture_entries fe join entries e on e.id=fe.entry_id and e.status='accepted'
          join entry_members em on em.entry_id=e.id join actors a on a.id=em.actor_id
          where fe.fixture_id=${fixture.id} and e.responsible_kind='self'`,
          )
        : release.audience === 'competitors'
          ? people.filter((person) => person.judgeId === null)
          : people;
    await oweTournamentNotification(tx, {
      kind:
        release.thing === 'decision'
          ? 'tournament_results_released'
          : 'tournament_draw_changed',
      fixtureId: fixture.id,
      lobbyId: release.lobbyId,
      commandId: release.commandId,
      at: release.openedAt,
      newId,
      people: eligible,
    });
  }
}

/** A previously recorded opening starts owing delivery when its actual result becomes available. */
export async function notifyAvailableFixtureResult(
  tx: TabTransaction,
  result: {
    readonly fixtureId: string;
    readonly lobbyId: string;
    readonly tabRoundId: string;
    readonly commandId: string;
    readonly recordedAt: string;
  },
  newId: () => string,
) {
  const openings = await rowsOf<{ audience: string }>(
    tx,
    sql`select audience from releases where lobby_id=${result.lobbyId} and tab_round_id=${result.tabRoundId} and thing='decision'`,
  );
  for (const opening of openings)
    await notifyTournamentRelease(
      tx,
      {
        ...result,
        thing: 'decision',
        audience: opening.audience,
        openedAt: result.recordedAt,
      },
      newId,
    );
}
