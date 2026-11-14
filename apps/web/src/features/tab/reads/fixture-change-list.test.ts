import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { FixtureChange } from '@daisy/protocol/lobby/command';
import { fixtureChangeListSchema } from '@daisy/protocol/lobby/fixture-change-read';
import {
  fixtureChangeListOf,
  readFixtureChangeList,
  type FixtureChangeListFacts,
} from './fixture-change-list';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const tabRoundId = id('t');
const [debater, ward, judge, other] = [id('a'), id('w'), id('j'), id('o')];
const added: FixtureChange = {
  kind: 'added',
  fixtureId: id('f'),
  tabRoundId,
  drawVersion: 2,
  people: [debater, other, judge],
};
const officiated: FixtureChange = {
  kind: 'officiated',
  fixtureId: id('g'),
  tabRoundId,
  commandId: id('c'),
  type: 'assign-judge',
  people: [ward, other, judge],
};
const untouched: FixtureChange = {
  kind: 'withdrawn',
  fixtureId: id('h'),
  tabRoundId,
  drawVersion: 2,
  people: [other],
};
const facts = (viewerActorIds: readonly string[]): FixtureChangeListFacts => ({
  tabRoundId,
  changes: [added, officiated, untouched],
  nextCursor: 'after:3',
  viewerActorIds,
});

test('an official sees every change', () => {
  const list = fixtureChangeListOf(facts([]), true);
  assert({
    given: 'an official',
    should: 'list every change with all its people',
    actual: list,
    expected: {
      seen: 'all',
      tabRoundId,
      nextCursor: 'after:3',
      changes: [added, officiated, untouched],
    },
  });
  assert({
    given: 'the projection',
    should: 'parse as the read',
    actual: fixtureChangeListSchema.safeParse(list).success,
    expected: true,
  });
});

test('a person sees only what touches them or a ward', () => {
  const list = fixtureChangeListOf(facts([debater, ward]), false);
  assert({
    given: 'a guardian who debates, with a ward in another fixture',
    should:
      'list the changes that touch them or the ward, naming only those people',
    actual: list,
    expected: {
      seen: 'touching',
      tabRoundId,
      nextCursor: 'after:3',
      changes: [
        { ...added, people: [debater] },
        { ...officiated, people: [ward] },
      ],
    },
  });
  assert({
    given: 'a person no change touches',
    should: 'list nothing',
    actual: fixtureChangeListOf(facts([id('z')]), false).changes,
    expected: [],
  });
});

test('the read is gated on reading the posting', async () => {
  const principal = { kind: 'user', userId: id('u') } as const;
  const authorizeWith =
    (allowed: readonly string[]) =>
    (input: AuthorizationInput): AuthorizationDecision =>
      allowed.includes(input.capability)
        ? ({
            allow: true,
            authority: { kind: 'fixed' },
            conflict: null,
          } as AuthorizationDecision)
        : ({
            allow: false,
            reason: 'missing-capability',
          } as AuthorizationDecision);
  const load = async () => ({
    facts: facts([judge]),
    authority: { principal } as unknown as Omit<
      AuthorizationInput,
      'capability'
    >,
  });
  assert({
    given: 'a viewer who may not read the posting, a participant, and a host',
    should: 'answer as missing, the touching cut, and every change',
    actual: [
      await readFixtureChangeList(authorizeWith([]), load),
      (await readFixtureChangeList(authorizeWith(['posting.read']), load))
        ?.seen,
      (
        await readFixtureChangeList(
          authorizeWith(['posting.read', 'lobby.host.read']),
          load,
        )
      )?.seen,
    ],
    expected: [null, 'touching', 'all'],
  });
});
