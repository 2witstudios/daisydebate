import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotAudioActivity } from './activity';
setupRitewayBun();
const roundId = 'a'.repeat(24),
  participantId = 'b'.repeat(24),
  peer = 'c'.repeat(24);
test('actual PCM activity can cancel a phrase without granting competitive authority', () => {
  const events: string[] = [];
  const observer = createBotAudioActivity({
    roundId,
    participantId,
    peerParticipantIds: [peer],
    staleAfterMs: 1000,
    playing: () => true,
    onEvent: ({ kind }) => events.push(kind),
  });
  const frame = (sequence: number, seat = peer) => ({
    roundId,
    roundParticipantId: seat,
    trackId: 'track',
    sequence,
    beforeMs: sequence * 10,
    afterMs: sequence * 10 + 10,
    serverWindow: {
      before: new Date(1000000 + sequence * 10).toISOString(),
      after: new Date(1000010 + sequence * 10).toISOString(),
    },
    receivedAt: new Date(1000020 + sequence * 10).toISOString(),
    pcm: new Int16Array(160).fill(16000),
  });
  for (let sequence = 0; sequence <= 31; sequence++)
    observer.observe(frame(sequence));
  assert({
    given: 'sustained actual captured peer PCM while a phrase plays',
    should: 'emit only the retained barge-in heuristic',
    actual: events,
    expected: ['barge-in'],
  });
  observer.observe(frame(32, participantId));
  observer.observe({ ...frame(32), roundId: 'foreign' });
  observer.observe(frame(40));
  assert({
    given: 'own/foreign audio and a real peer sequence gap',
    should:
      'ignore unrelated streams and conservatively mark only peer activity unknown',
    actual: events,
    expected: ['barge-in', 'unknown'],
  });
  observer.expire(new Date(1001401).toISOString());
  observer.expire(new Date(1001401).toISOString());
  assert({
    given: 'stale media activity',
    should: 'emit one unknown without attendance or floor authority',
    actual: events,
    expected: ['barge-in', 'unknown', 'unknown'],
  });
  observer.observe({
    ...frame(41),
    receivedAt: new Date(1005000).toISOString(),
  });
  assert({
    given:
      'queued PCM with a new PG ingress receipt and old calibrated capture window',
    should:
      'stay unheard, said once, rather than relabel the frame with ingress time',
    actual: events,
    expected: ['barge-in', 'unknown', 'unknown'],
  });
});

/** A hearing of one peer, fed 10 ms frames on a server clock starting at T0. */
function hearing(playing: () => boolean = () => false) {
  const events: string[] = [];
  const T0 = 2_000_000;
  const observer = createBotAudioActivity({
    roundId,
    participantId,
    peerParticipantIds: [peer],
    staleAfterMs: 250,
    playing,
    onEvent: (event) =>
      events.push(
        event.kind === 'end-of-turn'
          ? `end-of-turn spoke-until +${event.spokeUntilMs - T0}`
          : event.kind,
      ),
  });
  let sequence = 0;
  /** Frames covering `fromMs` to `toMs`; a gap in time is a gap in sequence too. */
  const frames = (fromMs: number, toMs: number, level: number) => {
    for (let at = fromMs; at < toMs; at += 10) {
      sequence = at / 10;
      observer.observe({
        roundId,
        roundParticipantId: peer,
        trackId: 'track',
        sequence,
        beforeMs: at,
        afterMs: at + 10,
        serverWindow: {
          before: new Date(T0 + at).toISOString(),
          after: new Date(T0 + at + 10).toISOString(),
        },
        receivedAt: new Date(T0 + at + 20).toISOString(),
        pcm: new Int16Array(160).fill(level),
      });
    }
  };
  /** The seat's 50 ms polls from `fromMs` to `toMs`, with no frame arriving. */
  const silence = (fromMs: number, toMs: number) => {
    for (let at = fromMs; at < toMs; at += 50)
      observer.expire(new Date(T0 + at).toISOString());
  };
  return { events, frames, silence };
}
const LOUD = 4000;

test('a 300 ms stall in a peer’s frames keeps the turn, and the pause after still ends it', () => {
  const { events, frames, silence } = hearing();
  frames(0, 1000, LOUD);
  silence(1000, 1300);
  frames(1300, 1800, LOUD);
  frames(1800, 2800, 0);
  assert({
    given:
      'a peer speaking, a 300 ms stall with no frames, more speech, then a pause',
    should:
      'report the stall as unheard once and end the one turn at the instant the peer last spoke',
    actual: events,
    expected: ['speech-start', 'unknown', 'end-of-turn spoke-until +1800'],
  });
});

test('a peer who goes unheard after speaking has ended their turn', () => {
  const { events, frames, silence } = hearing();
  frames(0, 1000, LOUD);
  silence(1000, 2400);
  assert({
    given: 'a peer who asked a question and whose audio then stopped arriving',
    should: 'end their turn after the end-of-turn pause, so the bot answers',
    actual: events,
    expected: ['speech-start', 'unknown', 'end-of-turn spoke-until +1000'],
  });
});

test('the bot’s own voice coming back just after it stops is not a peer turn', () => {
  let playing = true;
  const { events, frames } = hearing(() => playing);
  frames(0, 500, 600);
  playing = false;
  frames(500, 800, 600);
  frames(800, 2000, 0);
  assert({
    given:
      'a faint level in the peer’s microphone while the bot plays and for 300 ms after it stops',
    should: 'report no peer speech and no ended turn',
    actual: events,
    expected: [],
  });
});

test('loud frames either side of a short gap do not add up to a barge-in', () => {
  const { events, frames } = hearing(() => true);
  frames(0, 100, LOUD);
  // 200 ms of frames lost: shorter than the stale bound, so no poll saw it.
  frames(300, 400, LOUD);
  assert({
    given:
      'the bot playing, 100 ms of loud peer audio, a 200 ms gap in the frames, then 100 ms more',
    should: 'report the gap and no barge-in',
    actual: events,
    expected: ['unknown'],
  });
});
