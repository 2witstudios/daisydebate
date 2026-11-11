import type {
  loadSecurityOverview,
  PasskeyRow,
  SecurityOutcome,
  SessionRow,
} from '../../../features/account/security-client';
import type { PasskeyEnrollment } from '../../auth/onboarding/passkey-enrollment';
import { ENROLMENT_NOTICES, OUTCOME_NOTICES } from './security-notices';

/** What one read of both lists said. */
export type SecurityListsAnswer = Awaited<
  ReturnType<typeof loadSecurityOverview>
>;

/** One list as its last read left it: its rows, or why there are none to show. */
export type SecurityList<Row> =
  | { readonly kind: 'listed'; readonly rows: readonly Row[] }
  | { readonly kind: 'unavailable'; readonly notice: string };

/**
 * The account's passkeys and sessions. Until a read has answered there are no
 * rows to hold, so lists never read cannot be mistaken for an account with none;
 * and until one has been asked for there is no read to answer.
 */
export type SecurityLists =
  /** The screen as it opens: no read asked yet, so no answer can land. */
  | { readonly kind: 'unasked' }
  | {
      readonly kind: 'loading';
      /** The read whose answer these lists wait for. */
      readonly version: number;
    }
  | {
      readonly kind: 'read';
      readonly passkeys: SecurityList<PasskeyRow>;
      readonly sessions: SecurityList<SessionRow>;
      /** A later read in flight over these rows, by its version. */
      readonly rereading: number | null;
    };

/** Signing out of every other session. */
export type SignOutOfOthers =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'asking';
      readonly request: number;
      /** What the sign-out before this one said, shown until this one answers. */
      readonly saidBefore: string | null;
    }
  | { readonly kind: 'failed'; readonly notice: string };

/** Saving a new passkey on this device. */
export type PasskeyEnrolment =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting'; readonly request: number }
  | { readonly kind: 'failed'; readonly notice: string };

/** Everything the security settings screen holds. */
export type SecurityOverview = {
  readonly lists: SecurityLists;
  readonly signOut: SignOutOfOthers;
  readonly enrolment: PasskeyEnrolment;
  /** The newest read version or request number given out; the next is one more. */
  readonly minted: number;
};

export type SecurityOverviewEvent =
  | { readonly type: 'read-asked' }
  | {
      readonly type: 'read-answered';
      readonly version: number;
      readonly answer: SecurityListsAnswer;
    }
  | {
      readonly type: 'passkey-renamed';
      readonly id: string;
      readonly name: string;
    }
  | { readonly type: 'passkey-removed'; readonly id: string }
  | { readonly type: 'session-removed'; readonly id: string }
  | { readonly type: 'sign-out-asked' }
  | {
      readonly type: 'sign-out-answered';
      readonly request: number;
      readonly outcome: SecurityOutcome;
    }
  | { readonly type: 'enrolment-asked' }
  | {
      readonly type: 'enrolment-answered';
      readonly request: number;
      readonly outcome: PasskeyEnrollment;
    };

/** What the screen asks of the world; each answer comes back as a later event. */
export type SecurityOverviewEffect =
  | { readonly type: 'read'; readonly version: number }
  | { readonly type: 'sign-out-others'; readonly request: number }
  | { readonly type: 'enrol'; readonly request: number };

export type SecurityOverviewStep = {
  readonly state: SecurityOverview;
  readonly effects: readonly SecurityOverviewEffect[];
};

/** A read that could not be made at all says the same as one refused. */
export const UNREACHABLE_LISTS: SecurityListsAnswer = {
  passkeys: [],
  sessions: [],
  passkeysOutcome: { kind: 'unavailable' },
  sessionsOutcome: { kind: 'unavailable' },
};

/** The screen as it opens, before it has asked for anything. */
export const openingSecurityOverview = (
  /** A sign-out that did not happen before this screen opened. */
  signOutNotice?: string,
): SecurityOverview => ({
  lists: { kind: 'unasked' },
  signOut:
    signOutNotice === undefined
      ? { kind: 'idle' }
      : { kind: 'failed', notice: signOutNotice },
  enrolment: { kind: 'idle' },
  minted: 0,
});

/** The event does not apply here: the same state object, and nothing asked. */
const rejected = (state: SecurityOverview): SecurityOverviewStep => ({
  state,
  effects: [],
});

const listOf = <Row>(
  rows: readonly Row[],
  outcome: SecurityOutcome,
): SecurityList<Row> =>
  outcome.kind === 'ok'
    ? { kind: 'listed', rows }
    : { kind: 'unavailable', notice: OUTCOME_NOTICES[outcome.kind] };

/** The version of the read in flight, if there is one. */
export const readInFlight = ({ lists }: SecurityOverview): number | null => {
  switch (lists.kind) {
    case 'unasked':
      return null;
    case 'loading':
      return lists.version;
    case 'read':
      return lists.rereading;
  }
};

/** Starts a read under a new version; whatever was in flight is now stale. */
const readAgain = (state: SecurityOverview): SecurityOverviewStep => {
  const version = state.minted + 1;
  return {
    state: {
      ...state,
      minted: version,
      lists:
        state.lists.kind === 'read'
          ? { ...state.lists, rereading: version }
          : { kind: 'loading', version },
    },
    effects: [{ type: 'read', version }],
  };
};

