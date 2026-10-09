import {
  applyAction,
  mySeat,
  needsReady,
  roomHref,
  startBlock,
  type DemoStep,
  type JudgeKind,
  type Lifecycle,
  type Notice,
  type RoomJudge,
  type RoomAction,
  type RoomState,
  type SeatId,
} from './state';

export type RoomInfo = {
  readonly id: string;
  readonly title: string;
  /** Practice rooms are unranked; ranked rooms run the canonical rules. */
  readonly mode: 'practice' | 'ranked';
  /** The public name of the host. */
  readonly hostHandle: string;
  /** Who judges when the room opens: a person, the AI, or Daisy's assignment. */
  readonly judge: RoomJudge;
  /** A debate known only from the account's history: there is no room to go back to. */
  readonly fromHistory?: boolean;
};

type OccupantView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'person'; readonly handle: string; readonly you: boolean }
  | { readonly kind: 'ai' }
  | { readonly kind: 'assigned' };

type Link = { readonly label: string; readonly href: string };

type SeatView = {
  readonly id: SeatId;
  readonly label: string;
  readonly occupant: OccupantView;
  /** Ready text for a filled seat that needs a flag; null otherwise. */
  readonly readiness: string | null;
  readonly action: Link | null;
};

type Tone = 'accent' | 'gold' | 'neutral';

export type RoomView =
  | {
      readonly kind: 'denied';
      readonly title: string;
      readonly lobbyHref: string;
    }
  | {
      readonly kind: 'room';
      readonly id: string;
      readonly title: string;
      readonly modeLabel: string;
      readonly status: { readonly label: string; readonly tone: Tone };
      readonly notice: { readonly tone: Tone; readonly text: string } | null;
      readonly seats: readonly SeatView[];
      readonly settings: readonly {
        readonly label: string;
        readonly value: string;
      }[];
      readonly host: HostPanel | null;
      readonly ready: ReadyPanel | null;
      readonly start: StartPanel | null;
      readonly debateHref: string | null;
      readonly closed: boolean;
      readonly reopenedNote: string | null;
      readonly demo: readonly Link[];
      readonly lobbyHref: string;
    };

type HostPanel = {
  readonly judgeChoices: readonly {
    readonly label: string;
    readonly href: string;
    readonly on: boolean;
  }[];
  readonly closeHref: string;
};
type ReadyPanel = {
  readonly label: string;
  readonly href: string | null;
  readonly note: string | null;
};
type StartPanel = {
  readonly href: string | null;
  readonly blockedBy: string | null;
};

const lobbyHref = '/lobby';

const noticeText: Readonly<Record<Notice, { tone: Tone; text: string }>> = {
  'settings-saved': {
    tone: 'accent',
    text: 'Settings saved. Everyone has to ready up again.',
  },
  'seat-taken': {
    tone: 'gold',
    text: 'That seat is taken. Pick another seat or wait for it to open.',
  },
  'not-ready': { tone: 'gold', text: 'The room cannot start yet.' },
};

const seatLabel: Readonly<Record<SeatId, string>> = {
  affirmative: 'Affirmative',
  negative: 'Negative',
  judge: 'Judge',
};

const statusFor: Readonly<Record<Lifecycle, { label: string; tone: Tone }>> = {
  open: { label: 'Open', tone: 'accent' },
  started: { label: 'Started', tone: 'gold' },
  closed: { label: 'Closed', tone: 'neutral' },
};

const demoLabels: Readonly<Record<DemoStep, string>> = {
  'opponent-joins': 'An opponent joins',
  'judge-joins': 'A judge joins',
  'everyone-ready': 'Everyone readies up',
  'redis-down': 'Ready status goes down',
  'redis-up': 'Ready status comes back',
};

const judgeChoices: readonly { label: string; kind: JudgeKind }[] = [
  { label: 'A person', kind: 'person' },
  { label: 'Placeholder AI judge', kind: 'ai' },
];

const handleFor = (seat: SeatId, info: RoomInfo): string =>
  seat === 'judge'
    ? 'judge-one'
    : seat === 'affirmative'
      ? info.hostHandle
      : 'debater-b';

const judgeValue = (state: RoomState, ranked: boolean): string => {
  if (ranked) return 'Assigned by Daisy';
  return state.judgeKind === 'ai' ? 'Placeholder AI judge' : 'A person';
};

const debateLink = (info: RoomInfo, state: RoomState): string =>
  `/debates/${info.id}?${new URLSearchParams({ kind: state.judgeKind === 'assigned' ? 'person' : state.judgeKind }).toString()}`;

const next = (info: RoomInfo, state: RoomState, action: RoomAction): string =>
  roomHref(info.id, applyAction(state, action));

