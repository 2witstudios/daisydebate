import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { projectRoom } from './room-projection';
import { edges, state } from './room-assembly.test-support';

setupRitewayBun();

const base = state();
const room = {
  ...base,
  participants: [
    ...base.participants,
    {
      id: 'p3',
      actorId: 'judge-actor',
      label: 'Riley Judge',
      kind: 'human' as const,
      role: 'judge' as const,
      slot: 0,
      eligible: true,
      consentVersion: 0,
      consentCommandId: 'r3',
    },
  ],
};
const consent = {
  available: true,
  readyActorIds: ['host', 'other', 'judge-actor'],
};
const view = (viewer: string) => projectRoom(room, viewer, consent, edges.now);
const leaks = (value: unknown) =>
  ['Riley', 'p3', 'judge-actor'].filter((secret) =>
    JSON.stringify(value).includes(secret),
  );

describe('projectRoom judge anonymity (DEC-174)', () => {
  test('a debater', () => {
    const seen = view('other');
    assert({
      given:
        'a seated, ready human judge, read by a debater who is not the host',
      should:
        'show the judge seat as filled with its ready state and carry no judge name, seat id or actor',
      actual: [seen.participants[2], leaks(seen)],
      expected: [
        {
          role: 'judge',
          kind: 'human',
          slot: 0,
          anonymous: true,
          needsReady: true,
          ready: 'ready',
          eligible: true,
        },
        [],
      ],
    });
  });

  test('the judge and the host', () => {
    assert({
      given: 'the same room read by the judge and by the host',
      should: 'name the judge to both',
      actual: ['judge-actor', 'host'].map(
        (viewer) => 'label' in view(viewer).participants[2]!,
      ),
      expected: [true, true],
    });
  });
});

describe('projectRoom judge anonymity when the host judges (DEC-174)', () => {
  const hostJudges = {
    ...room,
    participants: room.participants.map((p) =>
      p.role === 'judge'
        ? { ...p, actorId: 'host', label: 'Host', id: 'p3-host' }
        : p,
    ),
  };
  const hostView = (viewer: string) =>
    projectRoom(hostJudges, viewer, consent, edges.now);

  test('a debater', () => {
    const seen = hostView('other');
    assert({
      given:
        'the host seated in the human judge seat, read by a debater who is neither',
      should:
        'redact the host identity with the judge seat: no judge row name and no host actor or label',
      actual: [
        seen.participants[2],
        seen.hostActorId,
        seen.hostLabel,
        JSON.stringify(seen).includes('Host'),
      ],
      expected: [
        {
          role: 'judge',
          kind: 'human',
          slot: 0,
          anonymous: true,
          needsReady: true,
          ready: 'ready',
          eligible: true,
        },
        null,
        null,
        false,
      ],
    });
  });

  test('the host judging their own room', () => {
    const seen = hostView('host');
    assert({
      given: 'the same room read by the host who sits as its judge',
      should: 'keep their host identity and name their own judge seat',
      actual: [
        seen.hostActorId,
        seen.hostLabel,
        'label' in seen.participants[2]!,
      ],
      expected: ['host', 'Host', true],
    });
  });
});
