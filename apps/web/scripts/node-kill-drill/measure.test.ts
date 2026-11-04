import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  captureBackAfter,
  isDirectUdp,
  nodeCarrying,
  seatIsHealthy,
  captureCoverage,
  incidentRate,
  isNodeUp,
  percentile,
  seatRecovery,
  owedBy,
} from './measure';

setupRitewayBun();

test('percentile', () => {
  assert({
    given: 'twelve samples',
    should: 'read the nearest rank, which at this size is the slowest',
    actual: percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 95),
    expected: 12,
  });
  assert({
    given: 'an unrecovered sample among the rest',
    should: 'read as unrecovered, not skip it',
    actual: percentile([1, 2, null], 95),
    expected: null,
  });
  assert({
    given: 'twenty samples with one unrecovered',
    should: 'let the rank decide, so the 95th is the 19th',
    actual: percentile(
      [...Array.from({ length: 19 }, (_, i) => i + 1), null],
      95,
    ),
    expected: 19,
  });
  assert({
    given: 'no samples',
    should: 'read as no measurement',
    actual: percentile([], 95),
    expected: null,
  });
});

test('seatRecovery', () => {
  const at = (...ready: readonly boolean[]) =>
    ready.map((value, index) => ({ atMs: 1000 + index * 1000, ready: value }));
  assert({
    given: 'a seat that goes dark and holds healthy for two reads',
    should: 'time it from the kill to the first of those reads',
    actual: seatRecovery(at(true, false, false, true, true), 1000),
    expected: { lostMs: 1000, backMs: 3000, relapses: 0 },
  });
  assert({
    given: 'a single healthy read that falls away again',
    should: 'not call that back, and count the relapse',
    actual: seatRecovery(at(false, true, false, true, true), 1000),
    expected: { lostMs: 0, backMs: 3000, relapses: 1 },
  });
  assert({
    given: 'a seat healthy again and dark again after holding',
    should: 'keep its first recovery and count the relapse',
    actual: seatRecovery(at(false, true, true, false, true, true), 1000),
    expected: { lostMs: 0, backMs: 1000, relapses: 1 },
  });
  assert({
    given: 'a seat that never returned',
    should: 'report no recovery',
    actual: seatRecovery(at(false, false), 1000),
    expected: { lostMs: 0, backMs: null, relapses: 0 },
  });
  assert({
    given: 'an unhealthy read just before the kill',
    should: 'not count it as the kill costing anything',
    actual: seatRecovery(at(false, true, true, false, true, true), 2000),
    expected: { lostMs: 2000, backMs: 3000, relapses: 0 },
  });
  assert({
    given: 'a seat whose media never faltered',
    should: 'report no loss and no recovery to time',
    actual: seatRecovery(at(true, true), 1000),
    expected: { lostMs: null, backMs: null, relapses: 0 },
  });
});

test('owedBy', () => {
  assert({
    given: 'an open grant on a speech that ended early',
    should: 'owe capture only until the speech ended',
    actual: owedBy(
      [{ start: 100, end: null }],
      { startMs: 0, endMs: 500, durationMs: 1000 },
      9999,
    ),
    expected: [{ start: 100, end: 500 }],
  });
  assert({
    given: 'a grant reaching past the scheduled end of a speech still open',
    should: 'stop at its scheduled end',
    actual: owedBy(
      [{ start: 0, end: 5000 }],
      { startMs: 0, endMs: null, durationMs: 1000 },
      9999,
    ),
    expected: [{ start: 0, end: 1000 }],
  });
  assert({
    given: 'an open grant on a speech running now',
    should: 'owe capture until now',
    actual: owedBy(
      [{ start: 0, end: null }],
      { startMs: 0, endMs: null, durationMs: 1000 },
      400,
    ),
    expected: [{ start: 0, end: 400 }],
  });
});

test('captureCoverage', () => {
  const owed = [{ start: 0, end: 100_000 }];
  assert({
    given: 'overlapping observations and a 20 s hole around the kill',
    should: 'count overlap once and report the number',
    actual: captureCoverage(
      owed,
      [
        { start: 0, end: 30_000 },
        { start: 20_000, end: 40_000 },
        { start: 60_000, end: 100_000 },
      ],
      { start: 40_000, end: 60_000 },
    ),
    expected: {
      owedMs: 100_000,
      observedMs: 80_000,
      missingMs: 20_000,
      coverage: 0.8,
      missingOutsideOutageMs: 0,
      coverageOutsideOutage: 1,
      holes: [{ start: 40_000, end: 60_000 }],
    },
  });
  assert({
    given: 'observations beyond what was owed',
    should: 'not count them',
    actual: captureCoverage(
      [{ start: 0, end: 10_000 }],
      [{ start: -5000, end: 20_000 }],
      null,
    ).coverage,
    expected: 1,
  });
  assert({
    given: 'a hole outside the outage',
    should: 'report it against the 100 percent target',
    actual: captureCoverage(owed, [{ start: 0, end: 90_000 }], {
      start: 40_000,
      end: 40_000,
    }).missingOutsideOutageMs,
    expected: 10_000,
  });
  assert({
    given: 'nothing owed',
    should: 'report no number rather than a perfect one',
    actual: captureCoverage([], [], null).coverage,
    expected: null,
  });
});

