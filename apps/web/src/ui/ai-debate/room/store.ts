import type { Ballot } from '@daisy/ai-voice';
import { systemClock, type Clock } from '@daisy/clock';
import {
  deriveAiDebate,
  ipdaTurns,
  turnRoles,
  type AiDebateState,
} from '@daisy/debate-engine';
import type { AiDebateView } from '../../../features/ai-debate/operations';
import { aiDebateApi, AiDebateRequestError } from './api';
import { openAudioEngine, type AudioEngine } from './audio';
import {
  runAiSpeech,
  runCrossExamination,
  runPersonSpeech,
  type TurnContext,
} from './controllers';

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
};

export type RoomCommand = Parameters<typeof aiDebateApi.command>[2];

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
};

const turnKeyOf = (state: AiDebateState) =>
  state.phase === 'live' || state.phase === 'prep'
    ? `${state.phase}-${state.turnIndex}`
    : state.phase;

/**
 * The debate room's state outside React: the server view (polled, and
 * refreshed after every action), the timeline folded each tick on the
 * server's clock, the controller for the live turn, and the ballot.
 */
export function createRoomStore({
  id,
  clock = systemClock,
}: {
  readonly id: string;
  readonly clock?: Clock;
}) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let engine: AudioEngine | null = null;
  let turn: { key: string; controller: AbortController | null } = {
    key: 'waiting',
    controller: null,
  };
  let judging = false;
  const now = () => Date.parse(clock.now());
  const set = (patch: Partial<RoomSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const refresh = async () => {
    try {
      const view = await aiDebateApi.view(id);
      set({
        view: { ...view, receivedAt: now() },
        ...(view.ballot ? { ballot: view.ballot } : {}),
      });
    } catch {
      set({ problem: 'Lost touch with the server. Retrying…' });
    }
  };

  const command = async (next: RoomCommand) => {
    const view = snapshot.view;
    if (!view) return;
    try {
      await aiDebateApi.command(id, view.commands.length, next);
    } catch (error) {
      if (!(error instanceof AiDebateRequestError && error.status === 409))
        set({ problem: 'That did not go through. Try again.' });
    }
    await refresh();
  };

  const startController = (state: AiDebateState, view: RoomView) => {
    if (state.phase !== 'live' || !engine) return null;
    const current = ipdaTurns[state.turnIndex]!;
    const roles = turnRoles(current, view.personSide);
    const controller = new AbortController();
    const context: TurnContext = {
      id,
      turnIndex: current.index,
      engine,
      signal: controller.signal,
      onLine: () => void refresh(),
      onStatus: (status) => set({ status }),
      onCaption: (caption) => set({ caption }),
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
    return controller;
  };

  const requestBallot = async (attempt = 0): Promise<void> => {
    judging = true;
    try {
      set({ ballot: await aiDebateApi.ballot(id), status: '' });
    } catch {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        return requestBallot(attempt + 1);
      }
      set({ problem: 'The judge could not decide. Reload to try again.' });
    }
  };

  const tick = () => {
    const view = snapshot.view;
    if (!view) return;
    const state = deriveAiDebate({
      personSide: view.personSide,
      commands: view.commands,
      now: now() + (view.serverNow - view.receivedAt),
    });
    const key = turnKeyOf(state);
    if (
      key !== turn.key ||
      (turn.controller === null && engine && state.phase === 'live')
    ) {
      turn.controller?.abort();
      turn = { key, controller: startController(state, view) };
      set({ state, caption: '', status: '' });
    } else set({ state });
    if (state.phase === 'ended' && !snapshot.ballot && !judging) {
      set({ status: 'The judge is deciding…' });
      void requestBallot();
    }
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
      void refresh();
      const poll = setInterval(() => void refresh(), 5_000);
      const ticker = setInterval(tick, 250);
      return () => {
        clearInterval(poll);
        clearInterval(ticker);
        turn.controller?.abort();
        engine?.close();
        engine = null;
      };
    },
    /** Opens the microphone (a user gesture), and on a first visit starts. */
    async join(begin: boolean) {
      set({ busy: true, problem: '' });
      try {
        engine = await openAudioEngine();
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
