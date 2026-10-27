import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hostIdentityHidden, projectRoom } from './room-projection';
import { formatSettingsSchema, roomViewSchema } from '@daisy/protocol';
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
const view = (viewer: string) =>
  projectRoom(room, viewer, consent, edges.now, null);
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
    projectRoom(hostJudges, viewer, consent, edges.now, null);

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

test('a judge-host is hidden from everyone but themselves', () => {
  const host = 'h'.repeat(24),
    viewer = 'v'.repeat(24);
  assert({
    given:
      'a host in a human judge seat, a non-judge host, and the host reading',
    should: 'hide only the judge-host and only from other viewers',
    actual: [
      hostIdentityHidden({ hostActorId: host, hostIsHumanJudge: true }, viewer),
      hostIdentityHidden(
        { hostActorId: host, hostIsHumanJudge: false },
        viewer,
      ),
      hostIdentityHidden({ hostActorId: host, hostIsHumanJudge: true }, host),
    ],
    expected: [true, false, false],
  });
});

describe('projectRoom format (FMT-1)', () => {
  // Countdown latitude, so an edit compiles and shows as a change.
  const definition = {
    ...base.definition,
    configurable: {
      ...base.definition.configurable,
      timing: {
        ...base.definition.configurable.timing,
        countdownMs: { min: 0, max: 10_000 },
      },
    },
  };
  const standard = {
    ...base,
    definition,
    formatId: 'value',
    catalogFormat: { name: 'Value', role: 'standard' as const, leagues: [] },
    basis: {
      formatId: 'value',
      presetVersion: 3,
      formatVersion: base.formatVersion,
      name: 'Value',
      role: 'standard' as const,
      definition,
      config: formatSettingsSchema.parse(base.config),
    },
  };
  test('a room still on its standard', () => {
    const seen = projectRoom(standard, 'other', consent, edges.now, null);
    assert({
      given: 'a room running its standard basis unchanged',
      should:
        'carry the format’s name, its basis and a Standard standing, and no internal basis fields',
      actual: {
        format: seen.format,
        leaked: ['catalogFormat', 'basis'].filter((key) => key in seen),
        parses: roomViewSchema.shape.format.safeParse(seen.format).success,
      },
      expected: {
        format: {
          name: 'Value',
          role: 'standard',
          leagues: [],
          basis: {
            formatId: 'value',
            name: 'Value',
            formatVersion: base.formatVersion,
            presetVersion: 3,
            strikes: false,
          },
          standing: { kind: 'standard', formatId: 'value' },
        },
        leaked: [],
        parses: true,
      },
    });
  });
  test('a room edited away from its standard', () => {
    const seen = projectRoom(
      {
        ...standard,
        config: {
          ...standard.config,
          speechTiming: { ...standard.config.speechTiming, countdownMs: 5_000 },
        },
      },
      'other',
      consent,
      edges.now,
      null,
    );
    assert({
      given: 'a standard room whose countdown changed',
      should: 'read Custom, based on the standard, with the typed change',
      actual: seen.format.standing,
      expected: {
        kind: 'custom',
        basis: { formatId: 'value', role: 'standard' },
        changes: [
          {
            kind: 'countdown',
            fromMs: standard.config.speechTiming.countdownMs,
            toMs: 5_000,
          },
        ],
      },
    });
  });
});
