import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  AuthorizationCapability,
  ConflictHandling,
} from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import {
  ask,
  eventRoom,
  eventRound,
  fixture,
  hosted,
  lobbyGrant,
  noViewing,
  permissions,
  type Asker,
} from './lobby.test-support';

setupRitewayBun();

const staff: Asker = {
  grants: [lobbyGrant('hosted', permissions, { grantId: 'staff' })],
};
const handlings: readonly ConflictHandling[] = [
  'denied',
  'second_confirms',
  'flagged',
];
const connected = (
  handling: ConflictHandling,
  waiverId: string | null = null,
) => ({
  connections: ['school_entry' as const],
  handling,
  waiverId,
});
const ballot = (conflict: ReturnType<typeof connected>) => ({
  kind: 'ballot' as const,
  scope: hosted,
  conflict,
  viewing: noViewing,
  part: 'decision' as const,
});
/** Every conflict-sensitive capability on a resource of the connected fixture. */
const sensitive = (conflict: ReturnType<typeof connected>) =>
  [
    ['room.manage', eventRoom({ conflict })],
    ['round.observe.undelayed', eventRound({ conflict })],
    ['tournament.rooms.officiate', fixture(hosted, { conflict })],
    ['tournament.results.enter', fixture(hosted, { conflict })],
    ['tournament.draw.edit', fixture(hosted, { conflict })],
    ['tournament.ballots.read_unreleased', fixture(hosted, { conflict })],
    ['tournament.ballots.read_unreleased', ballot(conflict)],
  ] as const;
const outcome = (decision: ReturnType<typeof ask>) =>
  decision.allow ? 'allow' : decision.reason;

describe('a connection to a fixture', () => {
  test('covers every capability the protocol marks conflict-sensitive', () => {
    assert({
      given: 'the cases below',
      should: 'name exactly the conflict-sensitive capabilities',
      actual: [
        ...new Set(
          sensitive(connected('denied')).map(([capability]) => capability),
        ),
      ].sort(),
      expected: (Object.keys(capabilityMetadata) as AuthorizationCapability[])
        .filter(
          (capability) => capabilityMetadata[capability].conflictSensitive,
        )
        .sort(),
    });
  });

  test('is answered as the resolved handling says', () => {
    assert({
      given:
        'staff connected to the fixture, under each handling, without and with a confirmed waiver',
      should:
        'deny, ask for a second person until a waiver exists, or allow with a flag',
      actual: handlings.map((handling) =>
        [null, 'waiver'].map((waiverId) => [
          ...new Set(
            sensitive(connected(handling, waiverId)).map(
              ([capability, resource]) =>
                outcome(ask(capability, resource, staff)),
            ),
          ),
        ]),
      ),
      expected: [
        [['conflict'], ['conflict']],
        [['confirmation-required'], ['allow']],
        [['allow'], ['allow']],
      ],
    });
  });

  test('always comes back with the decision', () => {
    const decisions = handlings.flatMap((handling) =>
      [staff, {}].flatMap((asker) => [
        ...sensitive(connected(handling)).map(([capability, resource]) =>
          ask(capability, resource, asker),
        ),
        ask(
          'result.read',
          fixture(hosted, { conflict: connected(handling) }),
          asker,
        ),
        ask('room.read', eventRoom({ conflict: connected(handling) }), asker),
      ]),
    );
    assert({
      given:
        'every decision for a connected person, allowed or denied, with authority or without',
      should: 'carry the conflict with its connections and handling',
      actual: decisions.filter(
        (decision) => decision.conflict?.connections.join() !== 'school_entry',
      ).length,
      expected: 0,
    });
    assert({
      given: 'the same staff with no connection, and a fixture-less question',
      should: 'carry no conflict',
      actual: [
        ask('tournament.results.enter', fixture(hosted), staff),
        ask(
          'tournament.draw.edit',
          { kind: 'draw', scope: hosted, viewing: noViewing },
          staff,
        ),
      ],
      expected: Array(2).fill({
        allow: true,
        authority: { kind: 'grant', grantId: 'staff' },
        conflict: null,
      }),
    });
  });

  test('an owner is in conflict like anyone else', () => {
    assert({
      given: 'the tournament’s owner connected to a fixture under denied',
      should: 'be denied for the conflict',
      actual: outcome(
        ask(
          'tournament.results.enter',
          fixture(hosted, { conflict: connected('denied') }),
          {
            actorId: 'host',
          },
        ),
      ),
      expected: 'conflict',
    });
  });
});

describe('confirming a held command', () => {
  const pending = (conflict = connected('second_confirms')) => ({
    kind: 'pending_command' as const,
    proposerActorId: 'proposer',
    capability: 'tournament.results.enter' as const,
    target: fixture(hosted, { conflict }),
  });
  const unconnected = {
    connections: [],
    handling: 'second_confirms' as const,
    waiverId: null,
  };
  test('needs a second, unconnected holder of the command’s capability', () => {
    assert({
      given:
        'the proposer, a connected colleague, a person without the capability, and an unconnected colleague',
      should: 'allow only the unconnected colleague, under their own grant',
      actual: [
        outcome(
          ask('command.confirm', pending(unconnected), {
            ...staff,
            actorId: 'proposer',
          }),
        ),
        outcome(ask('command.confirm', pending(), staff)),
        outcome(
          ask('command.confirm', pending({ ...connected('flagged') }), staff),
        ),
        outcome(ask('command.confirm', pending(unconnected), {})),
        ask('command.confirm', pending(unconnected), staff),
      ],
      expected: [
        'missing-capability',
        'confirmation-required',
        'conflict',
        'missing-capability',
        {
          allow: true,
          authority: { kind: 'grant', grantId: 'staff' },
          conflict: null,
        },
      ],
    });
  });
  test('is never allowed to the proposer or a connected person', () => {
    const cases = handlings.flatMap((handling) =>
      [null, 'waiver'].flatMap((waiverId) =>
        ['proposer', 'person'].map((actorId) => ({
          handling,
          waiverId,
          actorId,
        })),
      ),
    );
    assert({
      given:
        'every handling and waiver, for the proposer and for a connected colleague',
      should: 'never confirm',
      actual: cases.filter(
        ({ handling, waiverId, actorId }) =>
          ask('command.confirm', pending(connected(handling, waiverId)), {
            ...staff,
            actorId,
          }).allow,
      ),
      expected: [],
    });
  });
  test('is withdrawn only by its proposer, and never asked of the wrong resource', () => {
    assert({
      given:
        'the proposer and a colleague withdrawing, and a held capability that is not a fixture’s',
      should: 'allow the proposer alone, and deny the mismatch',
      actual: [
        outcome(ask('command.withdraw', pending(), { actorId: 'proposer' })),
        outcome(ask('command.withdraw', pending(), staff)),
        outcome(
          ask(
            'command.confirm',
            { ...pending(unconnected), capability: 'lobby.announce' },
            staff,
          ),
        ),
      ],
      expected: ['allow', 'missing-capability', 'denied'],
    });
  });
});
