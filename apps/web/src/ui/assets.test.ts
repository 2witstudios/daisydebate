import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { art, avatarSrc } from './assets';
import { createInitialState } from './store/state';

setupRitewayBun();

const publicDirectory = join(import.meta.dir, '../../public');

const missing = (paths: readonly string[]): readonly string[] =>
  paths.filter((path) => !existsSync(join(publicDirectory, path)));

describe('art registry', () => {
  test('points at files that ship in public/', () => {
    assert({
      given: 'every registered art surface',
      should: 'reference an existing public file and carry alt text',
      actual: [
        missing(Object.values(art).map((entry) => entry.src)),
        Object.values(art).filter((entry) => entry.alt.trim() === ''),
      ],
      expected: [[], []],
    });
  });
});

describe('avatarSrc', () => {
  test('resolves every seeded user to a shipped portrait', () => {
    const names = createInitialState().collections.onlineUsers.map(
      (user) => user.name,
    );
    assert({
      given: 'the seeded roster names',
      should: 'return a portrait path that exists in public/',
      actual: missing(
        names.map((name) => avatarSrc(name) ?? `no-portrait/${name}`),
      ),
      expected: [],
    });
  });

  test('returns undefined for unknown names so Avatar falls back', () => {
    assert({
      given: 'a name outside the roster',
      should: 'return undefined',
      actual: avatarSrc('Nobody Here'),
      expected: undefined,
    });
  });
});
