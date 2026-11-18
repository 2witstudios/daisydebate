import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import {
  admitParticipants,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { entryEnrollmentCommand } from '../../src/features/tab/operations/entry-enrollment';
import { settingCommand } from '../../src/features/tab/operations/settings';

/**
 * Fills a host's free tournament to its cap through the real commands
 * (PYL-14): opens registration with automatic approval, then 17 adults
 * enter themselves, so 16 are accepted and the 17th waits.
 * `bun hosting-seed-process.ts <tournament handle> <host username>`.
 */
if (import.meta.main) {
  const target = process.env.E2E_DATABASE_URL!;
  if (!new URL(target).pathname.endsWith('_e2e'))
    throw new Error('This seed runs only against an E2E database');
  const [handle, hostUsername] = [Bun.argv[2]!, Bun.argv[3]!];
  const owner = new SQL(target, { max: 2 });
  try {
    const [host] = await owner<
      { userId: string; actorId: string }[]
    >`select u.id as "userId", a.id as "actorId" from users u join actors a on a.user_id=u.id where u.username=${hostUsername}`;
    const [event] = await owner<
      { lobbyId: string; eventId: string }[]
    >`select l.id as "lobbyId", e.id as "eventId" from lobbies l join events e on e.lobby_id=l.id where l.handle=${handle}`;
    if (!host || !event) throw new Error('Seed target missing');
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const common = {
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    };
    const as = (person: { userId: string; actorId: string }) => ({
      kind: 'user' as const,
      ...person,
    });
    const settings = settingCommand(common);
    for (const [key, value] of [
      ['entry.registration', { state: 'open' }],
      ['entry.approval', { value: 'automatic' }],
    ] as const) {
      const [row] =
        await owner`select settings_version v from events where id=${event.eventId}`;
      const answer = await settings(as(host), {
        version: 1,
        commandId: createId(),
        expected: { settings: Number(row!.v) },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: event.eventId },
          key,
          value,
          hold: 'default',
        },
      });
      if (answer.kind !== 'accepted') throw new Error(`setting ${key}`);
    }
    const entries = entryEnrollmentCommand(common);
    const people = Array.from({ length: 17 }, (_, n) => ({
      name: `Entrant ${n + 1}`,
      userId: createId(),
      actorId: createId(),
    }));
    for (const person of people) {
      await owner`insert into users (id, username, email_verified, name) values (${person.userId}, ${`entrant-${person.userId}`}, true, ${person.name})`;
      await owner`insert into actors (id, kind, user_id) values (${person.actorId}, 'human', ${person.userId})`;
    }
    await admitParticipants(
      owner,
      people.map((person) => person.userId),
    );
    for (const person of people) {
      const [row] =
        await owner`select entries_version v from events where id=${event.eventId}`;
      const answer = await entries(as(person), event.lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { entries: Number(row!.v) },
        command: {
          type: 'submit-entry',
          eventId: event.eventId,
          name: person.name,
          memberActorIds: [person.actorId],
          responsible: { kind: 'self' },
          division: null,
        },
      });
      if (answer.kind !== 'accepted')
        throw new Error(`entry ${person.name}: ${JSON.stringify(answer)}`);
    }
  } finally {
    await owner.close();
  }
}
