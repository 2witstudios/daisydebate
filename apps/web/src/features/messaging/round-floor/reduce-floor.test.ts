import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { OpenFloor } from './floor-state';
import {
  channelId,
  expiresAt,
  floorDriver,
  laterExpiry,
  message,
  pageRead,
} from './floor-states.test-support';

setupRitewayBun();

const author = (letter: string) => ({
  actorId: letter.repeat(24),
  label: `Member ${letter}`,
});
const openFloor = (floor: ReturnType<typeof floorDriver>) =>
  floor.state().standing as OpenFloor;
/** Asks for a read and hands back the request it was given. */
const refresh = (floor: ReturnType<typeof floorDriver>) => {
  floor.send({ type: 'refresh-requested' });
  return floor.requestOf('read-latest');
};
const older = (floor: ReturnType<typeof floorDriver>, before = 5) => {
  floor.send({ type: 'older-requested', before });
  return floor.requestOf('read-older');
};

test('an older page never says what the floor is now', () => {
  const floor = floorDriver();
  floor.read(pageRead({ authors: [author('a')], readSequence: 2 }));
  const request = older(floor);
  floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead({ metadata: { readOnly: true }, authors: [author('a')] }),
  });
  floor.send({
    type: 'older-read',
    request,
    page: pageRead({
      metadata: { readOnly: false, expiresAt: laterExpiry },
      messages: [message(4), message(3)],
      before: 3,
      authors: [author('b')],
      readSequence: 6,
    }),
  });
  const { metadata, thread, readSequence } = openFloor(floor);
  assert({
    given:
      'an older page read while the floor was open, answering after a refresh that found it closed',
    should:
      'add its messages and authors, move the read marker on, and leave the floor as the refresh said',
    actual: {
      readOnly: metadata.readOnly,
      expiresAt: metadata.expiresAt,
      older: thread?.older,
      authors: thread?.authors,
      paging: thread?.paging,
      readSequence,
    },
    expected: {
      readOnly: true,
      expiresAt,
      older: {
        changeVersion: 0,
        messages: [message(4), message(3)],
        before: 3,
      },
      authors: [author('a'), author('b')],
      paging: null,
      readSequence: 6,
    },
  });
});

test('a read applies unless a later one of its kind already has', () => {
  const floor = floorDriver();
  floor.read();
  const first = refresh(floor);
  const second = refresh(floor);
  const third = refresh(floor);
  floor.send({
    type: 'latest-read',
    request: second,
    page: pageRead({ metadata: { readOnly: true } }),
  });
  const afterSecond = openFloor(floor);
  const late = floor.send({
    type: 'latest-read',
    request: first,
    page: pageRead(),
  });
  floor.send({
    type: 'latest-read',
    request: third,
    page: pageRead({ messageUnits: 2000 }),
  });
  assert({
    given:
      'three reads on their way: the second answers, then the first, then the third',
    should:
      'apply the second though the third is in flight, change nothing for the first, and apply the third',
    actual: {
      second: afterSecond.metadata.readOnly,
      firstRejected:
        late.state.standing === afterSecond && late.effects.length === 0,
      third: openFloor(floor).thread?.bounds.messageUnits,
    },
    expected: { second: true, firstRejected: true, third: 2000 },
  });
});

test('a failed read never supersedes one still on its way', () => {
  const floor = floorDriver();
  floor.read();
  const first = refresh(floor);
  const second = refresh(floor);
  floor.send({
    type: 'read-refused',
    request: second,
    read: 'latest',
    denied: false,
  });
  const failed = openFloor(floor).notice;
  floor.send({
    type: 'latest-read',
    request: first,
    page: pageRead({ metadata: { readOnly: true } }),
  });
  assert({
    given: 'a later read that fails, then the earlier one answering well',
    should: 'say the read failed, then apply the page and take that back',
    actual: {
      failed,
      notice: openFloor(floor).notice,
      readOnly: openFloor(floor).metadata.readOnly,
    },
    expected: { failed: 'read-failed', notice: null, readOnly: true },
  });
});

