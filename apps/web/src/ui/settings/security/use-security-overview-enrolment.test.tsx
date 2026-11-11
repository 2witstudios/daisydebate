import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ENROLMENT_NOTICES } from './security-notices';
import { mount, overview } from './security-overview-mount.test-support';

setupRitewayBun();

test('a passkey that was not saved says why, and asks the device once at a time', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.resolve(overview([], [])));
    // Twice in one turn, before React has rendered the first press.
    await page.act(() => {
      page.held().addPasskey();
      page.held().addPasskey();
    });
    const waiting = page.held().overview.enrolment.kind;
    await page.act(() => page.enrolments[0]!.resolve({ kind: 'cancelled' }));
    const cancelled = page.held().overview.enrolment;
    await page.act(() => page.held().addPasskey());
    const again = page.held().overview.enrolment.kind;
    await page.act(() => page.enrolments[1]!.reject(new Error('offline')));
    assert({
      given:
        'the button pressed twice, the device cancelled, then a second try that cannot be made',
      should:
        'ask the device once, say nothing was saved, take that back while it tries again, say it failed, and read nothing more',
      actual: {
        waiting,
        cancelled,
        again,
        after: page.held().overview.enrolment,
        asked: page.enrolments.length,
        reads: page.reads.length,
      },
      expected: {
        waiting: 'waiting',
        cancelled: { kind: 'failed', notice: ENROLMENT_NOTICES.cancelled },
        again: 'waiting',
        after: { kind: 'failed', notice: ENROLMENT_NOTICES.failed },
        asked: 2,
        reads: 1,
      },
    });
  } finally {
    await page.unmount();
  }
});

test('a passkey saved here is read into the list', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.resolve(overview([], ['here'])));
    await page.savePasskey();
    const during = { lists: page.lists(), shown: page.shown().sessions };
    await page.act(() => page.reads[1]!.resolve(overview(['new'], ['here'])));
    assert({
      given: 'a passkey saved from a screen whose lists were read',
      should:
        'keep showing the rows it has while it reads again, then show the new passkey',
      actual: {
        during,
        enrolment: page.held().overview.enrolment.kind,
        passkeys: page.shown().passkeys,
      },
      expected: {
        during: { lists: 'read', shown: ['here'] },
        enrolment: 'idle',
        passkeys: ['new'],
      },
    });
  } finally {
    await page.unmount();
  }
});

test('an answer that arrives after the screen has gone asks nothing more', async () => {
  const page = await mount();
  await page.act(() => page.reads[0]!.resolve(overview([], ['here'])));
  await page.act(() => page.held().signOutOthers());
  await page.unmount();
  await page.act(() => page.signOuts[0]!.resolve({ kind: 'ok' }));
  assert({
    given: 'a sign-out of the others answered after the screen was left',
    should: 'not read the lists for a screen that is gone',
    actual: page.reads.length,
    expected: 1,
  });
});
