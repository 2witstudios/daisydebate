import type { Ballot } from '@daisy/ai-voice';
import { systemClock, type Clock } from '@daisy/clock';
import type { AiDebateView } from '../../../features/ai-debate/operations';
import {
  positionOfView,
  segmentAt,
  uiStateOf,
  type UiSegment,
  type UiState,
} from '../../../features/ai-debate/context';
import { aiDebateApi, AiDebateRequestError, type AiDebateApi } from './api';
import { openAudioEngine, type AudioEngine } from './audio';
import {
  runAiSpeech,
  runCrossExamination,
  runPersonSpeech,
} from './controllers';
import type { TurnContext } from './play-line';

export type RoomView = AiDebateView & { readonly receivedAt: number };

export type RoomSnapshot = {
  readonly view: RoomView | null;
  readonly state: UiState;
  readonly status: string;
  readonly caption: string;
  readonly problem: string;
  readonly headset: boolean;
  readonly ballot: Ballot | null;
  readonly joined: boolean;
  readonly busy: boolean;
  /** The debate does not exist, or is not this person's. */
  readonly missing: boolean;
  /** The opponent's voice is playing. */
  readonly speaking: boolean;
  /** The microphone's level, 0..1, while joined. */
  readonly level: number;
};

export type RoomCommand = Parameters<AiDebateApi['command']>[2];

const initial: RoomSnapshot = {
  view: null,
  state: { phase: 'waiting' },
  status: '',
  caption: '',
  problem: '',
  headset: true,
  ballot: null,
  joined: false,
  busy: false,
  missing: false,
  speaking: false,
  level: 0,
};

// A segment's countdown and its live time share one controller, so the AI
// can prepare its words while the countdown runs.
const keyOf = (state: UiState) => {
  if (state.phase === 'live' || state.phase === 'countdown')
    return `segment-${state.segmentIndex}`;
  if (state.phase === 'prep') return `prep-${state.segmentIndex}`;
  return state.phase;
};

const hasSegment = (
  state: UiState,
): state is Extract<UiState, { phase: 'live' | 'countdown' }> =>
  state.phase === 'live' || state.phase === 'countdown';

type SegmentTurn = {
  readonly key: string;
  readonly controller: AbortController | null;
  readonly goLive: () => void;
  wentLive: boolean;
  /** Wraps the segment up early, when its controller registered how. */
  finish: (() => Promise<void>) | null;
};

const idle = (key: string): SegmentTurn => ({
  key,
  controller: null,
  goLive: () => undefined,
  wentLive: false,
  finish: null,
});

/** Runs `run` every `ms` milliseconds; returns the stop. */
type Every = (run: () => void, ms: number) => () => void;

const everyInterval: Every = (run, ms) => {
  const handle = setInterval(run, ms);
  return () => clearInterval(handle);
};