type ReadLists = Extract<SecurityLists, { readonly kind: 'read' }>;

const changeRows = <Row>(
  list: SecurityList<Row>,
  change: (rows: readonly Row[]) => readonly Row[],
): SecurityList<Row> =>
  list.kind === 'listed' ? { kind: 'listed', rows: change(list.rows) } : list;

/**
 * A row's own action landed on the server. A read in flight began before it,
 * so it is stale and the lists are read again; with none in flight the rows
 * held are simply brought up to date, and a list holding no rows has none to
 * change.
 */
const rowChanged = (
  state: SecurityOverview,
  change: (lists: ReadLists) => ReadLists,
): SecurityOverviewStep => {
  if (state.lists.kind !== 'read') return rejected(state);
  const lists = change(state.lists);
  if (state.lists.rereading !== null) return readAgain({ ...state, lists });
  return lists.passkeys === state.lists.passkeys &&
    lists.sessions === state.lists.sessions
    ? rejected(state)
    : { state: { ...state, lists }, effects: [] };
};

const without =
  (id: string) =>
  <Row extends { readonly id: string }>(rows: readonly Row[]) =>
    rows.filter((row) => row.id !== id);

type EventOf<Type extends SecurityOverviewEvent['type']> = Extract<
  SecurityOverviewEvent,
  { readonly type: Type }
>;

const readAnswered = (
  state: SecurityOverview,
  { version, answer }: EventOf<'read-answered'>,
): SecurityOverviewStep =>
  version === readInFlight(state)
    ? {
        state: {
          ...state,
          lists: {
            kind: 'read',
            passkeys: listOf(answer.passkeys, answer.passkeysOutcome),
            sessions: listOf(answer.sessions, answer.sessionsOutcome),
            rereading: null,
          },
        },
        effects: [],
      }
    : rejected(state);

const signOutAsked = (state: SecurityOverview): SecurityOverviewStep => {
  if (state.signOut.kind === 'asking') return rejected(state);
  const request = state.minted + 1;
  return {
    state: {
      ...state,
      minted: request,
      signOut: {
        kind: 'asking',
        request,
        saidBefore:
          state.signOut.kind === 'failed' ? state.signOut.notice : null,
      },
    },
    effects: [{ type: 'sign-out-others', request }],
  };
};

const signOutAnswered = (
  state: SecurityOverview,
  { request, outcome }: EventOf<'sign-out-answered'>,
): SecurityOverviewStep => {
  if (state.signOut.kind !== 'asking' || state.signOut.request !== request)
    return rejected(state);
  // The other sessions are gone only once the server says so.
  return outcome.kind === 'ok'
    ? readAgain({ ...state, signOut: { kind: 'idle' } })
    : {
        state: {
          ...state,
          signOut: { kind: 'failed', notice: OUTCOME_NOTICES[outcome.kind] },
        },
        effects: [],
      };
};

const enrolmentAsked = (state: SecurityOverview): SecurityOverviewStep => {
  if (state.enrolment.kind === 'waiting') return rejected(state);
  const request = state.minted + 1;
  return {
    state: {
      ...state,
      minted: request,
      enrolment: { kind: 'waiting', request },
    },
    effects: [{ type: 'enrol', request }],
  };
};

const enrolmentAnswered = (
  state: SecurityOverview,
  { request, outcome }: EventOf<'enrolment-answered'>,
): SecurityOverviewStep => {
  if (state.enrolment.kind !== 'waiting' || state.enrolment.request !== request)
    return rejected(state);
  return outcome.kind === 'saved'
    ? readAgain({ ...state, enrolment: { kind: 'idle' } })
    : {
        state: {
          ...state,
          enrolment: {
            kind: 'failed',
            notice: ENROLMENT_NOTICES[outcome.kind],
          },
        },
        effects: [],
      };
};

/** Every event in every state: a legal next state and what to ask of the world. */
export function reduceSecurityOverview(
  state: SecurityOverview,
  event: SecurityOverviewEvent,
): SecurityOverviewStep {
  switch (event.type) {
    case 'read-asked':
      return readAgain(state);
    case 'read-answered':
      return readAnswered(state, event);
    case 'passkey-renamed':
      return rowChanged(state, (lists) => ({
        ...lists,
        passkeys: changeRows(lists.passkeys, (rows) =>
          rows.map((row) =>
            row.id === event.id ? { ...row, name: event.name } : row,
          ),
        ),
      }));
    case 'passkey-removed':
      return rowChanged(state, (lists) => ({
        ...lists,
        passkeys: changeRows(lists.passkeys, without(event.id)),
      }));
    case 'session-removed':
      return rowChanged(state, (lists) => ({
        ...lists,
        sessions: changeRows(lists.sessions, without(event.id)),
      }));
    case 'sign-out-asked':
      return signOutAsked(state);
    case 'sign-out-answered':
      return signOutAnswered(state, event);
    case 'enrolment-asked':
      return enrolmentAsked(state);
    case 'enrolment-answered':
      return enrolmentAnswered(state, event);
  }
}

/** What the last sign-out of the others said, while it still stands. */
export const signOutNoticeOf = ({
  signOut,
}: SecurityOverview): string | null =>
  signOut.kind === 'failed'
    ? signOut.notice
    : signOut.kind === 'asking'
      ? signOut.saidBefore
      : null;