test('captureBackAfter', () => {
  assert({
    given: 'windows running on past the kill, then a hole',
    should: 'time the end of the hole, not the first window after the kill',
    actual: captureBackAfter(
      [
        { start: 0, end: 1000 },
        { start: 1000, end: 2000 },
        { start: 2000, end: 3000 },
        { start: 9000, end: 10_000 },
      ],
      1500,
    ),
    expected: 7500,
  });
  assert({
    given: 'a hole that ended before the kill',
    should: 'not count it',
    actual: captureBackAfter(
      [
        { start: 0, end: 1000 },
        { start: 5000, end: 9000 },
      ],
      6000,
    ),
    expected: 0,
  });
  assert({
    given: 'nothing observed after the kill',
    should: 'report no recovery',
    actual: captureBackAfter([{ start: 500, end: 1500 }], 2000),
    expected: null,
  });
  assert({
    given: 'windows out of order',
    should: 'read them in time order',
    actual: captureBackAfter(
      [
        { start: 9000, end: 10_000 },
        { start: 0, end: 3000 },
      ],
      1000,
    ),
    expected: 8000,
  });
});

test('incidentRate', () => {
  assert({
    given: 'two incidents over half a Round-hour',
    should: 'report per 1,000 Round-hours',
    actual: incidentRate(2, 1_800_000),
    expected: 4000,
  });
  assert({
    given: 'no incident table to read',
    should: 'report no rate rather than zero',
    actual: incidentRate(null, 1_800_000),
    expected: null,
  });
  assert({
    given: 'no Round time',
    should: 'report no rate',
    actual: incidentRate(0, 0),
    expected: null,
  });
});

test('isNodeUp', () => {
  assert({
    given: 'Fly machine JSON in started state',
    should: 'read up',
    actual: isNodeUp(
      '[\n {\n "id": "x",\n "state": "started",\n "checks": [] } ]',
    ),
    expected: true,
  });
  assert({
    given: 'Fly machine JSON in stopped state',
    should: 'read down',
    actual: isNodeUp('[ { "state": "stopped" } ]'),
    expected: false,
  });
  assert({
    given: 'docker inspect output for a running container',
    should: 'read up',
    actual: isNodeUp('running\n'),
    expected: true,
  });
  assert({
    given: 'docker inspect output for an exited container',
    should: 'read down',
    actual: isNodeUp('exited\n'),
    expected: false,
  });
});

test('seatIsHealthy', () => {
  const read = {
    connected: true,
    peerCamera: true,
    peerAudio: true,
    inboundVideoBytes: 100,
    inboundAudioBytes: 100,
  };
  const later = { ...read, inboundVideoBytes: 200, inboundAudioBytes: 200 };
  assert({
    given: 'a connected seat whose bytes rise',
    should: 'read healthy',
    actual: seatIsHealthy(read, later, true),
    expected: true,
  });
  assert({
    given: 'a frozen last frame with no new video bytes',
    should: 'read unhealthy though the element still has a picture',
    actual: seatIsHealthy(read, { ...later, inboundVideoBytes: 100 }, true),
    expected: false,
  });
  assert({
    given: 'no new audio bytes while a peer holds the microphone',
    should: 'read unhealthy',
    actual: seatIsHealthy(read, { ...later, inboundAudioBytes: 100 }, true),
    expected: false,
  });
  assert({
    given: 'no new audio bytes when no peer holds the microphone',
    should: 'read healthy: no audio is owed',
    actual: seatIsHealthy(
      read,
      { ...later, inboundAudioBytes: 100, peerAudio: false },
      false,
    ),
    expected: true,
  });
  assert({
    given: 'the first read of a seat',
    should: 'not call it healthy: nothing yet shows bytes rising',
    actual: seatIsHealthy(null, later, true),
    expected: false,
  });
  assert({
    given: 'a seat whose bar no longer reads Connected',
    should: 'read unhealthy',
    actual: seatIsHealthy(read, { ...later, connected: false }, true),
    expected: false,
  });
});

test('nodeCarrying', () => {
  const nodes = [
    { app: 'a', media: '66.51.125.26' },
    { app: 'b', media: '213.188.223.58' },
  ];
  const on = (address: string, port = 7882) => ({
    protocol: 'udp',
    address,
    port,
    candidateType: 'host',
  });
  assert({
    given: 'a selected pair at the second node',
    should: 'name the second node',
    actual: nodeCarrying(nodes, [on('213.188.223.58')])?.app,
    expected: 'b',
  });
  assert({
    given: 'an address no node advertises',
    should: 'name none, so nothing is killed on a guess',
    actual: nodeCarrying(nodes, [on('10.0.0.1')]),
    expected: null,
  });
  assert({
    given: 'pairs at both nodes',
    should: 'name none',
    actual: nodeCarrying(nodes, [on('66.51.125.26'), on('213.188.223.58')]),
    expected: null,
  });
  assert({
    given: 'local nodes that share an address and differ by port',
    should: 'tell them apart by port',
    actual: nodeCarrying(
      [
        { app: 'a', media: '127.0.0.1:18882' },
        { app: 'b', media: '127.0.0.1:18892' },
      ],
      [on('127.0.0.1', 18892)],
    )?.app,
    expected: 'b',
  });
  assert({
    given: 'one node and no reading',
    should: 'name that node',
    actual: nodeCarrying([nodes[0]!], [])?.app,
    expected: 'a',
  });
});

test('isDirectUdp', () => {
  const pair = {
    protocol: 'udp',
    address: 'x',
    port: 1,
    candidateType: 'host',
  };
  assert({
    given: 'selected pairs over UDP',
    should: 'read direct UDP',
    actual: isDirectUdp([pair]),
    expected: true,
  });
  assert({
    given: 'one pair over TCP',
    should: 'not read direct UDP',
    actual: isDirectUdp([pair, { ...pair, protocol: 'tcp' }]),
    expected: false,
  });
  assert({
    given: 'a relay',
    should: 'not read direct UDP',
    actual: isDirectUdp([{ ...pair, candidateType: 'relay' }]),
    expected: false,
  });
  assert({
    given: 'no pair',
    should: 'not read direct UDP',
    actual: isDirectUdp([]),
    expected: false,
  });
});
