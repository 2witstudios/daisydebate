import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ENVELOPE_VERSION,
  buildRoundTopic,
  type LiveTranscriptRead,
} from '@daisy/protocol';
import { driverEdges } from '../resource-sync/driver.test-support';
import type { ResourceRead } from '../resource-sync/driver';
import { round } from './round.test-support';
import {
  createTranscriptHolder,
  createTranscriptSync,
  seedTranscript,
} from './transcript-sync';
setupRitewayBun();
const transcript = (revision: number): LiveTranscriptRead => ({
  contractVersion: 1,
  round,
  revision,
  freeze: null,
  streams: [],
  utterances: [],
});
const connectedTranscript = () => {
  const edges = driverEdges<ResourceRead<LiveTranscriptRead>>();
  const driver = createTranscriptSync({
    seed: seedTranscript(transcript(0)),
    ...edges,
  });
  edges.connectionState({ status: 'open', generation: 1 });
  return { edges, driver };
};
test('capture invalidation refreshes independently of competitive Round version', async () => {
  const { edges, driver } = connectedTranscript();
  edges.advance(30000);
  const before = edges.reads();
  edges.emit({
    v: ENVELOPE_VERSION,
    type: 'event',
    topic: buildRoundTopic(round.id),
    position: '1:1',
    payload: {
      kind: 'round.transcript-changed',
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
  const edges = driverEdges<ResourceRead<LiveTranscriptRead>>();
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
  const { edges, driver } = connectedTranscript();
  edges.emit({
    v: ENVELOPE_VERSION,
    type: 'subscribed',
    id: 'transcript-subscribe',
    topic: buildRoundTopic(round.id),
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

test('an older seed offered after newer text never regresses the transcript', () => {
  const { driver } = connectedTranscript();
  driver.accepted(transcript(9));
  driver.accepted(transcript(4));
  assert({
    given: 'revision 9 held and a server render carrying revision 4',
    should: 'keep revision 9',
    actual: driver.readSnapshot().value.revision,
    expected: 9,
  });
  driver.dispose();
});

test('transient unavailability keeps committed text and real refusal clears it', async () => {
  const { edges, driver } = connectedTranscript();
  driver.accepted(transcript(5));
  driver.signal();
  edges.answer({ kind: 'unavailable' });
  await edges.flush();
  const during = driver.readSnapshot();
  edges.advance(30000);
  edges.answer({ kind: 'found', value: transcript(6) });
  await edges.flush();
  const after = driver.readSnapshot();
  driver.signal();
  edges.answer({ kind: 'missing' });
  await edges.flush();
  assert({
    given: 'an outage, recovery, then a refused read',
    should: 'hold the text as stale, return to current, then go gone',
    actual: [
      during.freshness,
      during.value.revision,
      after.freshness,
      after.value.revision,
      driver.readSnapshot().freshness,
    ],
    expected: ['stale', 5, 'current', 6, 'gone'],
  });
  driver.dispose();
});

const holding = () => {
  const edges = driverEdges<ResourceRead<LiveTranscriptRead>>();
  const holder = createTranscriptHolder(transcript(5), edges.read);
  const { scheduler, visibility, connection } = edges;
  const driverOnly = { scheduler, visibility, connection };
  return { edges, holder, driverOnly };
};
test('a replaced driver starts from the newest text held, not the first seed', async () => {
  const { edges, holder, driverOnly } = holding();
  const first = holder.start(driverOnly);
  first.signal();
  edges.answer({ kind: 'found', value: transcript(9) });
  await edges.flush();
  first.dispose();
  const second = holder.start(driverOnly);
  holder.offer(transcript(4));
  assert({
    given: 'revision 9 read, the driver replaced, then a revision 4 render',
    should: 'keep revision 9 across both',
    actual: second.readSnapshot().value.revision,
    expected: 9,
  });
  second.dispose();
});

test('a render arriving after a refusal never shows protected text again', async () => {
  const { edges, holder, driverOnly } = holding();
  const first = holder.start(driverOnly);
  first.signal();
  edges.answer({ kind: 'missing' });
  await edges.flush();
  holder.offer(transcript(7));
  const during = first.readSnapshot();
  first.dispose();
  const second = holder.start(driverOnly);
  assert({
    given: 'a refused read, a later render, then a replaced driver',
    should: 'stay gone at every step',
    actual: [
      during.freshness,
      during.value.revision,
      second.readSnapshot().freshness,
    ],
    expected: ['gone', 5, 'gone'],
  });
  second.dispose();
});

test('a shape this build cannot read asks for a reload, and an outage does not', async () => {
  const { edges, holder, driverOnly } = holding();
  const driver = holder.start(driverOnly);
  const answering = async (answer: ResourceRead<LiveTranscriptRead>) => {
    driver.signal();
    edges.answer(answer);
    await edges.flush();
    return [driver.readSnapshot().freshness, holder.outdated()];
  };
  assert({
    given: 'an outage, a changed contract, then a good read',
    should: 'flag only the changed contract, keeping text throughout',
    actual: [
      await answering({ kind: 'unavailable' }),
      await answering({ kind: 'unavailable', outdated: true }),
      await answering({ kind: 'found', value: transcript(6) }),
    ],
    expected: [
      ['stale', false],
      ['stale', true],
      ['current', false],
    ],
  });
  driver.dispose();
});
