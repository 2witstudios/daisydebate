import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { settingCommand } from '../src/features/tab/operations/settings';
import {
  as,
  deniedAsNotFound,
  StageFailed,
} from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

export const entryEnrollmentStage = async (world: World): Promise<void> => {
  const director = world.bots.Director!;
  const lobbyId = world.made.get('tournament-lobby')!;
  const eventId = world.made.get('event')!;
  const store = createTabStore(world.database);
  const settings = settingCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  let settingsVersion = 2;
  for (const [key, value] of [
    ['entry.registration', { state: 'open' }],
    ['entry.approval', { value: 'host' }],
  ] as const) {
    const answer = await settings(as(director), {
      version: 1,
      commandId: createId(),
      expected: { settings: settingsVersion },
      command: {
        type: 'set-setting',
        scope: { kind: 'event', id: eventId },
        key,
        value,
        hold: 'default',
      },
    });
    if (answer.kind !== 'accepted')
      throw new StageFailed(`entry setting ${key}: ${JSON.stringify(answer)}`);
    settingsVersion += 1;
  }
  const send = entryEnrollmentCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  let entriesVersion = 1;
  const otherSelf = await send(as(director), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { entries: entriesVersion },
    command: {
      type: 'submit-entry',
      eventId,
      name: 'A host cannot name another adult as self',
      memberActorIds: [world.bots.Coach!.actorId],
      responsible: { kind: 'self' },
      division: null,
    },
  });
  assert({
    given: 'a host naming another person as self-responsible',
    should: 'refuse an entry with no responsible adult',
    actual: otherSelf,
    expected: { kind: 'refused', refusal: 'no-responsible-adult' },
  });

  for (const name of ['Debater 1', 'Debater 2', 'Debater 3', 'Debater 4']) {
    const person = world.bots[name]!;
    const submit = {
      version: 1,
      commandId: createId(),
      expected: { entries: entriesVersion },
      command: {
        type: 'submit-entry',
        eventId,
        name,
        memberActorIds: [person.actorId],
        responsible: { kind: 'self' },
        division: null,
      },
    };
    const pending = await send(as(person), lobbyId, submit);
    if (pending.kind !== 'accepted')
      throw new StageFailed(`adult entry ${name}: ${JSON.stringify(pending)}`);
    entriesVersion += 1;
    assert({
      given: 'an adult self enrollment',
      should: 'replay the original receipt',
      actual: await send(as(person), lobbyId, submit),
      expected: { ...pending, receipt: { ...pending.receipt, replayed: true } },
    });
    const [entry] =
      await world.sql`select id, status from entries where event_id = ${eventId} and name = ${name}`;
    if (!entry) throw new StageFailed('adult entry missing');
    const entryId = String(entry.id);
    world.made.set(name, entryId);
    assert({
      given: 'host approval in the resolved event settings',
      should: 'hold the self-submission pending',
      actual: entry.status,
      expected: 'pending',
    });
    const accept = {
      version: 1,
      commandId: createId(),
      expected: { entries: entriesVersion },
      command: { type: 'accept-entry', entryId },
    };
    assert({
      given: 'an entrant without host authority',
      should: 'deny self-acceptance',
      actual: await deniedAsNotFound(() => send(as(person), lobbyId, accept)),
      expected: true,
    });
    const accepted = await send(as(director), lobbyId, accept);
    assert({
      given: 'the actual tournament owner',
      should: 'accept the pending entry',
      actual: accepted.kind,
      expected: 'accepted',
    });
    if (accepted.kind !== 'accepted')
      throw new StageFailed('entry acceptance failed');
    entriesVersion += 1;
    const duplicate = await send(as(person), lobbyId, {
      ...submit,
      commandId: createId(),
      expected: { entries: entriesVersion },
    });
    assert({
      given: 'the same person already entered in the event',
      should: 'refuse duplicate enrollment',
      actual: duplicate,
      expected: { kind: 'refused', refusal: 'already-entered' },
    });
  }
  const rows =
    await world.sql`select e.status, m.entry_status, e.submitted_by_user_id from entries e join entry_members m on m.entry_id = e.id where e.event_id = ${eventId} order by e.name`;
  assert({
    given: 'four accepted entries reloaded from PostgreSQL',
    should:
      'keep entry and member status in agreement and retain each original maker',
    actual: rows.map(
      (row: {
        status: string;
        entry_status: string;
        submitted_by_user_id: string | null;
      }) => [row.status, row.entry_status, row.submitted_by_user_id],
    ),
    expected: ['Debater 1', 'Debater 2', 'Debater 3', 'Debater 4'].map(
      (name) => ['accepted', 'accepted', world.bots[name]!.userId],
    ),
  });
  world.made.set('entries-version', String(entriesVersion));
};
