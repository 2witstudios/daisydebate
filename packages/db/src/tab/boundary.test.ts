import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { boundaryOf, BoundaryOutsideSubject, loadBoundary } from './boundary';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';

setupRitewayBun();

const id = (c: string) => c.repeat(24);

describe('boundaryOf', () => {
  test('no guardian limits lobbies', () => {
    assert({
      given: 'no active restriction that limits lobbies',
      should: 'be no boundary',
      actual: boundaryOf([], [id('e')], 4),
      expected: null,
    });
  });
  test('one guardian limits lobbies', () => {
    assert({
      given: 'one restriction allowing two lobbies, and two entries',
      should: 'allow those lobbies and carry the entries and revision',
      actual: boundaryOf([[id('b'), id('a')]], [id('e'), id('e')], 4),
      expected: {
        allowedLobbyIds: [id('a'), id('b')],
        entryLobbyIds: [id('e')],
        revision: 4,
      },
    });
  });
  test('two guardians limit lobbies', () => {
    assert({
      given: 'two restrictions that share one lobby',
      should: 'allow only the lobby every guardian allows',
      actual: boundaryOf([[id('a'), id('b')], [id('b')]], [], 1)
        ?.allowedLobbyIds,
      expected: [id('b')],
    });
  });
  test('a guardian limits to no lobby', () => {
    assert({
      given: 'a restriction that limits lobbies and lists none',
      should: 'be a boundary that allows nothing',
      actual: boundaryOf([[]], [], 1)?.allowedLobbyIds,
      expected: [],
    });
  });
});

describe('loadBoundary', () => {
  test('a person who is not the subject', async () => {
    const queried: string[] = [];
    const tx = drizzle({
      client: new SQL('postgres://127.0.0.1:1/daisy_inert'),
      logger: { logQuery: (sql) => queried.push(sql) },
    });
    const refused = await loadBoundary(
      tx,
      { userId: id('m'), actorId: id('a'), revision: 1 },
      { subjectUserId: id('s') },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    assert({
      given: 'a boundary asked for someone the fence does not show their rows',
      should: 'refuse before reading, never answer unbounded',
      actual: [refused instanceof BoundaryOutsideSubject, queried],
      expected: [true, []],
    });
  });
});