test('a denied floor stays denied', () => {
  const floor = floorDriver();
  floor.read(pageRead({ messageUnits: 2000 }));
  const earlier = refresh(floor);
  const page = older(floor);
  floor.send({
    type: 'read-refused',
    request: refresh(floor),
    read: 'latest',
    denied: true,
  });
  const denied = floor.state();
  const steps = [
    floor.send({ type: 'latest-read', request: earlier, page: pageRead() }),
    floor.send({ type: 'older-read', request: page, page: pageRead() }),
    floor.send({ type: 'refresh-requested' }),
    floor.send({ type: 'older-requested', before: 5 }),
    floor.send({ type: 'messages-shown', sequence: 9 }),
  ];
  assert({
    given:
      'a floor refused to a read, then earlier reads answering and new ones asked',
    should:
      'stay denied, keeping only what holds the open drafts, and ask nothing',
    actual: {
      standing: denied.standing,
      unmoved: steps.every(
        (step) => step.state === denied && step.effects.length === 0,
      ),
    },
    expected: {
      standing: { kind: 'denied', kept: { channelId, messageUnits: 2000 } },
      unmoved: true,
    },
  });
});

test('hiding the floor drops older pages and every read on its way', () => {
  const floor = floorDriver();
  const latestPage = pageRead({ messages: [message(9)], before: 9 });
  floor.read(latestPage);
  floor.send({
    type: 'older-read',
    request: older(floor, 9),
    page: pageRead({ messages: [message(8)], before: 8 }),
  });
  const latest = refresh(floor);
  const page = older(floor, 8);
  floor.send({ type: 'messages-shown', sequence: 9 });
  const mark = floor.requestOf('mark-read');
  floor.send({ type: 'floor-hidden' });
  const hidden = floor.state();
  const stale = [
    floor.send({ type: 'latest-read', request: latest, page: pageRead() }),
    floor.send({ type: 'older-read', request: page, page: pageRead() }),
    floor.send({ type: 'read-marked', request: mark, sequence: 9 }),
    floor.send({ type: 'floor-hidden' }),
  ];
  floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead({ metadata: { readOnly: true } }),
  });
  assert({
    given:
      'a floor hidden with older pages shown and a refresh, an older page and a read marker on their way',
    should:
      'keep the latest page, drop the older ones, change nothing for those answers, and apply a read asked afterwards',
    actual: {
      thread: (hidden.standing as OpenFloor).thread,
      marking: (hidden.standing as OpenFloor).marking,
      staleRejected: stale.every(
        (step) => step.state === hidden && step.effects.length === 0,
      ),
      afterwards: openFloor(floor).metadata.readOnly,
    },
    expected: {
      thread: {
        history: latestPage.history,
        authors: latestPage.authors,
        bounds: latestPage.bounds,
        older: null,
        paging: null,
      },
      marking: null,
      staleRejected: true,
      afterwards: true,
    },
  });
});

test('only the older read that Older messages waits for ends its wait', () => {
  const floor = floorDriver();
  floor.read();
  const first = older(floor);
  floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead(),
  });
  const afterRefresh = openFloor(floor).thread?.paging;
  const second = older(floor, 3);
  floor.send({ type: 'older-read', request: first, page: pageRead() });
  const afterFirst = openFloor(floor).thread?.paging;
  floor.send({
    type: 'read-refused',
    request: second,
    read: 'older',
    denied: false,
  });
  assert({
    given:
      'an older page asked twice, with a refresh and then the first page answering before the second fails',
    should: 'wait through the refresh and the first page, and stop at its own',
    actual: {
      afterRefresh,
      afterFirst,
      afterSecond: openFloor(floor).thread?.paging,
      notice: openFloor(floor).notice,
    },
    expected: {
      afterRefresh: first,
      afterFirst: second,
      afterSecond: null,
      notice: 'read-failed',
    },
  });
});

test('a latest page read before a live change keeps the newer history', () => {
  const floor = floorDriver();
  floor.read(pageRead({ changeVersion: 3, messages: [message(3)] }));
  floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead({
      changeVersion: 2,
      messages: [message(2)],
      authors: [author('b')],
    }),
  });
  const behind = openFloor(floor).thread;
  floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead({ changeVersion: 3, messages: [message(4)] }),
  });
  assert({
    given: 'a page at an earlier change version, then one at the same version',
    should:
      'keep the newer history but take the earlier page’s authors, then take the page that is not behind',
    actual: {
      behind: [behind?.history.changeVersion, behind?.authors],
      level: openFloor(floor).thread?.history.messages,
    },
    expected: { behind: [3, [author('b')]], level: [message(4)] },
  });
});

