import type {
  PasskeyRow,
  SessionRow,
} from '../../../features/account/security-client';
import {
  readInFlight,
  UNREACHABLE_LISTS,
  type PasskeyEnrolment,
  type SecurityLists,
  type SecurityListsAnswer,
  type SecurityOverview,
  type SecurityOverviewEffect,
  type SecurityOverviewEvent,
  type SignOutOfOthers,
} from './security-overview-model';

export const passkey = (id: string): PasskeyRow => ({
  id,
  createdAt: '2026-11-01T00:00:00.000Z',
});
export const session = (id: string): SessionRow => ({
  id,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2026-12-01T00:00:00.000Z',
  userAgent: null,
  current: false,
});
export const answerOf = (
  passkeys: readonly string[],
  sessions: readonly string[],
): SecurityListsAnswer => ({
  passkeys: passkeys.map(passkey),
  sessions: sessions.map(session),
  passkeysOutcome: { kind: 'ok' },
  sessionsOutcome: { kind: 'ok' },
});

const READ: SecurityLists = {
  kind: 'read',
  passkeys: { kind: 'listed', rows: [passkey('key-1'), passkey('key-2')] },
  sessions: { kind: 'listed', rows: [session('here'), session('there')] },
  rereading: null,
};

const LISTS: Readonly<Record<string, SecurityLists>> = {
  loading: { kind: 'loading', version: 7 },
  read: READ,
  rereading: { ...READ, rereading: 7 },
  unavailable: {
    kind: 'read',
    passkeys: { kind: 'unavailable', notice: 'No passkeys could be read.' },
    sessions: { kind: 'unavailable', notice: 'No sessions could be read.' },
    rereading: null,
  },
};
const SIGN_OUTS: Readonly<Record<string, SignOutOfOthers>> = {
  idle: { kind: 'idle' },
  asking: { kind: 'asking', request: 8, saidBefore: null },
  'asking-again': { kind: 'asking', request: 8, saidBefore: 'It failed.' },
  failed: { kind: 'failed', notice: 'It failed.' },
};
const ENROLMENTS: Readonly<Record<string, PasskeyEnrolment>> = {
  idle: { kind: 'idle' },
  waiting: { kind: 'waiting', request: 9 },
  failed: { kind: 'failed', notice: 'Nothing was saved.' },
};

const named = (
  lists: string,
  signOut: string,
  enrolment: string,
): readonly [string, SecurityOverview] => [
  `${lists}/${signOut}/${enrolment}`,
  {
    lists: LISTS[lists]!,
    signOut: SIGN_OUTS[signOut]!,
    enrolment: ENROLMENTS[enrolment]!,
    minted: 9,
  },
];

/** Every shape the screen can hold, named `lists/sign-out/enrolment`. */
export const everyState = (): readonly (readonly [
  string,
  SecurityOverview,
])[] =>
  Object.keys(LISTS).flatMap((lists) =>
    Object.keys(SIGN_OUTS).flatMap((signOut) =>
      Object.keys(ENROLMENTS).map((enrolment) =>
        named(lists, signOut, enrolment),
      ),
    ),
  );

/** Every shape of each part, beside the other two at rest. */
export const everyPartState = (): readonly (readonly [
  string,
  SecurityOverview,
])[] => [
  ...Object.keys(LISTS).map((lists) => named(lists, 'idle', 'idle')),
  ...Object.keys(SIGN_OUTS)
    .filter((signOut) => signOut !== 'idle')
    .map((signOut) => named('read', signOut, 'idle')),
  ...Object.keys(ENROLMENTS)
    .filter((enrolment) => enrolment !== 'idle')
    .map((enrolment) => named('read', 'idle', enrolment)),
];

/** A number no state has given out. */
export const NEVER_MINTED = 999;

/** Every event the screen can receive in this state, named; answers come both current and stale. */
export const everyEvent = (
  state: SecurityOverview,
): readonly (readonly [string, SecurityOverviewEvent])[] => {
  const version = readInFlight(state) ?? NEVER_MINTED;
  const signOut =
    state.signOut.kind === 'asking' ? state.signOut.request : NEVER_MINTED;
  const enrolment =
    state.enrolment.kind === 'waiting' ? state.enrolment.request : NEVER_MINTED;
  return [
    ['read-asked', { type: 'read-asked' }],
    [
      'read-answered',
      { type: 'read-answered', version, answer: answerOf(['key-3'], ['here']) },
    ],
    [
      'read-answered unreachable',
      { type: 'read-answered', version, answer: UNREACHABLE_LISTS },
    ],
    [
      'read-answered stale',
      {
        type: 'read-answered',
        version: version - 1,
        answer: answerOf(['stale'], ['stale']),
      },
    ],
    [
      'passkey-renamed',
      { type: 'passkey-renamed', id: 'key-1', name: 'Work laptop' },
    ],
    ['passkey-removed', { type: 'passkey-removed', id: 'key-1' }],
    ['session-removed', { type: 'session-removed', id: 'there' }],
    ['sign-out-asked', { type: 'sign-out-asked' }],
    [
      'sign-out-answered ok',
      { type: 'sign-out-answered', request: signOut, outcome: { kind: 'ok' } },
    ],
    [
      'sign-out-answered refused',
      {
        type: 'sign-out-answered',
        request: signOut,
        outcome: { kind: 'rate-limited' },
      },
    ],
    [
      'sign-out-answered stale',
      {
        type: 'sign-out-answered',
        request: signOut - 1,
        outcome: { kind: 'ok' },
      },
    ],
    ['enrolment-asked', { type: 'enrolment-asked' }],
    [
      'enrolment-answered saved',
      {
        type: 'enrolment-answered',
        request: enrolment,
        outcome: { kind: 'saved' },
      },
    ],
    [
      'enrolment-answered cancelled',
      {
        type: 'enrolment-answered',
        request: enrolment,
        outcome: { kind: 'cancelled' },
      },
    ],
    [
      'enrolment-answered stale',
      {
        type: 'enrolment-answered',
        request: enrolment - 1,
        outcome: { kind: 'saved' },
      },
    ],
  ];
};

const rowsOf = (list: {
  readonly kind: string;
  readonly rows?: readonly { readonly id: string; readonly name?: unknown }[];
}) =>
  list.rows === undefined
    ? 'unavailable'
    : `[${list.rows.map((row) => (row.name ? `${row.id}=${String(row.name)}` : row.id)).join(' ')}]`;

/** One line that says what a step left and asked: enough to tell every transition apart. */
export const stepShape = (
  { lists, signOut, enrolment }: SecurityOverview,
  effects: readonly SecurityOverviewEffect[],
): string =>
  [
    lists.kind === 'loading'
      ? 'loading'
      : `${lists.rereading === null ? 'read' : 'rereading'} ${rowsOf(lists.passkeys)} ${rowsOf(lists.sessions)}`,
    signOut.kind === 'asking' && signOut.saidBefore !== null
      ? 'asking-again'
      : signOut.kind,
    enrolment.kind,
    effects.length === 0
      ? 'asks nothing'
      : `asks ${effects.map((effect) => effect.type).join(', ')}`,
  ].join(' / ');
