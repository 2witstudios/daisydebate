import { createId } from '@paralleldrive/cuid2';
import {
  accepted,
  as,
  envelope,
  expect,
  type Cast,
  type League,
  type Wiring,
} from './tab-tournament-organization-wiring.test-support';
import { underFence } from './tab-tournament-organization-wiring.test-support';
import type { Bot, World } from './tab-tournament.test-support';

/**
 * The organization stage's command record: a command id replays, conflicts
 * with another payload, and conflicts when another tenant recorded it; and
 * the history holds one entry per accepted command.
 */

/** The same id replays its receipt; with another payload it is a conflict. */
export const commandIdsReplay = async (
  { send }: Wiring,
  cast: Cast,
  { give, given, granted }: League,
) => {
  const replayed = await accepted(
    send(as(cast.director), given),
    'the replay is accepted',
  );
  expect(
    replayed.replayed && replayed.resultingVersion === granted.resultingVersion,
    'the same command id and payload replays its receipt',
    replayed,
  );
  const conflicting = await send(
    as(cast.director),
    envelope(
      { ...give, expiresAt: '2027-12-31T00:00:00.000Z' },
      given.expected,
      given.commandId,
    ),
  );
  expect(
    conflicting.kind === 'refused' &&
      conflicting.refusal === 'command-conflict',
    'the same command id with another payload is a command conflict',
    conflicting,
  );
};

/** One history entry per accepted command, and the grant names its giver. */
export const recordStands = async (
  world: World,
  cast: Cast,
  { organizationId, given }: League,
  staffGrantId: string,
) => {
  const history = await underFence<{
    commandId: string;
    type: string;
    actorUserId: string | null;
    authority: string;
  }>(
    world,
    { organizationId },
    (sql) => sql`select command_id as "commandId", type,
      actor_user_id as "actorUserId", authority from action_history
      where organization_id = ${organizationId} order by resulting_version`,
  );
  const step = (type: string, bot: Bot) => `${type} by ${bot.userId}`;
  expect(
    JSON.stringify(
      history.map((row) => `${row.type} by ${row.actorUserId}`),
    ) ===
      JSON.stringify([
        step('create-organization', cast.director),
        step('invite-member', cast.director),
        step('invite-member', cast.director),
        step('accept-membership', cast.staff),
        step('accept-membership', cast.coach),
        step('give-grant', cast.director),
      ]) &&
      history.at(-1)?.commandId === given.commandId &&
      history.at(-1)?.authority === 'owner',
    'one history entry per accepted command, naming who ran it and under what',
    history,
  );
  const [grant] = await underFence<{ grantedByUserId: string; userId: string }>(
    world,
    { organizationId },
    (sql) => sql`select granted_by_user_id as "grantedByUserId",
      user_id as "userId" from grants where id = ${staffGrantId}`,
  );
  expect(
    grant?.grantedByUserId === cast.director.userId &&
      grant.userId === cast.staff.userId,
    'the grant names who gave it and to whom',
    grant,
  );
};

/**
 * A command id the league recorded, sent again for another organization:
 * the fence hides the league's entry, and the answer is a command conflict
 * that creates nothing.
 */
export const commandIdTakenElsewhere = async (
  world: World,
  { send }: Wiring,
  cast: Cast,
  { given }: League,
) => {
  const handle = `hill-${createId().slice(0, 10)}`;
  const answer = await send(
    as(cast.director),
    envelope(
      {
        type: 'create-organization',
        kind: 'league',
        name: 'Hill League',
        handle,
      },
      {},
      given.commandId,
    ),
  );
  const made = await underFence<{ id: string }>(
    world,
    {},
    (sql) => sql`select id from organizations where handle = ${handle}`,
  );
  expect(
    answer.kind === 'refused' &&
      answer.refusal === 'command-conflict' &&
      made.length === 0,
    'a command id another organization recorded is a command conflict that creates nothing',
    { answer, made },
  );
};
