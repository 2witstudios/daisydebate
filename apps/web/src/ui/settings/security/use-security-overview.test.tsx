import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  PasskeyRow,
  SecurityOutcome,
  SessionRow,
} from '../../../features/account/security-client';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './use-security-overview.test-support';

setupRitewayBun();

const passkey = (id: string): PasskeyRow => ({
  id,
  createdAt: '2026-11-01T00:00:00.000Z',
});
const session = (id: string): SessionRow => ({
  id,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2026-12-01T00:00:00.000Z',
  userAgent: null,
  current: false,
});
const overview = (passkeys: readonly string[], sessions: readonly string[]) =>
  ({
    passkeys: passkeys.map(passkey),
    sessions: sessions.map(session),
    passkeysOutcome: { kind: 'ok' },
    sessionsOutcome: { kind: 'ok' },
  }) as const;
type Overview = ReturnType<typeof overview>;

/** The hook in a private realm; the test answers each read and each sign-out. */
const mount = async () => {
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./use-security-overview.test-support', import.meta.dir),
  );
  const reads: PromiseWithResolvers<Overview>[] = [];
  const signOuts: PromiseWithResolvers<SecurityOutcome>[] = [];
  let held: Parameters<Parameters<typeof client.OverviewProbe>[0]['hold']>[0];
  const load = () => {
    const read = Promise.withResolvers<Overview>();
    reads.push(read);
    return read.promise;
  };
  const revokeOthers = () => {
    const signOut = Promise.withResolvers<SecurityOutcome>();
    signOuts.push(signOut);
    return signOut.promise;
  };
  await client.act(async () =>
    client.root.render(
      client.createElement(client.OverviewProbe, {
        load,
        revokeOthers,
        hold: (now) => {
          held = now;
        },
      }),
    ),
  );
  return {
    reads,
    signOuts,
    held: () => held,
    act: (work: () => void) => client.act(async () => work()),
    shown: () =>
      JSON.parse(client.container.querySelector('output')!.textContent!) as {
        passkeys: string[];
        sessions: string[];
      },
    unmount: () => client.act(async () => client.root.unmount()),
  };
};

test('a read begun before a removal here never brings the removed row back', async () => {
  const page = await mount();
  try {
    await page.act(() => page.reads[0]!.resolve(overview(['one', 'two'], [])));
    // A passkey was just added: the screen reads again, and that read is slow.
    await page.act(() => page.held().reload());
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

test('signing out of all other sessions is asked once while it is in flight', async () => {
  const page = await mount();
  try {
    await page.act(() =>
      page.reads[0]!.resolve(overview([], ['here', 'there'])),
    );
    await page.act(() => page.held().signOutOthers());
    const busy = page.held().signingOutOthers;
    await page.act(() => page.held().signOutOthers());
    const asked = page.signOuts.length;
    await page.act(() => page.signOuts[0]!.resolve({ kind: 'ok' }));
    assert({
      given: 'the button pressed again before the first answer',
      should:
        'send one request, say it is working, and take the next press once answered',
      actual: { asked, busy, after: page.held().signingOutOthers },
      expected: { asked: 1, busy: true, after: false },
    });
  } finally {
    await page.unmount();
  }
});
