import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RealtimeApp } from './app';
import { createRealtimeAuthorization } from './authorization';
import { createRealtimeDelivery } from './delivery';
import { liveParticipantSession } from './participant-session';

setupRitewayBun();

/** ADR 0075: realtime admission is participant access on a live session. */
const now = '2026-10-09T00:00:00.000Z';
const later = '2026-10-09T01:00:00.000Z';
const principal = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: 's'.repeat(24),
};
const accountWith = (
  beta: 'approved' | 'pending' | 'revoked' | null,
  ageBand: 'adult' | '16-17' | '13-15' | null,
) => ({
  userId: principal.userId,
  actorId: principal.actorId,
  member: true,
  erased: false,
  revision: 2,
  beta: beta && { state: beta, revision: 1 },
  ageBand,
});
const variants = [
  ['approved adult', accountWith('approved', 'adult')],
  ['approved 16-17', accountWith('approved', '16-17')],
  ['pending', accountWith('pending', 'adult')],
  ['revoked', accountWith('revoked', 'adult')],
  ['no beta row', accountWith(null, 'adult')],
  ['no age record', accountWith('approved', null)],
  ['under the floor', accountWith('approved', '13-15')],
] as const;
const admitted = [true, true, false, false, false, false, false];

test('a live session counts only with participant access (ADR 0075)', () => {
  assert({
    given:
      'live sessions for approved, pending, revoked, beta-less, age-less and under-16 accounts, plus an expired and a missing session',
    should: 'admit only the live approved 16+ sessions',
    actual: [
      ...variants.map(([, account]) =>
        liveParticipantSession({ expiresAt: later, account }, now),
      ),
      liveParticipantSession(
        { expiresAt: now, account: accountWith('approved', 'adult') },
        now,
      ),
      liveParticipantSession(null, now),
    ],
    expected: [...admitted, false, false],
  });
});

const sessionReader = (account: unknown) =>
  ({
    clock: { now: () => now },
    redis: {
      consumeConnectTicket: async () => ({
        accepted: true,
        actorId: principal.actorId,
        sessionId: principal.sessionId,
      }),
    },
    database: {
      resolveRealtimeSession: async () => ({
        ...principal,
        expiresAt: later,
        account,
      }),
      readAuthorizationSession: async () => ({
        ...principal,
        expiresAt: later,
        account,
      }),
    },
  }) as unknown as RealtimeApp;

const delivery = (resources: RealtimeApp) =>
  createRealtimeDelivery({
    resources,
    now: () => 0,
    publish: () => {},
    timers: {
      setInterval: () => ({}) as ReturnType<typeof setInterval>,
      clearInterval: () => {},
    },
  });

test('a connect ticket redeems only for a participant (ADR 0075)', async () => {
  const redeemed = await Promise.all(
    variants.map(
      async ([, account]) =>
        (await delivery(sessionReader(account)).authenticate(
          't'.repeat(43),
          'https://app.example.test',
        )) !== null,
    ),
  );
  assert({
    given: 'a valid ticket whose live session belongs to each account variant',
    should: 'redeem it only for the approved 16+ accounts',
    actual: redeemed,
    expected: admitted,
  });
});

test('principal validation keeps a socket only while it holds participant access (ADR 0075)', async () => {
  const viaAuthorization = await Promise.all(
    variants.map(([, account]) =>
      createRealtimeAuthorization({
        resources: sessionReader(account),
        now: () => Date.parse(now),
      }).validatePrincipal(principal),
    ),
  );
  const viaDelivery = await Promise.all(
    variants.map(([, account]) =>
      delivery(sessionReader(account)).validatePrincipal(principal),
    ),
  );
  assert({
    given:
      'the periodic principal check for a connected socket of each account variant, through the authorization port and the delivery port',
    should:
      'keep only approved 16+ sockets, so a revoke or a lost age record closes the rest',
    actual: [viaAuthorization, viaDelivery],
    expected: [admitted, admitted],
  });
});