function occupantFor(
  id: SeatId,
  state: RoomState,
  info: RoomInfo,
  ranked: boolean,
): OccupantView {
  if (id === 'judge' && ranked) return { kind: 'assigned' };
  if (id === 'judge' && state.judgeKind === 'ai') return { kind: 'ai' };
  const who = state[id];
  if (who === 'empty') return { kind: 'empty' };
  return {
    kind: 'person',
    handle: who === 'you' ? 'you' : handleFor(id, info),
    you: who === 'you',
  };
}

function seatAction(
  id: SeatId,
  state: RoomState,
  info: RoomInfo,
  ranked: boolean,
  occupant: OccupantView,
): Link | null {
  if (state.lifecycle !== 'open') return null;
  const takeable =
    occupant.kind === 'empty' &&
    state.role !== 'outsider' &&
    !(ranked && id === 'judge');
  if (takeable)
    return {
      label: mySeat(state) === null ? 'Take seat' : 'Move here',
      href: next(info, state, { kind: 'take', seat: id }),
    };
  return state[id] === 'you'
    ? { label: 'Leave seat', href: next(info, state, { kind: 'leave' }) }
    : null;
}

function readinessFor(id: SeatId, state: RoomState): string | null {
  if (!needsReady(state, id)) return null;
  if (state.redisDown) return 'Ready status unavailable';
  return state.ready.includes(id) ? 'Ready' : 'Not ready';
}

function seatView(
  id: SeatId,
  state: RoomState,
  info: RoomInfo,
  ranked: boolean,
): SeatView {
  const occupant = occupantFor(id, state, info, ranked);
  return {
    id,
    label: seatLabel[id],
    occupant,
    readiness: readinessFor(id, state),
    action: seatAction(id, state, info, ranked, occupant),
  };
}

function hostPanel(
  info: RoomInfo,
  state: RoomState,
  ranked: boolean,
): HostPanel | null {
  if (state.role !== 'host' || state.lifecycle !== 'open' || ranked)
    return null;
  return {
    judgeChoices: judgeChoices.map((choice) => ({
      label: choice.label,
      on: state.judgeKind === choice.kind,
      href: next(info, state, { kind: 'judge-kind', judgeKind: choice.kind }),
    })),
    closeHref: `${lobbyHref}?did=Close+room`,
  };
}

function readyPanel(info: RoomInfo, state: RoomState): ReadyPanel | null {
  const mine = mySeat(state);
  if (state.lifecycle !== 'open' || mine === null || !needsReady(state, mine))
    return null;
  return {
    label: state.ready.includes(mine) ? 'Not ready' : 'Ready',
    href: state.redisDown ? null : next(info, state, { kind: 'ready' }),
    note: state.redisDown
      ? 'Ready status is unavailable right now. You can still change seats.'
      : null,
  };
}

function startPanel(info: RoomInfo, state: RoomState): StartPanel | null {
  if (state.lifecycle !== 'open' || mySeat(state) === null) return null;
  const blockedBy = startBlock(state);
  return {
    blockedBy,
    href: blockedBy === null ? debateLink(info, state) : null,
  };
}

function demoLinks(info: RoomInfo, state: RoomState): readonly Link[] {
  const steps: readonly DemoStep[] = [
    'opponent-joins',
    'judge-joins',
    'everyone-ready',
    state.redisDown ? 'redis-up' : 'redis-down',
  ];
  return steps.map((step) => ({
    label: demoLabels[step],
    href: next(info, state, { kind: 'demo', what: step }),
  }));
}

/** What the room page shows for a state. Pure: links carry the next state. */
export function roomView(info: RoomInfo, state: RoomState): RoomView {
  if (state.role === 'outsider')
    return { kind: 'denied', title: info.title, lobbyHref };
  const ranked = info.mode === 'ranked';
  const seats = (['affirmative', 'negative', 'judge'] as const)
    .filter((id) => !(ranked && id === 'judge'))
    .map((id) => seatView(id, state, info, ranked));
  return {
    kind: 'room',
    id: info.id,
    title: info.title,
    modeLabel: ranked ? 'Ranked' : 'Practice',
    status: statusFor[state.lifecycle],
    notice: state.notice ? noticeText[state.notice] : null,
    seats,
    settings: [
      { label: 'Format', value: 'Foundation' },
      { label: 'Speech', value: '4 minutes' },
      { label: 'Prep', value: '2 minutes' },
      { label: 'Judge', value: judgeValue(state, ranked) },
      { label: 'Visibility', value: 'Public' },
    ],
    host: hostPanel(info, state, ranked),
    ready: readyPanel(info, state),
    start: startPanel(info, state),
    debateHref: state.lifecycle === 'started' ? debateLink(info, state) : null,
    closed: state.lifecycle === 'closed',
    reopenedNote: state.reopened
      ? 'The last debate is over. Everyone has to ready up again for a rematch.'
      : null,
    demo: demoLinks(info, state),
    lobbyHref,
  };
}