test('older pages belong to the change version they were read at', () => {
  const floor = floorDriver();
  floor.read();
  const read = (changeVersion: number, sequence: number) =>
    floor.send({
      type: 'older-read',
      request: older(floor, sequence + 1),
      page: pageRead({
        changeVersion,
        messages: [message(sequence)],
        before: sequence,
      }),
    });
  read(1, 5);
  read(1, 4);
  const same = openFloor(floor).thread?.older;
  read(2, 3);
  assert({
    given: 'two older pages at one change version, then one at the next',
    should: 'join the first two, and start again from the third',
    actual: { same, moved: openFloor(floor).thread?.older },
    expected: {
      same: {
        changeVersion: 1,
        messages: [message(5), message(4)],
        before: 4,
      },
      moved: { changeVersion: 2, messages: [message(3)], before: 3 },
    },
  });
});

test('the read marker only moves forward, and only as far as was asked', () => {
  const floor = floorDriver();
  floor.read(pageRead({ readSequence: 4 }));
  floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead({ readSequence: 2 }),
  });
  const afterEarlierPage = openFloor(floor).readSequence;
  const mark = (sequence: number, answer: number) => {
    floor.send({ type: 'messages-shown', sequence });
    floor.send({
      type: 'read-marked',
      request: floor.requestOf('mark-read'),
      sequence: answer,
    });
    return openFloor(floor).readSequence;
  };
  const repeated = floor.send({ type: 'messages-shown', sequence: 4 });
  floor.send({ type: 'messages-shown', sequence: 8 });
  const failed = floor.requestOf('mark-read');
  floor.send({ type: 'read-mark-failed', request: failed });
  assert({
    given:
      'a page with an earlier marker, messages already read shown again, a marker that failed, one answered beyond what was asked, one answered short, and one answered in full',
    should:
      'never move back, ask nothing for read messages, claim nothing on failure, and not believe a marker past what was shown',
    actual: {
      afterEarlierPage,
      repeatedAsked: repeated.effects,
      afterFailure: [openFloor(floor).readSequence, openFloor(floor).marking],
      beyond: mark(8, 9),
      short: mark(8, 6),
      full: mark(8, 8),
    },
    expected: {
      afterEarlierPage: 4,
      repeatedAsked: [],
      afterFailure: [4, null],
      beyond: 4,
      short: 6,
      full: 8,
    },
  });
});

test('a newer sighting replaces the read marker on its way', () => {
  const floor = floorDriver();
  floor.read();
  floor.send({ type: 'messages-shown', sequence: 5 });
  const first = floor.requestOf('mark-read');
  const again = floor.send({ type: 'messages-shown', sequence: 5 });
  floor.send({ type: 'messages-shown', sequence: 7 });
  const replaced = floor.state();
  const late = floor.send({ type: 'read-marked', request: first, sequence: 5 });
  assert({
    given:
      'the same messages shown twice, then newer ones, then the first marker answering',
    should:
      'ask once for the same sequence, and change nothing for the marker that was replaced',
    actual: {
      askedAgain: again.effects,
      marking: (replaced.standing as OpenFloor).marking?.sequence,
      lateRejected: late.state === replaced,
    },
    expected: { askedAgain: [], marking: 7, lateRejected: true },
  });
});

