import { assert, setupRitewayBun, test } from 'riteway/bun';
import { armedOf, driver } from './media-driver.test-support';
import { connectionOf, stageOf, statusOf } from './media-status';
import { answerWith, testPolicy } from './media-state.test-support';
import { seatMicrophoneCaption } from './seat-caption';

setupRitewayBun();

test('a drop mid-mute cannot lock the mute control on the next connection', () => {
  const d = driver();
  d.join(['microphone']);
  d.send({ type: 'mute-requested', muted: true });
  d.room({ type: 'dropped' });
  d.timer('recovery');
  d.send({
    type: 'admission-answered',
    connection: (d.state().link as { connection: number }).connection,
    admission: {
      roundId: 'r',
      identity: 'seat',
      url: 'wss://x',
      token: 't',
    } as never,
  });
  d.room({ type: 'connected', permission: null });
  d.answer(['microphone']);
  d.room({ type: 'captured', source: 'microphone' });
  d.room({ type: 'published', source: 'microphone' });
  d.effects.length = 0;
  d.send({ type: 'mute-requested', muted: true });
  assert({
    given: 'a mute in flight when the connection drops, then a new connection',
    should: 'carry out the next mute on the new connection',
    actual: [d.live().changingMicrophone, d.count('set-mute')],
    expected: [true, 1],
  });
});

test('a mute failing while the microphone is publishing leaves its publish alone', () => {
  const d = driver();
  d.join(['microphone']);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.send({ type: 'mute-requested', muted: true });
  d.room({ type: 'permission-changed', permission: [] });
  d.room({ type: 'mute-failed', kind: 'failure' });
  const phase = d.live().sources.microphone.phase;
  assert({
    given: 'a mute failure arriving while the microphone is being taken down',
    should: 'finish the mute and leave the phase as it is',
    actual: [phase, d.live().changingMicrophone],
    expected: ['unpublishing', false],
  });
});

const removalFailing = (start: 'track-ended' | 'mute-failed') => {
  const d = driver();
  d.join(['microphone']);
  if (start === 'track-ended')
    d.room({ type: 'track-ended', source: 'microphone' });
  else {
    d.send({ type: 'mute-requested', muted: true });
    d.room({ type: 'mute-failed', kind: 'failure' });
  }
  const during = d.live().sources.microphone.phase;
  d.room({ type: 'unpublish-failed', source: 'microphone' });
  return [during, d.live().sources.microphone.phase];
};

test('an unpublish the SDK refuses after a failure is still named (DEC-296)', () => {
  assert({
    given: 'an ended track, then the SDK refusing to remove its publication',
    should: 'name the stuck publication',
    actual: removalFailing('track-ended'),
    expected: ['failed', 'stale-publication'],
  });
  assert({
    given: 'a failed mute, then the SDK refusing to remove its publication',
    should: 'name the stuck publication',
    actual: removalFailing('mute-failed'),
    expected: ['failed', 'stale-publication'],
  });
});

test('a removal that hangs after a failure is rebuilt by Retry past the budget', () => {
  const retried = (afterMs: number) => {
    const d = driver();
    d.join(['camera']);
    d.room({ type: 'track-ended', source: 'camera' });
    d.effects.length = 0;
    d.advance(afterMs);
    d.send({ type: 'retry-pressed' });
    return [d.count('release-connection'), d.count('admit')];
  };
  assert({
    given: 'Retry soon after a failed track, and past the budget',
    should: 'keep the connection, then rebuild it',
    actual: [retried(1_000), retried(testPolicy.readBudgetMs)],
    expected: [
      [0, 0],
      [1, 1],
    ],
  });
});

test('choosing defaults reaches the capture, and stays for later connections', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera']);
  const asked = () =>
    d.effects.flatMap((effect) =>
      effect.type === 'capture' ? [effect.useDefaults] : [],
    );
  const first = asked();
  d.room({
    type: 'capture-failed',
    source: 'camera',
    kind: 'preference-unreadable',
    checked: false,
  });
  d.effects.length = 0;
  d.send({ type: 'retry-pressed' });
  const again = asked();
  const healthy = statusOf(d.state()).retry;
  assert({
    given: 'a saved choice nothing can read, then Retry',
    should: 'clear the choice once and capture with the browser default',
    actual: [
      first,
      again,
      d.count('clear-checked-devices'),
      d.state().devices,
      healthy,
    ],
    expected: [[false, false], [true], 1, 'defaults', false],
  });
});

test('a prompt opening during an apply has a patience, however it opened', () => {
  const d = driver();
  d.join(['camera']);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera', 'microphone']);
  const scheduled = d.scheduled('capture-patience').length;
  d.timer('capture-patience');
  assert({
    given: 'a new grant opening a prompt while an answer applies',
    should: 'limit how long that prompt holds the answer',
    actual: [scheduled, d.live().apply],
    expected: [1, null],
  });
});

