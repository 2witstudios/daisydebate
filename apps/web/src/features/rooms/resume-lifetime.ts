import { mayResumeTab } from './resume';
import {
  claimOwnership,
  heartbeatOwnership,
  readOwnership,
  releaseOwnership,
} from './resume-ownership';

/** Advisory coordination only: server audience, attendance and grants remain authoritative. */
export function createResumeLifetime(input: {
  readonly actorId: string;
  readonly roundId: string;
  readonly tabId: string;
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly now: () => number;
  readonly subscribe: (listener: () => void) => () => void;
  readonly schedule: (tick: () => void) => () => void;
  /** False must synchronously release this tab's media before any later attempt. */
  readonly changed: (owns: boolean) => void;
}) {
  let stopped = false;
  let owns: boolean | null = null;
  const publish = (value: boolean) => {
    if (owns === value) return;
    owns = value;
    input.changed(value);
  };
  const claim = () => claimOwnership({ ...input, nowMs: input.now() });
  const check = () => {
    if (stopped) return;
    const decision = mayResumeTab(
      input.tabId,
      readOwnership(input.storage, input.actorId, input.roundId),
      input.now(),
    );
    if (decision === 'defer') {
      publish(false);
      return;
    }
    if (decision === 'take-over') claim();
    else heartbeatOwnership({ ...input, nowMs: input.now() });
    publish(true);
  };
  const unsubscribe = input.subscribe(check);
  const cancel = input.schedule(check);
  check();
  return {
    takeOver: () => {
      if (stopped) return;
      claim();
      check();
    },
    stop: (release = true) => {
      if (stopped) return;
      stopped = true;
      cancel();
      unsubscribe();
      if (release) releaseOwnership(input);
    },
  };
}