/** Polled server view, clock-derived position, live controller and ballot. */
export function createRoomStore({
  id,
  clock = systemClock,
  api = aiDebateApi,
  openEngine = openAudioEngine,
  every = everyInterval,
}: {
  readonly id: string;
  readonly clock?: Clock;
  readonly api?: AiDebateApi;
  readonly openEngine?: () => Promise<AudioEngine>;
  readonly every?: Every;
}) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let engine: AudioEngine | null = null;
  let turn = idle('waiting');
  let judging = false;
  let finalizing = Promise.resolve();
  let stopped = false;
  let stopPolling: () => void = () => undefined;
  /** The gap whose prep this browser already asked for. */
  let prepAsked = -1;
  const now = () => Date.parse(clock.now());
  const set = (patch: Partial<RoomSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const refresh = async () => {
    try {
      const view = await api.view(id);
      set({
        view: { ...view, receivedAt: now() },
        ...(view.ballot ? { ballot: view.ballot } : {}),
      });
    } catch (error) {
      if (error instanceof AiDebateRequestError && error.status === 404) {
        stopPolling();
        set({ missing: true });
      } else set({ problem: 'Lost touch with the server. Retrying…' });
    }
  };

  const command = async (next: RoomCommand) => {
    const view = snapshot.view;
    if (!view) return false;
    let succeeded = false;
    try {
      await api.command(id, view.version, next);
      succeeded = true;
    } catch (error) {
      if (!(error instanceof AiDebateRequestError && error.status === 409))
        set({ problem: 'That did not go through. Try again.' });
    }
    await refresh();
    return succeeded;
  };

  /** The segment a controller would run, with who speaks it. */
  const segmentOf = (state: UiState, view: RoomView): UiSegment | null =>
    'segmentIndex' in state ? segmentAt(view, state.segmentIndex) : null;

  const startTurn = (state: UiState, view: RoomView, key: string) => {
    if (!hasSegment(state) || !engine) return idle(key);
    const segment = segmentOf(state, view);
    if (!segment) return idle(key);
    const controller = new AbortController();
    let goLive = () => undefined as void;
    const live = new Promise<void>((resolve) => (goLive = resolve));
    const context: TurnContext = {
      id,
      turnIndex: segment.index,
      api,
      engine,
      signal: controller.signal,
      live,
      onLine: () => void refresh(),
      onStatus: (status) => set({ status }),
      onCaption: (caption) => set({ caption }),
      onSpeaking: (speaking) => set({ speaking }),
      setFinish: (finish) => {
        if (turn.controller === controller) turn.finish = finish;
      },
      onError: (problem) => set({ problem }),
    };
    if (segment.kind === 'cross-examination')
      void runCrossExamination(context, segment.side !== view.personSide);
    else if (segment.side !== view.personSide)
      void runAiSpeech(context, () => {
        // Speech completion and the clock tick may each advance the durable
        // version while this controller plays. Claim the current one.
        void refresh().then(() =>
          command({ type: 'yield', segmentIndex: segment.index }),
        );
      });
    else void runPersonSpeech(context);
    return { key, controller, goLive, wentLive: false, finish: null };
  };

  /** The segment goes live: release its controller, with a bell on the cut. */
  const goLive = (previous: UiState) => {
    turn.wentLive = true;
    turn.goLive();
    if (previous.phase === 'countdown' || previous.phase === 'prep')
      engine?.chime();
  };

  const requestBallot = async (attempt = 0): Promise<void> => {
    judging = true;
    try {
      await finalizing;
      if (stopped) return;
      set({ ballot: await api.ballot(id), status: '' });
    } catch {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        return requestBallot(attempt + 1);
      }
      set({ problem: 'The judge could not decide. Reload to try again.' });
    }
  };

  const judgeWhenOver = (state: UiState) => {
    if (state.phase !== 'ended' || snapshot.ballot || judging) return;
    if (snapshot.view?.status === 'completed') {
      set({
        status: `Debate ended by forfeit. ${snapshot.view.outcome === snapshot.view.personSide ? 'You win.' : 'Your opponent wins.'}`,
      });
      return;
    }
    set({ status: 'The judge is deciding…' });
    void requestBallot();
  };

  const isAnswerer = (view: RoomView | null, segmentIndex: number): boolean => {
    const row = view?.segments[segmentIndex];
    const side = row && view?.rules.segments[row.sequence]?.side;
    return side !== undefined && side !== view?.personSide;
  };

  /**
   * Elective prep is commanded: before the person's own spendable segment,
   * this browser asks for prep as the countdown runs, so the clock hands
   * over without a control nobody asked for.
   */
  const askForPrep = (state: UiState, view: RoomView, remainingMs: number) => {
    if (
      state.phase !== 'countdown' ||
      view.status !== 'active' ||
      remainingMs <= 0
    )
      return;
    const segment = segmentOf(state, view);
    if (
      !segment ||
      segment.kind !== 'speech' ||
      segment.side !== view.personSide ||
      prepAsked === segment.index
    )
      return;
    prepAsked = segment.index;
    void command({ type: 'startPrep' }).then((succeeded) => {
      if (!succeeded && prepAsked === segment.index) prepAsked = -1;
    });
  };

  /** A new segment, or the microphone joined during this one: (re)start it. */
  const advance = (state: UiState, view: RoomView) => {
    const key = keyOf(state);
    const restart = turn.controller === null && engine !== null;
    if (key === turn.key && !(restart && hasSegment(state))) return false;
    if (state.phase === 'ended' && turn.finish) finalizing = turn.finish();
    turn.controller?.abort();
    turn = startTurn(state, view, key);
    return true;
  };

  const tick = () => {
    const { view, state: previous } = snapshot;
    if (!view) return;
    const position = positionOfView(
      view,
      now() + (view.serverNow - view.receivedAt),
    );
    const state = uiStateOf(position);
    const prepLeft = position.prepBudgetRemainingMs?.[view.personSide] ?? 0;
    askForPrep(state, view, prepLeft);
    if (advance(state, view))
      set({ state, caption: '', status: '', speaking: false });
    else set({ state, level: engine?.level() ?? 0 });
    if (state.phase === 'live' && turn.controller && !turn.wentLive)
      goLive(previous);
    judgeWhenOver(state);
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    /** Starts loading, polling and the clock; returns the stop. */
    start() {
      stopped = false;
      stopPolling = every(() => void refresh(), 5_000);
      const stopTicking = every(tick, 250);
      void refresh();
      return () => {
        stopped = true;
        stopPolling();
        stopTicking();
        turn.controller?.abort();
        engine?.close();
        engine = null;
      };
    },
    /**
     * Ends the live segment early: the person's own speech first sends its
     * last words while the segment is live, then it is yielded. In a
     * cross-examination the asker holds the floor — an answerer ending the
     * exchange takes it first, then yields it closed.
     */
    async finishTurn(segmentIndex: number) {
      await turn.finish?.();
      const view = snapshot.view;
      if (isAnswerer(view, segmentIndex)) await command({ type: 'interrupt' });
      await command({ type: 'yield', segmentIndex });
    },
    /** Opens the microphone (a user gesture), and on a first visit starts. */
    async join(begin: boolean) {
      set({ busy: true, problem: '' });
      try {
        const opened = await openEngine();
        // Left the room while the browser asked for the microphone: let go.
        if (stopped) {
          opened.close();
          return;
        }
        engine = opened;
        set({ joined: true, headset: await engine.usingHeadset() });
        if (begin) await command({ type: 'start' });
      } catch {
        set({
          problem:
            'Daisy needs your microphone for a voice debate. Allow it in your browser and try again.',
        });
      } finally {
        set({ busy: false });
      }
    },
    command,
  };
}