test('patience ends once: a prompt past it does not start another', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera']);
  d.room({ type: 'captured', source: 'camera' });
  d.timer('capture-patience');
  assert({
    given: 'a warm prompt past patience while a publish still holds the answer',
    should: 'keep the answer held by the publish, with no second patience',
    actual: [d.scheduled('capture-patience').length, d.live().apply !== null],
    expected: [1, true],
  });
});

test('a read answering that the Round ended forgets the mute, as the view would', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.send({
    type: 'read-answered',
    ticket: d.ticket(),
    answer: { ...answerWith([]), state: 'ended' } as never,
  });
  d.send({ type: 'round-ended' });
  assert({
    given: 'a read that says ended before the view does',
    should: 'forget the mute choice once',
    actual: [d.state().link.phase, d.count('forget-mute')],
    expected: ['ended', 1],
  });
});

test('a capture landing after its source was named missing is let go', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera']);
  d.room({
    type: 'capture-failed',
    source: 'camera',
    kind: 'absence',
    checked: true,
  });
  d.send({ type: 'retry-pressed' });
  d.send({ type: 'forget-failed', sources: ['camera'] });
  d.effects.length = 0;
  d.room({ type: 'captured', source: 'camera' });
  assert({
    given: 'storage refusing a forget while a capture is already running',
    should: 'keep naming the source, and release the track that capture opens',
    actual: [d.live().sources.camera.phase, d.count('release-track')],
    expected: ['missing', 1],
  });
});

test('a wake firing behind a held apply stays owed, and a stuck one rebuilds', () => {
  const held = driver();
  held.join();
  held.send({ type: 'read-requested', read: { kind: 'wake' } });
  held.flushDeferred();
  held.answer(['camera']);
  held.room({ type: 'captured', source: 'camera' });
  held.room({ type: 'captured', source: 'microphone' });
  held.timer('read-budget');
  const stale = connectionOf(held.state());
  held.timer('recovery');
  const armed = armedOf(held.state());
  const paces = held.scheduled('recovery');
  held.advance(testPolicy.readBudgetMs);
  held.timer('recovery');
  assert({
    given:
      'a publish holding the answer, its wake firing, then firing past the budget',
    should: 'keep the wake owed at the next pace, then rebuild the connection',
    actual: [
      stale,
      armed,
      paces,
      held.state().link.phase,
      held.count('release-connection'),
    ],
    expected: ['out-of-date', 'wake', [1_000, 2_000], 'admitting', 1],
  });
});

test('every attempt that leaves a read waiting has a budget, whoever began it', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera']);
  assert({
    given: 'an answer from a wake, with no supersession, holding at SDK work',
    should: 'run a budget that ends in saying so',
    actual: d.scheduled('read-budget'),
    expected: [testPolicy.readBudgetMs],
  });
});

test('a seat cannot stay on checking while an apply never settles', () => {
  const d = driver();
  d.join();
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 4 },
  });
  d.flushDeferred();
  d.answer(['camera']);
  d.room({ type: 'captured', source: 'camera' });
  const stage = () => stageOf(d.state());
  const caption = () =>
    seatMicrophoneCaption({
      connection: stage().connection,
      confirmed: stage().microphoneConfirmed,
      track: undefined,
      mine: false,
      ownMuted: false,
      granted: true,
      remote: { microphonePublished: false },
    });
  const whileChecking = [caption(), stage().connection];
  d.timer('read-budget');
  assert({
    given: 'a newer view whose answer arrives but whose apply never settles',
    should: 'check first, then show out of date at the budget',
    actual: [whileChecking, caption(), stage().connection],
    expected: [
      ['Checking microphone…', 'live'],
      'Microphone status out of date',
      'out-of-date',
    ],
  });
});

test('a released connection shows no last-known microphone state', () => {
  const d = driver();
  d.join(['microphone']);
  const live = stageOf(d.state()).media === null;
  d.room({ type: 'dropped' });
  assert({
    given: 'the last server media state as the connection is released',
    should: 'keep it while the tracks are up, never after teardown',
    actual: [live, stageOf(d.state()).media, stageOf(d.state()).tracks],
    expected: [false, null, []],
  });
});

const stuckCamera = (publish: readonly ('camera' | 'microphone')[]) => {
  const d = driver();
  d.join(publish);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera', ...publish]);
  d.room({ type: 'captured', source: 'camera' });
  if (publish.length === 0)
    d.room({
      type: 'capture-failed',
      source: 'microphone',
      kind: 'permission',
      checked: false,
    });
  d.timer('read-budget');
  d.effects.length = 0;
  d.advance(testPolicy.readBudgetMs);
  d.timer('recovery');
  return d;
};

