import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { OpenContextChat } from './chat-state';
import {
  channelId,
  expiresAt,
  contextChatDriver,
  laterExpiry,
  message,
  pageRead,
} from './chat-states.test-support';

setupRitewayBun();

const author = (letter: string) => ({
  actorId: letter.repeat(24),
  label: `Member ${letter}`,
});
const openContextChat = (chat: ReturnType<typeof contextChatDriver>) =>
  chat.state().standing as OpenContextChat;
/** Asks for a read and hands back the request it was given. */
const refresh = (chat: ReturnType<typeof contextChatDriver>) => {
  chat.send({ type: 'refresh-requested' });
  return chat.requestOf('read-latest');
};
const older = (chat: ReturnType<typeof contextChatDriver>, before = 5) => {
  chat.send({ type: 'older-requested', before });
  return chat.requestOf('read-older');
};

test('an older page never says what the chat is now', () => {
  const chat = contextChatDriver();
  chat.read(pageRead({ authors: [author('a')], readSequence: 2 }));
  const request = older(chat);
  chat.send({
    type: 'latest-read',
    request: refresh(chat),
    page: pageRead({ metadata: { readOnly: true }, authors: [author('a')] }),
  });
  chat.send({
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
  const { metadata, thread, readSequence } = openContextChat(chat);
  assert({
    given:
      'an older page read while the chat was open, answering after a refresh that found it closed',
    should:
      'add its messages and authors, move the read marker on, and leave the chat as the refresh said',
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
  const chat = contextChatDriver();
  chat.read();
  const first = refresh(chat);
  const second = refresh(chat);
  const third = refresh(chat);
  chat.send({
    type: 'latest-read',
    request: second,
    page: pageRead({ metadata: { readOnly: true } }),
  });
  const afterSecond = openContextChat(chat);
  const late = chat.send({
    type: 'latest-read',
    request: first,
    page: pageRead(),
  });
  chat.send({
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
      third: openContextChat(chat).thread?.bounds.messageUnits,
    },
    expected: { second: true, firstRejected: true, third: 2000 },
  });
});

test('a failed read never supersedes one still on its way', () => {
  const chat = contextChatDriver();
  chat.read();
  const first = refresh(chat);
  const second = refresh(chat);
  chat.send({
    type: 'read-refused',
    request: second,
    read: 'latest',
    denied: false,
  });
  const failed = openContextChat(chat).notice;
  chat.send({
    type: 'latest-read',
    request: first,
    page: pageRead({ metadata: { readOnly: true } }),
  });
  assert({
    given: 'a later read that fails, then the earlier one answering well',
    should: 'say the read failed, then apply the page and take that back',
    actual: {
      failed,
      notice: openContextChat(chat).notice,
      readOnly: openContextChat(chat).metadata.readOnly,
    },
    expected: { failed: 'read-failed', notice: null, readOnly: true },
  });
});

test('a denied chat stays denied', () => {
  const chat = contextChatDriver();
  chat.read(pageRead({ messageUnits: 2000 }));
  const earlier = refresh(chat);
  const page = older(chat);
  chat.send({
    type: 'read-refused',
    request: refresh(chat),
    read: 'latest',
    denied: true,
  });
  const denied = chat.state();
  const steps = [
    chat.send({ type: 'latest-read', request: earlier, page: pageRead() }),
    chat.send({ type: 'older-read', request: page, page: pageRead() }),
    chat.send({ type: 'refresh-requested' }),
    chat.send({ type: 'older-requested', before: 5 }),
    chat.send({ type: 'messages-shown', sequence: 9 }),
  ];
  assert({
    given:
      'a chat refused to a read, then earlier reads answering and new ones asked',
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

test('hiding the chat drops older pages and every read on its way', () => {
  const chat = contextChatDriver();
  const latestPage = pageRead({ messages: [message(9)], before: 9 });
  chat.read(latestPage);
  chat.send({
    type: 'older-read',
    request: older(chat, 9),
    page: pageRead({ messages: [message(8)], before: 8 }),
  });
  const latest = refresh(chat);
  const page = older(chat, 8);
  chat.send({ type: 'messages-shown', sequence: 9 });
  const mark = chat.requestOf('mark-read');
  chat.send({ type: 'chat-hidden' });
  const hidden = chat.state();
  const stale = [
    chat.send({ type: 'latest-read', request: latest, page: pageRead() }),
    chat.send({ type: 'older-read', request: page, page: pageRead() }),
    chat.send({ type: 'read-marked', request: mark, sequence: 9 }),
    chat.send({ type: 'chat-hidden' }),
  ];
  chat.send({ type: 'chat-shown' });
  chat.send({
    type: 'latest-read',
    request: chat.requestOf('read-latest'),
    page: pageRead({ metadata: { readOnly: true } }),
  });
  assert({
    given:
      'a chat hidden with older pages shown and a refresh, an older page and a read marker on their way',
    should:
      'keep the latest page, drop the older ones, change nothing for those answers, and apply the read asked once it is shown again',
    actual: {
      thread: (hidden.standing as OpenContextChat).thread,
      marking: (hidden.standing as OpenContextChat).marking,
      staleRejected: stale.every(
        (step) => step.state === hidden && step.effects.length === 0,
      ),
      afterwards: openContextChat(chat).metadata.readOnly,
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
  const chat = contextChatDriver();
  chat.read();
  const first = older(chat);
  chat.send({
    type: 'latest-read',
    request: refresh(chat),
    page: pageRead(),
  });
  const afterRefresh = openContextChat(chat).thread?.paging;
  const second = older(chat, 3);
  chat.send({ type: 'older-read', request: first, page: pageRead() });
  const afterFirst = openContextChat(chat).thread?.paging;
  chat.send({
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
      afterSecond: openContextChat(chat).thread?.paging,
      notice: openContextChat(chat).notice,
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
  const chat = contextChatDriver();
  chat.read(pageRead({ changeVersion: 3, messages: [message(3)] }));
  chat.send({
    type: 'latest-read',
    request: refresh(chat),
    page: pageRead({
      changeVersion: 2,
      messages: [message(2)],
      authors: [author('b')],
    }),
  });
  const behind = openContextChat(chat).thread;
  chat.send({
    type: 'latest-read',
    request: refresh(chat),
    page: pageRead({ changeVersion: 3, messages: [message(4)] }),
  });
  assert({
    given: 'a page at an earlier change version, then one at the same version',
    should:
      'keep the newer history but take the earlier page’s authors, then take the page that is not behind',
    actual: {
      behind: [behind?.history.changeVersion, behind?.authors],
      level: openContextChat(chat).thread?.history.messages,
    },
    expected: { behind: [3, [author('b')]], level: [message(4)] },
  });
});

test('older pages belong to the change version they were read at', () => {
  const chat = contextChatDriver();
  chat.read();
  const read = (changeVersion: number, sequence: number) =>
    chat.send({
      type: 'older-read',
      request: older(chat, sequence + 1),
      page: pageRead({
        changeVersion,
        messages: [message(sequence)],
        before: sequence,
      }),
    });
  read(1, 5);
  read(1, 4);
  const same = openContextChat(chat).thread?.older;
  read(2, 3);
  assert({
    given: 'two older pages at one change version, then one at the next',
    should: 'join the first two, and start again from the third',
    actual: { same, moved: openContextChat(chat).thread?.older },
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
  const chat = contextChatDriver();
  chat.read(pageRead({ readSequence: 4 }));
  chat.send({
    type: 'latest-read',
    request: refresh(chat),
    page: pageRead({ readSequence: 2 }),
  });
  const afterEarlierPage = openContextChat(chat).readSequence;
  const mark = (sequence: number, answer: number) => {
    chat.send({ type: 'messages-shown', sequence });
    chat.send({
      type: 'read-marked',
      request: chat.requestOf('mark-read'),
      sequence: answer,
    });
    return openContextChat(chat).readSequence;
  };
  const repeated = chat.send({ type: 'messages-shown', sequence: 4 });
  chat.send({ type: 'messages-shown', sequence: 8 });
  const failed = chat.requestOf('mark-read');
  chat.send({ type: 'read-mark-failed', request: failed });
  assert({
    given:
      'a page with an earlier marker, messages already read shown again, a marker that failed, one answered beyond what was asked, one answered short, and one answered in full',
    should:
      'never move back, ask nothing for read messages, claim nothing on failure, and not believe a marker past what was shown',
    actual: {
      afterEarlierPage,
      repeatedAsked: repeated.effects,
      afterFailure: [
        openContextChat(chat).readSequence,
        openContextChat(chat).marking,
      ],
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
  const chat = contextChatDriver();
  chat.read();
  chat.send({ type: 'messages-shown', sequence: 5 });
  const first = chat.requestOf('mark-read');
  const again = chat.send({ type: 'messages-shown', sequence: 5 });
  chat.send({ type: 'messages-shown', sequence: 7 });
  const replaced = chat.state();
  const late = chat.send({ type: 'read-marked', request: first, sequence: 5 });
  assert({
    given:
      'the same messages shown twice, then newer ones, then the first marker answering',
    should:
      'ask once for the same sequence, and change nothing for the marker that was replaced',
    actual: {
      askedAgain: again.effects,
      marking: (replaced.standing as OpenContextChat).marking?.sequence,
      lateRejected: late.state === replaced,
    },
    expected: { askedAgain: [], marking: 7, lateRejected: true },
  });
});

test('expiry is told by the timer set for it', () => {
  const chat = contextChatDriver();
  chat.read();
  const other = chat.send({ type: 'expiry-reached', expiresAt: laterExpiry });
  chat.send({ type: 'expiry-reached', expiresAt });
  const expired = chat.state();
  const again = chat.send({ type: 'expiry-reached', expiresAt });
  const same = chat.send({
    type: 'latest-read',
    request: refresh(chat),
    page: pageRead(),
  });
  const extended = chat.send({
    type: 'latest-read',
    request: refresh(chat),
    page: pageRead({ metadata: { expiresAt: laterExpiry } }),
  });
  assert({
    given:
      'a timer for another expiry, the chat’s own, a page with the same expiry, then a page with a later one',
    should:
      'ignore the other timer, expire once, stay expired, then reopen and watch the later expiry',
    actual: {
      otherAsked: other.effects.length,
      expired: (expired.standing as OpenContextChat).expired,
      againRejected: again.state === expired && again.effects.length === 0,
      stillExpired: (same.state.standing as OpenContextChat).expired,
      sameAsked: same.effects,
      extended: (extended.state.standing as OpenContextChat).expired,
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

test('entering again starts the chat afresh and keeps the open drafts', () => {
  const chat = contextChatDriver();
  chat.read(pageRead({ messageUnits: 2000, readSequence: 3 }));
  const before = refresh(chat);
  chat.send({ type: 'enter-requested', mayOpen: true });
  const loading = chat.state();
  const second = chat.send({ type: 'enter-requested', mayOpen: true });
  const during = chat.send({
    type: 'latest-read',
    request: before,
    page: pageRead(),
  });
  chat.send({
    type: 'discovered',
    request: chat.requestOf('discover'),
    channel: pageRead().metadata,
  });
  const reopened = chat.state();
  const after = chat.send({
    type: 'latest-read',
    request: before,
    page: pageRead({ metadata: { readOnly: true } }),
  });
  assert({
    given:
      'an open chat entered again with a read on its way, which answers during the entry and again after it',
    should:
      'keep the drafts’ channel while away, enter once, and let no read from before answer into the new chat',
    actual: {
      loading: loading.standing,
      secondRejected: second.state === loading && second.effects.length === 0,
      duringRejected: during.state === loading,
      reopened: (reopened.standing as OpenContextChat).thread,
      afterRejected: after.state === reopened,
      requests: chat
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

test('a reader who may not open a chat finds it empty', () => {
  const chat = contextChatDriver();
  chat.send({ type: 'enter-requested', mayOpen: false });
  const empty = chat.send({
    type: 'discovered',
    request: chat.requestOf('discover'),
    channel: null,
  });
  const opener = contextChatDriver();
  opener.send({ type: 'enter-requested', mayOpen: true });
  const request = opener.requestOf('discover');
  const opening = opener.send({ type: 'discovered', request, channel: null });
  const early = contextChatDriver();
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

test('a page for another channel is not this chat’s', () => {
  const chat = contextChatDriver();
  chat.open();
  const state = chat.state();
  const other = 'f'.repeat(24);
  const page = pageRead({ metadata: { channelId: other } });
  const step = chat.send({
    type: 'latest-read',
    request: chat.requestOf('read-latest'),
    page: { ...page, history: { ...page.history, channelId: other } },
  });
  assert({
    given: 'an awaited read answered with another channel’s page',
    should: 'change nothing',
    actual: step.state === state && step.effects.length === 0,
    expected: true,
  });
});

test('a chat hidden before its first page reads it once shown again', () => {
  const chat = contextChatDriver();
  chat.open();
  const first = chat.requestOf('read-latest');
  chat.send({ type: 'chat-hidden' });
  const dropped = chat.send({
    type: 'latest-read',
    request: first,
    page: pageRead(),
  });
  const hidden = openContextChat(chat);
  const shown = chat.send({ type: 'chat-shown' });
  const awaited = openContextChat(chat);
  const again = chat.send({ type: 'chat-shown' });
  const page = pageRead({ messages: [message(3)] });
  chat.send({
    type: 'latest-read',
    request: chat.requestOf('read-latest'),
    page,
  });
  assert({
    given:
      'a chat hidden while its first page was on its way, the dropped page answering, then the chat shown twice',
    should:
      'hold no page and wait for none while hidden, ask for the latest page once when shown, and hold what that read brings',
    actual: {
      droppedRejected: dropped.state.standing === hidden,
      hidden: [hidden.hidden, hidden.thread, hidden.reads],
      asked: shown.effects,
      awaited: [awaited.hidden, awaited.thread, awaited.reads],
      againRejected:
        again.state.standing === awaited && again.effects.length === 0,
      history: openContextChat(chat).thread?.history,
      reads: openContextChat(chat).reads,
    },
    expected: {
      droppedRejected: true,
      hidden: [true, null, { latest: [], older: [] }],
      asked: [{ type: 'read-latest', request: first + 1, channelId }],
      awaited: [false, null, { latest: [first + 1], older: [] }],
      againRejected: true,
      history: page.history,
      reads: { latest: [], older: [] },
    },
  });
});

test('a chat that was never hidden is not shown again', () => {
  const chat = contextChatDriver();
  chat.read();
  const state = chat.state();
  const step = chat.send({ type: 'chat-shown' });
  assert({
    given: 'an open chat the live channel never hid, told it is shown',
    should: 'change nothing and ask nothing',
    actual: step.state === state && step.effects.length === 0,
    expected: true,
  });
});

test('a hidden chat reads nothing until it is shown again', () => {
  for (const [given, firstPage] of [
    ['a chat hidden with its thread shown', 'read'],
    ['a chat hidden before its first page', 'on its way'],
  ] as const) {
    const chat = contextChatDriver();
    if (firstPage === 'read') chat.read();
    else chat.open();
    chat.send({ type: 'chat-hidden' });
    const hidden = chat.state();
    const before = chat.requestOf('read-latest');
    const refused = chat.send({ type: 'refresh-requested' });
    const shown = chat.send({ type: 'chat-shown' });
    assert({
      given: `${given}, asked to refresh and then shown`,
      should:
        'ask nothing under the withdrawn access, and ask for the latest page exactly once when shown',
      actual: {
        refused: refused.state === hidden && refused.effects.length === 0,
        asked: shown.effects,
        awaited: openContextChat(chat).reads,
      },
      expected: {
        refused: true,
        asked: [{ type: 'read-latest', request: before + 1, channelId }],
        awaited: { latest: [before + 1], older: [] },
      },
    });
  }
});

test('an older page adds only the authors the thread does not know', () => {
  const chat = contextChatDriver();
  chat.read(pageRead({ authors: [author('a'), author('b')] }));
  chat.send({
    type: 'older-read',
    request: older(chat),
    page: pageRead({
      messages: [message(4)],
      before: 4,
      authors: [{ ...author('b'), label: 'Renamed' }, author('c')],
    }),
  });
  chat.send({
    type: 'older-read',
    request: older(chat, 4),
    page: pageRead({ messages: [message(3)], authors: [author('c')] }),
  });
  assert({
    given:
      'two older pages, each answering authors the thread holds, one new, and not one the thread knows',
    should: 'hold each author once, losing none it already knew',
    actual: openContextChat(chat).thread?.authors,
    expected: [author('a'), author('b'), author('c')],
  });
});

test('a hidden chat marks nothing read and pages nothing older', () => {
  const chat = contextChatDriver();
  chat.read(pageRead({ messages: [message(9)], before: 9 }));
  chat.send({ type: 'chat-hidden' });
  const hidden = chat.state();
  const steps = [
    chat.send({ type: 'messages-shown', sequence: 9 }),
    chat.send({ type: 'older-requested', before: 9 }),
  ];
  assert({
    given: 'a hidden chat told messages were shown and asked for older ones',
    should: 'change nothing and ask nothing',
    actual: steps.every(
      (step) => step.state === hidden && step.effects.length === 0,
    ),
    expected: true,
  });
});

test('an answer applies only to a read of its own kind', () => {
  const chat = contextChatDriver();
  chat.read();
  chat.send({ type: 'messages-shown', sequence: 7 });
  const mark = chat.requestOf('mark-read');
  const page = older(chat);
  const latest = refresh(chat);
  const state = chat.state();
  const crossed = [
    chat.send({
      type: 'latest-read',
      request: mark,
      page: pageRead({ metadata: { readOnly: true } }),
    }),
    chat.send({
      type: 'read-refused',
      request: mark,
      read: 'older',
      denied: true,
    }),
    chat.send({ type: 'older-read', request: latest, page: pageRead() }),
    chat.send({
      type: 'read-refused',
      request: latest,
      read: 'older',
      denied: true,
    }),
    chat.send({ type: 'latest-read', request: page, page: pageRead() }),
    chat.send({
      type: 'read-refused',
      request: page,
      read: 'latest',
      denied: false,
    }),
    chat.send({ type: 'read-marked', request: latest, sequence: 7 }),
    chat.send({ type: 'read-mark-failed', request: page }),
  ];
  assert({
    given:
      'a read marker, an older page and a latest page on their way, each answered under another kind’s request',
    should: 'return the same state and ask nothing, every time',
    actual: {
      unmoved: crossed.map(
        (step) => step.state === state && step.effects.length === 0,
      ),
      reads: openContextChat(chat).reads,
    },
    expected: {
      unmoved: crossed.map(() => true),
      reads: { latest: [latest], older: [page] },
    },
  });
});

test('a failed read cannot answer twice', () => {
  const chat = contextChatDriver();
  chat.read();
  const request = refresh(chat);
  const refusal = {
    type: 'read-refused',
    request,
    read: 'latest',
    denied: false,
  } as const;
  chat.send(refusal);
  const failed = chat.state();
  const steps = [
    chat.send(refusal),
    chat.send({ ...refusal, denied: true }),
    chat.send({ type: 'latest-read', request, page: pageRead() }),
  ];
  assert({
    given: 'a read that failed, answering again as failed, denied and read',
    should: 'change nothing: the request is no longer on its way',
    actual: steps.every(
      (step) => step.state === failed && step.effects.length === 0,
    ),
    expected: true,
  });
});
