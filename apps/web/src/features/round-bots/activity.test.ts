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
    should: 'remain unknown rather than relabel the frame with ingress time',
    actual: events,
    expected: ['barge-in', 'unknown', 'unknown', 'unknown'],
  });
});
