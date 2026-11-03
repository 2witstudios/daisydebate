import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveCheckout } from './slot';
import {
  deriveSlot,
  mainSlotRefusal,
  mayPrune,
  recordedStackOwner,
  stackOwnerMark,
  stackStanding,
  worktreeSlot,
} from './slot-model';

setupRitewayBun();

const git = async (cwd: string, ...args: readonly string[]) => {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  if ((await child.exited) !== 0) throw new Error(`git ${args[0]} failed`);
};

const inScratchRepository = async (
  body: (path: string) => Promise<void>,
): Promise<void> => {
  const path = await mkdtemp(join(tmpdir(), 'slot-ownership-'));
  try {
    await git(path, 'init', '--quiet');
    await writeFile(join(path, 'package.json'), '{}');
    await body(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const repositoryAt = (mainCheckout: string, hasOrigin: boolean) => ({
  ownerMark: stackOwnerMark(mainCheckout),
  hasOrigin,
});
const owner = stackOwnerMark('/repo');

test('the mark fits what a database comment may hold', () => {
  assert({
    given: 'an owner mark',
    should: 'match the slots comment rule and name no path',
    actual: [/^[a-z0-9 =-]{1,100}$/.test(owner), owner.includes('repo')],
    expected: [true, false],
  });
});

describe('what a database comment records', () => {
  const standing = (comment: string | null, hasOrigin: boolean) =>
    stackStanding({
      repository: repositoryAt('/repo', hasOrigin),
      recordedOwner: recordedStackOwner(comment),
    });
  const initdbDefault = 'default administrative connection database';

  test('the comment initdb gives postgres records no owner', () => {
    assert({
      given: 'that exact comment, on a repository with and without an origin',
      should: 'be claimable with an origin and foreign without',
      actual: [standing(initdbDefault, true), standing(initdbDefault, false)],
      expected: ['claimable', 'foreign'],
    });
  });

  test('only a mark is an owner', () => {
    assert({
      given: 'the owner mark, another mark and no comment',
      should: 'stand as owner, foreign and claimable',
      actual: [
        standing(owner, true),
        standing(stackOwnerMark('/elsewhere'), true),
        standing(null, true),
      ],
      expected: ['owner', 'foreign', 'claimable'],
    });
  });
});

describe('a fresh git init copy (ISSUE-928)', () => {
  test('resolves as the main checkout, and may neither prune nor use the main slot', async () => {
    await inScratchRepository(async (path) => {
      const copy = await resolveCheckout(path);
      const standings = [owner, null].map((recordedOwner) =>
        stackStanding({ repository: copy.repository, recordedOwner }),
      );
      assert({
        given: 'a copy on a stack with an owner, and on one with none',
        should:
          'look like the main checkout with no origin, and stand as foreign both times',
        actual: {
          slot: copy.slot.kind,
          origin: copy.repository.hasOrigin,
          standings,
        },
        expected: {
          slot: 'main',
          origin: false,
          standings: ['foreign', 'foreign'],
        },
      });
      assert({
        given: 'that standing',
        should: 'refuse the main slot and every prune',
        actual: standings.map((standing) => [
          mainSlotRefusal(copy.slot, standing) !== null,
          mayPrune(standing),
        ]),
        expected: [
          [true, false],
          [true, false],
        ],
      });
    });
  });

  test('giving the copy an origin does not take a stack that has an owner', async () => {
    await inScratchRepository(async (path) => {
      await git(path, 'remote', 'add', 'origin', 'https://example.test/repo');
      const copy = await resolveCheckout(path);
      assert({
        given: 'a copy with an origin, on an owned stack and an unowned one',
        should:
          'stay foreign to the owned stack; only an unowned one is claimable',
        actual: [
          stackStanding({ repository: copy.repository, recordedOwner: owner }),
          stackStanding({ repository: copy.repository, recordedOwner: null }),
        ],
        expected: ['foreign', 'claimable'],
      });
    });
  });
});

describe('the repository that owns the stack', () => {
  test('its main checkout and a linked worktree share one mark', async () => {
    await inScratchRepository(async (path) => {
      await git(path, 'remote', 'add', 'origin', 'https://example.test/repo');
      await git(path, 'add', '.');
      await git(
        path,
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--quiet',
        '-m',
        'first',
      );
      const linked = await mkdtemp(join(tmpdir(), 'slot-ownership-linked-'));
      await rm(linked, { recursive: true, force: true });
      try {
        await git(path, 'worktree', 'add', '--quiet', '--detach', linked);
        const main = await resolveCheckout(path);
        const worktree = await resolveCheckout(linked);
        const recordedOwner = main.repository.ownerMark;
        assert({
          given: 'the main checkout recorded as the owner, and its worktree',
          should: 'stand as the owner from both, each in its own slot',
          actual: [main, worktree].map((checkout) => [
            checkout.slot.kind,
            stackStanding({ repository: checkout.repository, recordedOwner }),
          ]),
          expected: [
            ['main', 'owner'],
            ['worktree', 'owner'],
          ],
        });
      } finally {
        await rm(linked, { recursive: true, force: true });
      }
    });
  });

  test('may prune and use the main slot', () => {
    assert({
      given: 'the recorded owner',
      should: 'allow both',
      actual: [
        mainSlotRefusal(
          deriveSlot({ checkout: '/repo', mainCheckout: '/repo' }),
          stackStanding({
            repository: repositoryAt('/repo', true),
            recordedOwner: owner,
          }),
        ),
        mayPrune(
          stackStanding({
            repository: repositoryAt('/repo', true),
            recordedOwner: owner,
          }),
        ),
      ],
      expected: [null, true],
    });
  });

  test('a foreign worktree keeps its own slot, and prunes nothing', () => {
    assert({
      given: 'a worktree of another repository',
      should: 'not be refused its own slot, and not prune',
      actual: [
        mainSlotRefusal(worktreeSlot('abc'), 'foreign'),
        mayPrune('foreign'),
      ],
      expected: [null, false],
    });
  });
});
