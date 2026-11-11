import type {
  PasskeyRow,
  SecurityOutcome,
  SessionRow,
} from '../../../features/account/security-client';
import type { PasskeyEnrollment } from '../../auth/onboarding/passkey-enrollment';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './use-security-overview.test-support';

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
export const overview = (
  passkeys: readonly string[],
  sessions: readonly string[],
) =>
  ({
    passkeys: passkeys.map(passkey),
    sessions: sessions.map(session),
    passkeysOutcome: { kind: 'ok' },
    sessionsOutcome: { kind: 'ok' },
  }) as const;
type Overview = ReturnType<typeof overview>;

/** The hook in a private realm; the test answers each read, sign-out and enrolment. */
export const mount = async (signOutNotice?: string) => {
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./use-security-overview.test-support', import.meta.dir),
  );
  const reads: ReturnType<typeof Promise.withResolvers<Overview>>[] = [];
  const signOuts: ReturnType<typeof Promise.withResolvers<SecurityOutcome>>[] =
    [];
  const enrolments: ReturnType<
    typeof Promise.withResolvers<PasskeyEnrollment>
  >[] = [];
  const enrol = () => {
    const enrolment = Promise.withResolvers<PasskeyEnrollment>();
    enrolments.push(enrolment);
    return enrolment.promise;
  };
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
        enrol,
        signOutNotice,
        hold: (now) => {
          held = now;
        },
      }),
    ),
  );
  const act = (work: () => void) => client.act(async () => work());
  const output = () => client.container.querySelector('output')!;
  return {
    reads,
    signOuts,
    enrolments,
    held: () => held,
    act,
    /** A passkey saved from this screen, which reads the lists again. */
    savePasskey: async () => {
      await act(() => held.addPasskey());
      await act(() => enrolments.at(-1)!.resolve({ kind: 'saved' }));
    },
    signingOutOthers: () => held.overview.signOut.kind === 'asking',
    lists: () => output().getAttribute('data-lists'),
    shown: () =>
      JSON.parse(output().textContent!) as {
        passkeys: string[];
        sessions: string[];
        sessionsNotice: string | null;
        signOutNotice: string | null;
      },
    unmount: () => client.act(async () => client.root.unmount()),
  };
};
