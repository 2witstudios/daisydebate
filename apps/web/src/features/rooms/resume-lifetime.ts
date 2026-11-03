import { mayResumeTab } from './resume';
import {
  claimOwnership,
  heartbeatOwnership,
  readOwnership,
  releaseOwnership,
  sweepExpiredClaims,
} from './resume-ownership';

/** Advisory coordination only: server audience, attendance and grants remain authoritative. */
export function createResumeLifetime(input: {
  readonly actorId: string;
  readonly roundId: string;
  readonly tabId: string;
  readonly storage: Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'
  >;
  readonly now: () => number;
  readonly subscribe: (listener: () => void) => () => void;
  readonly schedule: (tick: () => void) => () => void;
  /** Tab-local: names the document whose claim this tab's next document inherits. */
  readonly predecessor: {
    readonly read: () => string | null;
    readonly write: (tabId: string) => void;
    readonly clear: () => void;
  };
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
  sweepExpiredClaims(input.storage, input.now());
  const inherited = input.predecessor.read();
  input.predecessor.clear();
  if (
    inherited !== null &&
    readOwnership(input.storage, input.actorId, input.roundId).owner ===
      inherited
  )
    claim();
  const unsubscribe = input.subscribe(check);
  const cancel = input.schedule(check);
  check();
  const stopTicking = () => {
    stopped = true;
    cancel();
    unsubscribe();
  };
  return {
    takeOver: () => {
      if (stopped) return;
      claim();
      check();
    },
    /** This document is navigating: only this tab's next document inherits. */
    handOff: () => {
      if (stopped) return;
      if (owns) input.predecessor.write(input.tabId);
      stopTicking();
    },
    stop: (release = true) => {
      if (stopped) return;
      stopTicking();
      if (release) releaseOwnership(input);
    },
  };
}
