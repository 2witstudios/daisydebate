import { assert, setupRitewayBun, test } from 'riteway/bun';
import { OUTCOME_NOTICES } from './security-notices';
import { mount, overview } from './security-overview-mount.test-support';

setupRitewayBun();

test('a read begun before a removal here never brings the removed row back', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.resolve(overview(['one', 'two'], [])));
    // A passkey was just added: the screen reads again, and that read is slow.
    await page.savePasskey();
    await page.act(() => page.held().removePasskey('one'));
    // The slow read was taken before the removal landed.
    await page.act(() =>
      page.reads[1]!.resolve(overview(['one', 'two', 'three'], [])),
    );
    const afterStale = page.shown().passkeys;
    await page.act(() =>
      page.reads.at(-1)!.resolve(overview(['two', 'three'], [])),
    );
    assert({
      given:
        'a passkey removed here while an earlier read of the lists is still in flight',
      should:
        'ignore that read, keep the row removed, and show what a read begun after it says',
      actual: { afterStale, settled: page.shown().passkeys },
      expected: { afterStale: ['two'], settled: ['two', 'three'] },
    });
  } finally {
    await page.unmount();
  }
});

test('a removal with nothing being read changes the list and reads nothing', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.resolve(overview(['one', 'two'], [])));
    await page.act(() => page.held().removePasskey('one'));
    assert({
      given: 'a passkey removed here after the lists were read',
      should: 'drop the row and start no further read',
      actual: { shown: page.shown().passkeys, reads: page.reads.length },
      expected: { shown: ['two'], reads: 1 },
    });
  } finally {
    await page.unmount();
  }
});

test('signing out of all other sessions is asked once while it is in flight', async () => {
  const page = await mount();
  try {
    await page.act(() =>
      page.reads[0]!.resolve(overview([], ['here', 'there'])),
    );
    // Twice in one turn, before React has rendered the first press.
    await page.act(() => {
      page.held().signOutOthers();
      page.held().signOutOthers();
    });
    const busy = page.signingOutOthers();
    await page.act(() => page.held().signOutOthers());
    const asked = page.signOuts.length;
    await page.act(() => page.signOuts[0]!.resolve({ kind: 'ok' }));
    assert({
      given: 'the button pressed again before the first answer',
      should:
        'send one request, say it is working, and take the next press once answered',
      actual: { asked, busy, after: page.signingOutOthers() },
      expected: { asked: 1, busy: true, after: false },
    });
  } finally {
    await page.unmount();
  }
});

test('a sign-out that failed stays said until a sign-out succeeds', async () => {
  const page = await mount('Sign-out did not happen.');
  try {
    await page.act(() => page.reads[0]!.resolve(overview([], ['here'])));
    const afterRead = page.shown().signOutNotice;
    await page.act(() => page.held().signOutOthers());
    await page.act(() => page.signOuts[0]!.resolve({ kind: 'rate-limited' }));
    const afterRefusal = page.shown().signOutNotice;
    await page.act(() => page.held().signOutOthers());
    await page.act(() => page.signOuts[1]!.resolve({ kind: 'ok' }));
    await page.act(() => page.reads.at(-1)!.resolve(overview([], ['here'])));
    assert({
      given:
        'a screen opened after a failed sign-out, its lists read, a refused sign-out of the others, then one that works',
      should:
        'keep the notice through the read, replace it with the refusal, and clear it once a sign-out succeeds',
      actual: {
        afterRead,
        refused: afterRefusal !== null && afterRefusal !== afterRead,
        after: page.shown().signOutNotice,
      },
      expected: {
        afterRead: 'Sign-out did not happen.',
        refused: true,
        after: null,
      },
    });
  } finally {
    await page.unmount();
  }
});

test('a read that answers in the same moment as a removal is still stale', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.resolve(overview(['one', 'two'], [])));
    await page.savePasskey();
    // Before React has run any cleanup: the removal, then the old answer.
    await page.act(() => {
      page.held().removePasskey('one');
      page.reads[1]!.resolve(overview(['one', 'two'], []));
    });
    assert({
      given:
        'a removal and the answer to an earlier read arriving in the same moment',
      should: 'keep the row removed and read again',
      actual: { shown: page.shown().passkeys, reads: page.reads.length },
      expected: { shown: ['two'], reads: 3 },
    });
  } finally {
    await page.unmount();
  }
});

test('a read that cannot be made says the lists are unavailable', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.reject(new Error('offline')));
    const unread = page.shown();
    await page.savePasskey();
    await page.act(() => page.reads[1]!.resolve(overview([], ['here'])));
    assert({
      given: 'a read that rejects, then one that answers',
      should:
        'say the lists could not be read, then show them and take that back',
      actual: { unread, after: page.shown() },
      expected: {
        unread: {
          passkeys: [],
          sessions: [],
          sessionsNotice: OUTCOME_NOTICES.unavailable,
          signOutNotice: null,
        },
        after: {
          passkeys: [],
          sessions: ['here'],
          sessionsNotice: null,
          signOutNotice: null,
        },
      },
    });
  } finally {
    await page.unmount();
  }
});

test('a sign-out of the others that cannot be sent can be asked again', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.resolve(overview([], ['here'])));
    await page.act(() => page.held().signOutOthers());
    await page.act(() => page.signOuts[0]!.reject(new Error('offline')));
    const after = {
      busy: page.signingOutOthers(),
      notice: page.shown().signOutNotice,
    };
    await page.act(() => page.held().signOutOthers());
    assert({
      given: 'a sign-out request that rejects, then the button pressed again',
      should: 'say it did not happen, free the button, and send the next one',
      actual: { after, asked: page.signOuts.length },
      expected: {
        after: { busy: false, notice: OUTCOME_NOTICES.unavailable },
        asked: 2,
      },
    });
  } finally {
    await page.unmount();
  }
});

test('a sign-out that failed is said beside a read that failed', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.reject(new Error('offline')));
    await page.act(() => page.held().signOutOthers());
    await page.act(() => page.signOuts[0]!.resolve({ kind: 'rate-limited' }));
    const shown = page.shown();
    assert({
      given:
        'the sessions could not be read, and a sign-out of the others refused',
      should: 'say both, each in its own notice',
      actual: [shown.sessionsNotice, shown.signOutNotice],
      expected: [OUTCOME_NOTICES.unavailable, OUTCOME_NOTICES['rate-limited']],
    });
  } finally {
    await page.unmount();
  }
});

test('lists not yet read are not held as an account with none', async () => {
  const unread = await mount();
  const empty = await mount();
  try {
    await empty.act(() => empty.reads[0]!.resolve(overview([], [])));
    assert({
      given:
        'one screen whose first read is still in flight, and one whose read said the account has no passkeys and no sessions',
      should: 'hold the two differently',
      actual: {
        same: JSON.stringify(unread.held()) === JSON.stringify(empty.held()),
        unread: unread.lists(),
        empty: empty.lists(),
      },
      expected: { same: false, unread: 'loading', empty: 'read' },
    });
  } finally {
    await unread.unmount();
    await empty.unmount();
  }
});
