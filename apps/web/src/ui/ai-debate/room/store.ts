import type { Ballot } from '@daisy/ai-voice';
import { systemClock, type Clock } from '@daisy/clock';
import {
  deriveAiDebate,
  aiDebateTurns,
  turnRoles,
  type AiDebateState,
} from '@daisy/debate-engine';
import type { AiDebateView } from '../../../features/ai-debate/operations';
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
  readonly state: AiDebateState;
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

// A turn's countdown and its live time share one controller, so the AI
// can prepare its words while the countdown runs.
const turnKeyOf = (state: AiDebateState) => {
  if (state.phase === 'live' || state.phase === 'countdown')
    return `turn-${state.turnIndex}`;
  if (state.phase === 'prep') return `prep-${state.turnIndex}`;
  return state.phase;
};

const hasTurn = (
  state: AiDebateState,
): state is Extract<AiDebateState, { phase: 'live' | 'countdown' }> =>
  state.phase === 'live' || state.phase === 'countdown';

type Turn = {
  readonly key: string;
  readonly controller: AbortController | null;
  readonly goLive: () => void;
  wentLive: boolean;
  /** Wraps the turn up early, when its controller registered how. */
  finish: (() => Promise<void>) | null;
};

const idle = (key: string): Turn => ({
  key,
  controller: null,
  goLive: () => undefined,
  wentLive: false,
  finish: null,
});

/**
 * The debate room's state outside React: the server view (polled, and
 * refreshed after every action), the timeline folded each tick on the
 * server's clock, the controller for the live turn, and the ballot.
 */
/** Runs `run` every `ms` milliseconds; returns the stop. */
type Every = (run: () => void, ms: number) => () => void;

const everyInterval: Every = (run, ms) => {
  const handle = setInterval(run, ms);
  return () => clearInterval(handle);
};

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
  let stopped = false;
  let stopPolling: () => void = () => undefined;
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
    if (!view) return;
    try {
      await api.command(id, view.commands.length, next);
    } catch (error) {
      if (!(error instanceof AiDebateRequestError && error.status === 409))
        set({ problem: 'That did not go through. Try again.' });
    }
    await refresh();
  };

  const startTurn = (state: AiDebateState, view: RoomView, key: string) => {
    if (!hasTurn(state) || !engine) return idle(key);
    const current = aiDebateTurns[state.turnIndex]!;
    const roles = turnRoles(current, view.personSide);
    const controller = new AbortController();
    let goLive = () => undefined as void;
    const live = new Promise<void>((resolve) => (goLive = resolve));
    const context: TurnContext = {
      id,
      turnIndex: current.index,
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
    if (current.kind === 'cross-examination')
      void runCrossExamination(context, roles.asker === 'ai');
    else if (roles.speaker === 'ai')
      void runAiSpeech(
        context,
        () => void command({ type: 'yield', turnIndex: current.index }),
      );
    else void runPersonSpeech(context);
    return { key, controller, goLive, wentLive: false, finish: null };
  };

  /** The turn goes live: release its controller, with a bell on the cut. */
  const goLive = (previous: AiDebateState) => {
    turn.wentLive = true;
    turn.goLive();
    if (previous.phase === 'countdown' || previous.phase === 'prep')
      engine?.chime();
  };

  const requestBallot = async (attempt = 0): Promise<void> => {
    judging = true;
    try {
      set({ ballot: await api.ballot(id), status: '' });
    } catch {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        return requestBallot(attempt + 1);
      }
      set({ problem: 'The judge could not decide. Reload to try again.' });
    }
  };

  const judgeWhenOver = (state: AiDebateState) => {
    if (state.phase !== 'ended' || snapshot.ballot || judging) return;
    set({ status: 'The judge is deciding…' });
    void requestBallot();
  };

  /** A new turn, or the microphone joined during this one: (re)start it. */
  const advance = (state: AiDebateState, view: RoomView) => {
    const key = turnKeyOf(state);
    const restart = turn.controller === null && engine !== null;
    if (key === turn.key && !(restart && hasTurn(state))) return false;
    turn.controller?.abort();
    turn = startTurn(state, view, key);
    return true;
  };

  const tick = () => {
    const view = snapshot.view;
    if (!view) return;
    const state = deriveAiDebate({
      personSide: view.personSide,
      commands: view.commands,
      now: now() + (view.serverNow - view.receivedAt),
    });
    const previous = snapshot.state;
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
     * Ends the live turn early: the person's own speech first sends its last
     * words while the turn is live, then the turn is yielded.
     */
    async finishTurn(turnIndex: number) {
      await turn.finish?.();
      await command({ type: 'yield', turnIndex });
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