test('a stuck publish rebuilds by itself only when no source is healthy', () => {
  const healthy = stuckCamera(['microphone']);
  const unhealthy = stuckCamera([]);
  assert({
    given: 'a wake past the budget, with and without a live microphone',
    should: 'name the camera beside the microphone, and rebuild without one',
    actual: {
      healthy: [
        healthy.count('release-connection'),
        healthy.count('admit'),
        healthy.live().sources.camera,
        healthy.live().sources.microphone.phase,
        armedOf(healthy.state()),
        statusOf(healthy.state()).retry,
      ],
      unhealthy: [
        unhealthy.count('release-connection'),
        unhealthy.state().link.phase,
      ],
    },
    expected: {
      healthy: [
        0,
        0,
        { phase: 'publishing', sinceMs: 1_000_000, stuck: true },
        'published',
        'wake',
        true,
      ],
      unhealthy: [1, 'admitting'],
    },
  });
});

test('the source that stuck recovers without a click if its publish lands', () => {
  const d = stuckCamera(['microphone']);
  d.room({ type: 'published', source: 'camera' });
  assert({
    given: 'a publish named stuck that finally settles',
    should: 'stop naming it',
    actual: d.live().sources.camera,
    expected: { phase: 'published', swapped: false },
  });
});

test('a hung removal holding nothing cannot cost a member their reception', () => {
  const d = driver();
  d.join(['camera']);
  d.room({ type: 'captured', source: 'microphone' });
  d.room({ type: 'track-ended', source: 'camera' });
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 2 },
  });
  d.timer('read-budget');
  d.effects.length = 0;
  d.advance(testPolicy.readBudgetMs);
  d.timer('recovery');
  assert({
    given:
      'a failed camera whose removal hangs, nothing published, and a wake past the budget',
    should: 'read again on this connection rather than rebuild',
    actual: [
      d.count('release-connection'),
      d.count('admit'),
      d.count('start-read'),
      d.live().sources.camera.phase,
    ],
    expected: [0, 0, 1, 'failed'],
  });
});

test('a grant moving during a failed removal keeps that failure named', () => {
  const d = driver();
  d.join(['camera']);
  d.room({ type: 'track-ended', source: 'camera' });
  d.room({ type: 'permission-changed', permission: [] });
  assert({
    given: 'a grant going away while a failed source is still being removed',
    should: 'keep naming the failure until its removal settles',
    actual: d.live().sources.camera,
    expected: { phase: 'failed', kind: 'absence', removingSinceMs: 1_000_000 },
  });
});

test('reception counts as live when a wake weighs a rebuild', () => {
  const receiving = stuckCamera([]);
  const fresh = driver();
  fresh.join();
  fresh.room({
    type: 'observed',
    tracks: [
      {
        identity: 'peer',
        source: 'microphone',
        local: false,
        speaking: false,
        muted: false,
      },
    ],
    peers: [],
  });
  fresh.send({ type: 'read-requested', read: { kind: 'wake' } });
  fresh.flushDeferred();
  fresh.answer(['camera']);
  fresh.room({ type: 'captured', source: 'camera' });
  fresh.room({
    type: 'capture-failed',
    source: 'microphone',
    kind: 'permission',
    checked: false,
  });
  fresh.timer('read-budget');
  fresh.advance(testPolicy.readBudgetMs);
  fresh.timer('recovery');
  assert({
    given:
      'a stuck publish with nothing live, and the same with a peer audible',
    should: 'rebuild only the first',
    actual: [receiving.state().link.phase, fresh.state().link.phase],
    expected: ['admitting', 'live'],
  });
});

test('a wake whose answer then hangs leaves another wake owed', () => {
  const d = driver();
  d.join(['microphone']);
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 2 },
  });
  d.timer('read-budget');
  d.flushDeferred();
  d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'transient' });
  d.timer('read-retry');
  d.send({ type: 'read-aborted', ticket: d.ticket() });
  d.timer('recovery');
  const spent = armedOf(d.state());
  d.answer(['camera', 'microphone']);
  d.room({ type: 'captured', source: 'camera' });
  d.timer('read-budget');
  const owed = armedOf(d.state());
  d.advance(testPolicy.readBudgetMs);
  d.timer('recovery');
  assert({
    given:
      'a stale link, its wake answered, and that answer hanging in the SDK',
    should: 'owe another wake past the budget, then name the stuck camera',
    actual: [spent, owed, d.live().sources.camera],
    expected: [
      null,
      'wake',
      { phase: 'publishing', sinceMs: 1_000_000, stuck: true },
    ],
  });
});
