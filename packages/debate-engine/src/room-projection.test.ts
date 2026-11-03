import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hostIdentityHidden, projectRoom } from './room-projection';
import { roomViewSchema } from '@daisy/protocol';
import { plainFormatSettings } from '@daisy/protocol/testing';
import { state } from './room-assembly.test-support';

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
  projectRoom(room, viewer, consent, '2026-11-02T12:00:00.000Z');
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

  test('the judge and a seatless host', () => {
    const seatless = {
      ...room,
      hostActorId: 'seatless-host',
    };
    assert({
      given: 'the same room read by the judge and by a seatless host',
      should: 'name the judge to both',
      actual: ['judge-actor', 'seatless-host'].map(
        (viewer) =>
          'label' in
          projectRoom(seatless, viewer, consent, '2026-11-02T12:00:00.000Z')
            .participants[2]!,
      ),
      expected: [true, true],
    });
  });

  test('a debater who hosts', () => {
    const seen = view('host');
    assert({
      given: 'the room read by its host, who holds a debating seat',
      should:
        'carry no judge name, seat id or actor: hosting adds nothing to a seat (WATCH-6)',
      actual: [
        'anonymous' in seen.participants[2]!,
        leaks(seen),
        seen.readiness.readyActorIds.includes('judge-actor'),
      ],
      expected: [true, [], false],
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
    projectRoom(hostJudges, viewer, consent, '2026-11-02T12:00:00.000Z');

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
      config: plainFormatSettings,
    },
  };
  test('a room still on its standard', () => {
    const seen = projectRoom(
      standard,
      'other',
      consent,
      '2026-11-02T12:00:00.000Z',
    );
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
      '2026-11-02T12:00:00.000Z',
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

describe('projectRoom for someone outside a started Room (WATCH-6)', () => {
  const now = '2026-01-01T00:00:00.000Z';
  const started = {
    ...room,
    status: 'started' as const,
    roundRef: { id: 'round', status: 'active' as const },
  };
  const drawn = {
    ...started,
    topic: 'The drawn resolution',
    config: {
      ...started.config,
      resolutionDraw: {
        enabled: true as const,
        source: { kind: 'bank' as const, count: 5 },
      },
    },
  } as unknown as typeof started;
  const noConsent = { available: true, readyActorIds: [] };
  const closedBase = { ...room, status: 'closed' as const };

  test('reads like any other closed Room', () => {
    const outsider = projectRoom(started, 'outsider', noConsent, now);
    assert({
      given: 'a started public Room read by someone with no seat',
      should:
        'answer closed, as an expired or cancelled Room does, so nothing says it started',
      actual: outsider,
      expected: projectRoom(closedBase, 'outsider', noConsent, now),
    });
  });

  test('never carries a drawn resolution', () => {
    const outsider = projectRoom(drawn, 'outsider', noConsent, now);
    assert({
      given: 'a started draw Room read by someone with no seat',
      should: 'carry no resolution, which the spectator timeline releases',
      actual: [outsider.topic, JSON.stringify(outsider).includes('drawn res')],
      expected: [null, false],
    });
  });

  test('keeps a resolution known before the Round', () => {
    assert({
      given: 'a started Room with no draw, read by someone with no seat',
      should: 'keep the topic it showed during assembly',
      actual: projectRoom(
        { ...started, topic: 'Authored' },
        'outsider',
        noConsent,
        now,
      ).topic,
      expected: 'Authored',
    });
  });

  test('tells its seats and host the truth', () => {
    assert({
      given: 'the same draw Room read by a seat and by its host',
      should: 'say started and carry the resolution',
      actual: ['judge-actor', drawn.hostActorId].map((viewer) => {
        const seen = projectRoom(drawn, viewer, noConsent, now);
        return [seen.status, seen.topic];
      }),
      expected: [
        ['started', 'The drawn resolution'],
        ['started', 'The drawn resolution'],
      ],
    });
  });
});

describe('projectRoom round reference', () => {
  const started = {
    ...room,
    status: 'started' as const,
    roundRef: { id: 'round', status: 'active' as const },
  };
  const consent = { available: true, readyActorIds: [] };
  const refFor = (actorId: string) =>
    projectRoom(started, actorId, consent, '2026-01-01T00:00:00.000Z').roundRef;
  test('names a live Round only to its seats and host', () => {
    assert({
      given: 'a started public Room read by a non-participant',
      should: 'carry no Round reference (WATCH-6)',
      actual: refFor('outsider'),
      expected: null,
    });
    assert({
      given: 'the same Room read by its host and by a seated judge',
      should: 'carry the Round reference',
      actual: [refFor(started.hostActorId), refFor('judge-actor')],
      expected: [started.roundRef, started.roundRef],
    });
  });
});
