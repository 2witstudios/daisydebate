import { assert, setupRitewayBun, test } from 'riteway/bun';
import { activityWanted, createActivityRelay } from './capture-activity';
import type { CaptureState } from './capture-history';
import type { StagedFrame } from './capture-staging';
setupRitewayBun();
const staged = (
  seat: string,
  sequence: number,
  segmentId = 'g'.repeat(24),
): StagedFrame => ({
  seat,
  segmentId,
  observedAtMs: sequence * 10 + 5,
  original: { sequence, beforeMs: sequence * 10, afterMs: sequence * 10 + 5 },
  frame: {
    pcm: new Int16Array(160).fill(sequence),
    trackId: `${seat[0]}-track`,
    nominalStartMs: 1000 + sequence * 10,
    beforeMs: 999 + sequence * 10,
    afterMs: 1011 + sequence * 10,
  },
});
const host = 'h'.repeat(24),
  guest = 'q'.repeat(24);
test('the activity relay repeats each seat window and sends only seats with new frames', () => {
  const relay = createActivityRelay();
  for (let i = 0; i < 22; i++) relay.observe(staged(host, i));
  relay.observe(staged(guest, 40));
  const first = relay.take();
  relay.observe(staged(host, 22));
  const second = relay.take();
  assert({
    given: 'more frames for one seat than a batch holds, then one more frame',
    should:
      'send the newest twenty per seat, then the sliding window for only the seat that moved',
    actual: {
      first: first.map((b) => [
        b.roundParticipantId,
        b.frames.map((f) => f.sequence),
      ]),
      second: second.map((b) => [
        b.roundParticipantId,
        b.frames.map((f) => f.sequence),
      ]),
      idle: relay.take(),
    },
    expected: {
      first: [
        [host, Array.from({ length: 20 }, (_, i) => i + 2)],
        [guest, [40]],
      ],
      second: [[host, Array.from({ length: 20 }, (_, i) => i + 3)]],
      idle: [],
    },
  });
  assert({
    given: 'one staged guest frame',
    should:
      'carry its original native brackets and plain PCM with the calibrated server window',
    actual: first[1]!.frames,
    expected: [
      {
        trackId: 'q-track',
        sequence: 40,
        pcm: Array<number>(160).fill(40),
        beforeMs: 400,
        afterMs: 405,
        serverWindow: {
          before: new Date(1399).toISOString(),
          after: new Date(1411).toISOString(),
        },
      },
    ],
  });
});
test('a new segment starts a fresh window that names its segment', () => {
  const relay = createActivityRelay();
  relay.observe(staged(host, 1));
  relay.observe(staged(host, 2));
  relay.observe(staged(host, 3, 'n'.repeat(24)));
  assert({
    given: 'two frames in one segment, then one in the next',
    should: 'send only the new segment\'s frames, naming that segment',
    actual: relay
      .take()
      .map((b) => [b.segmentId, b.frames.map((f) => f.sequence)]),
    expected: [['n'.repeat(24), [3]]],
  });
});
test('peer activity is relayed only while a bot may speak in cross-examination', () => {
  const state = (type: 'speech' | 'cross_ex' | null, bot: boolean) =>
    ({
      segment: type === null ? null : { type },
      participants: [
        { roundParticipantId: host, identity: 'i', kind: 'human' },
        {
          roundParticipantId: guest,
          identity: 'j',
          kind: bot ? 'bot' : 'human',
        },
      ],
    }) as unknown as CaptureState;
  assert({
    given:
      'cross-ex with a bot, cross-ex between humans, a bot speech and no segment',
    should: 'want activity only in the bot cross-ex',
    actual: [
      activityWanted(state('cross_ex', true)),
      activityWanted(state('cross_ex', false)),
      activityWanted(state('speech', true)),
      activityWanted(state(null, true)),
    ],
    expected: [true, false, false, false],
  });
});
