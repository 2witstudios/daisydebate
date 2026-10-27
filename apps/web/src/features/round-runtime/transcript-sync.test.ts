import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ENVELOPE_VERSION,
  buildDebateTopic,
  type RoundTranscriptRead,
} from '@daisy/protocol';
import { driverEdges } from '../resource-sync/driver.test-support';
import type { ResourceRead } from '../resource-sync/driver';
import { round } from '../room-runtime/operations.test-support';
import { createTranscriptSync, seedTranscript } from './transcript-sync';
setupRitewayBun();
const transcript = (revision: number): RoundTranscriptRead => ({
  round,
  revision,
  freeze: null,
  streams: [],
  utterances: [],
});
test('capture invalidation refreshes independently of competitive Round version', async () => {
  const edges = driverEdges<ResourceRead<RoundTranscriptRead>>();
  const driver = createTranscriptSync({
    seed: seedTranscript(transcript(0)),
    ...edges,
  });
  edges.connectionState({ status: 'open', generation: 1, terminal: null });
  edges.advance(30000);
  const before = edges.reads();
  edges.emit({
    v: ENVELOPE_VERSION,
    type: 'event',
    topic: buildDebateTopic(round.id),
    position: '1:1',
    payload: {
      kind: 'debate.transcript-changed',
      entityVersion: 1,
      ids: [round.id],
    },
  });
  edges.answer({
    kind: 'found',
    value: { ...transcript(1), freeze: { completeness: 'incomplete' } },
  });
  await edges.flush();
  assert({
    given:
      'an open socket, unchanged Round version and a new frozen transcript',
    should:
      'use the doorbell, with no primary poll, and adopt the transcript revision',
    actual: [
      before,
      edges.reads(),
      driver.readSnapshot().value.revision,
      driver.readSnapshot().value.freeze,
    ],
    expected: [0, 1, 1, { completeness: 'incomplete' }],
  });
  driver.dispose();
});
test('a no-socket client has a slow single-flight fallback and a refusal removes access', async () => {
  const edges = driverEdges<ResourceRead<RoundTranscriptRead>>();
  const driver = createTranscriptSync({
    seed: seedTranscript(transcript(1)),
    ...edges,
    connection: null,
  });
  edges.advance(29999);
  const before = edges.reads();
  edges.advance(1);
  edges.advance(30000);
  const during = edges.reads();
  edges.answer({ kind: 'missing' });
  await edges.flush();
  assert({
    given: 'a no-socket client whose account is refused on its fallback read',
    should: 'read slowly without overlap and mark the transcript inaccessible',
    actual: [before, during, driver.readSnapshot().freshness],
    expected: [0, 1, 'gone'],
  });
  driver.dispose();
});

test('the first subscription acknowledgment closes the server-seed gap', async () => {
  const edges = driverEdges<ResourceRead<RoundTranscriptRead>>();
  const driver = createTranscriptSync({
    seed: seedTranscript(transcript(0)),
    ...edges,
  });
  edges.connectionState({ status: 'open', generation: 1, terminal: null });
  edges.emit({
    v: ENVELOPE_VERSION,
    type: 'subscribed',
    topic: buildDebateTopic(round.id),
    position: '1:99',
  });
  edges.answer({
    kind: 'found',
    value: { ...transcript(4), freeze: { completeness: 'complete' } },
  });
  await edges.flush();
  assert({
    given:
      'final capture committed after the server read but before the first subscribed cursor',
    should:
      'catch up once after acknowledgment without needing another doorbell',
    actual: [edges.reads(), driver.readSnapshot().value.revision],
    expected: [1, 4],
  });
  driver.dispose();
});