test('expiry is told by the timer set for it', () => {
  const floor = floorDriver();
  floor.read();
  const other = floor.send({ type: 'expiry-reached', expiresAt: laterExpiry });
  floor.send({ type: 'expiry-reached', expiresAt });
  const expired = floor.state();
  const again = floor.send({ type: 'expiry-reached', expiresAt });
  const same = floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead(),
  });
  const extended = floor.send({
    type: 'latest-read',
    request: refresh(floor),
    page: pageRead({ metadata: { expiresAt: laterExpiry } }),
  });
  assert({
    given:
      'a timer for another expiry, the floor’s own, a page with the same expiry, then a page with a later one',
    should:
      'ignore the other timer, expire once, stay expired, then reopen and watch the later expiry',
    actual: {
      otherAsked: other.effects.length,
      expired: (expired.standing as OpenFloor).expired,
      againRejected: again.state === expired && again.effects.length === 0,
      stillExpired: (same.state.standing as OpenFloor).expired,
      sameAsked: same.effects,
      extended: (extended.state.standing as OpenFloor).expired,
      extendedAsked: extended.effects,
    },
    expected: {
      otherAsked: 0,
      expired: true,
      againRejected: true,
      stillExpired: true,
      sameAsked: [],
      extended: false,
      extendedAsked: [{ type: 'watch-expiry', expiresAt: laterExpiry }],
    },
  });
});

test('entering again starts the floor afresh and keeps the open drafts', () => {
  const floor = floorDriver();
  floor.read(pageRead({ messageUnits: 2000, readSequence: 3 }));
  const before = refresh(floor);
  floor.send({ type: 'enter-requested', mayOpen: true });
  const loading = floor.state();
  const second = floor.send({ type: 'enter-requested', mayOpen: true });
  const during = floor.send({
    type: 'latest-read',
    request: before,
    page: pageRead(),
  });
  floor.send({
    type: 'discovered',
    request: floor.requestOf('discover'),
    channel: pageRead().metadata,
  });
  const reopened = floor.state();
  const after = floor.send({
    type: 'latest-read',
    request: before,
    page: pageRead({ metadata: { readOnly: true } }),
  });
  assert({
    given:
      'an open floor entered again with a read on its way, which answers during the entry and again after it',
    should:
      'keep the drafts’ channel while away, enter once, and let no read from before answer into the new floor',
    actual: {
      loading: loading.standing,
      secondRejected: second.state === loading && second.effects.length === 0,
      duringRejected: during.state === loading,
      reopened: (reopened.standing as OpenFloor).thread,
      afterRejected: after.state === reopened,
      requests: floor
        .effects()
        .flatMap((effect) => ('request' in effect ? [effect.request] : [])),
    },
    expected: {
      loading: {
        kind: 'loading',
        request: 4,
        step: 'discovering',
        mayOpen: true,
        kept: { channelId, messageUnits: 2000 },
      },
      secondRejected: true,
      duringRejected: true,
      reopened: null,
      afterRejected: true,
      requests: [1, 2, 3, 4, 5],
    },
  });
});

test('a reader who may not open a floor finds it empty', () => {
  const floor = floorDriver();
  floor.send({ type: 'enter-requested', mayOpen: false });
  const empty = floor.send({
    type: 'discovered',
    request: floor.requestOf('discover'),
    channel: null,
  });
  const opener = floorDriver();
  opener.send({ type: 'enter-requested', mayOpen: true });
  const request = opener.requestOf('discover');
  const opening = opener.send({ type: 'discovered', request, channel: null });
  const early = floorDriver();
  early.send({ type: 'enter-requested', mayOpen: true });
  const unasked = early.send({
    type: 'opened',
    request: early.requestOf('discover'),
    metadata: pageRead().metadata,
  });
  assert({
    given:
      'no channel found by a reader who may not open one, by one who may, and an opening nobody asked for',
    should:
      'be empty for the first, ask to open under the same request for the second, and reject the third',
    actual: {
      empty: empty.state.standing,
      opening: opening.effects,
      unasked: unasked.effects.length === 0 && unasked.state === early.state(),
    },
    expected: {
      empty: { kind: 'empty', kept: null },
      opening: [{ type: 'open', request }],
      unasked: true,
    },
  });
});

test('a page for another channel is not this floor’s', () => {
  const floor = floorDriver();
  floor.open();
  const state = floor.state();
  const other = 'f'.repeat(24);
  const page = pageRead({ metadata: { channelId: other } });
  const step = floor.send({
    type: 'latest-read',
    request: floor.requestOf('read-latest'),
    page: { ...page, history: { ...page.history, channelId: other } },
  });
  assert({
    given: 'an awaited read answered with another channel’s page',
    should: 'change nothing',
    actual: step.state === state && step.effects.length === 0,
    expected: true,
  });
});
