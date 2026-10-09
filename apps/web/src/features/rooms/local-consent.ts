import type { RoomCommand, RoomView } from '@daisy/protocol';
import type { readAssembly } from './read-assembly';
import type { submitAssembly } from './submit-assembly';

type ConsentCommand = Extract<RoomCommand, { type: 'ready' | 'unready' }>;
type Snapshot = {
  readonly view: RoomView;
  readonly devicesPassed: boolean;
  readonly pending: boolean;
  readonly problem: boolean;
};
/** Local consent intent only. CAP remains authoritative for eligibility/readiness. */
export function createLocalConsent({
  view,
  actorId,
  nextId,
  read,
  send,
}: {
  readonly view: RoomView;
  readonly actorId: string;
  readonly nextId: () => string;
  readonly read: () => ReturnType<typeof readAssembly>;
  readonly send: (command: ConsentCommand) => ReturnType<typeof submitAssembly>;
}) {
  let snapshot: Snapshot = {
    view,
    devicesPassed: false,
    pending: false,
    problem: false,
  };
  let desired: boolean | null = null;
  let running: Promise<void> | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const own = () =>
    snapshot.view.participants.find((p) => p.actorId === actorId);
  const effective = () => own()?.ready === 'ready';
  const publish = (patch: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const adopt = (next: RoomView) => {
    const nextOwn = next.participants.find((p) => p.actorId === actorId);
    if (
      next.id !== view.id ||
      next.version < snapshot.view.version ||
      (next.version === snapshot.view.version &&
        (nextOwn?.consentVersion ?? 0) < (own()?.consentVersion ?? 0))
    )
      return false;
    publish({ view: next });
    return true;
  };
  const reread = async () => {
    const result = await read();
    return result.kind === 'found' && adopt(result.view);
  };
  const command = (): ConsentCommand | null => {
    const participant = own();
    if (
      !participant ||
      participant.kind !== 'human' ||
      participant.role === 'judge'
    )
      return null;
    return {
      type: desired ? 'ready' : 'unready',
      commandId: nextId(),
      expectedVersion: snapshot.view.version,
      expectedConsentVersion: participant.consentVersion,
    };
  };
  const recoverConflict = async (
    result: Awaited<ReturnType<typeof submitAssembly>>,
    attempt: number,
  ) =>
    result.kind === 'refused' &&
    (result.reason === 'version-conflict' ||
      result.reason === 'consent-conflict') &&
    attempt < 2 &&
    (await reread());
  const hasIntent = () =>
    !disposed && desired !== null && desired !== effective();
  const acknowledge = (
    result: Awaited<ReturnType<typeof submitAssembly>>,
    revision: number,
  ) => {
    if (result.kind !== 'accepted' || !adopt(result.view)) return false;
    return !hasIntent() || (own()?.consentVersion ?? revision) > revision;
  };
  const execute = async () => {
    let conflicts = 0;
    try {
      while (hasIntent()) {
        const intent = command();
        if (!intent) break;
        const result = await send(intent);
        if (acknowledge(result, intent.expectedConsentVersion)) continue;
        if (await recoverConflict(result, conflicts++)) continue;
        publish({ problem: true });
        return;
      }
      if (!disposed) {
        desired = null;
        publish({ pending: false, problem: false });
      }
    } catch {
      if (!disposed) publish({ problem: true });
    }
  };
  const drive = () => {
    if (running) return running;
    running = execute().finally(() => {
      running = null;
    });
    return running;
  };
  const intent = (ready: boolean) => {
    desired = ready;
    publish({ pending: true, problem: false });
    return drive();
  };
  return {
    readSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateView(next: RoomView) {
      if (disposed || !adopt(next)) return;
      if (!snapshot.devicesPassed && effective()) void intent(false);
    },
    devices(passed: boolean) {
      if (disposed) return Promise.resolve();
      publish({ devicesPassed: passed });
      return !passed && (effective() || desired === true || snapshot.pending)
        ? intent(false)
        : Promise.resolve();
    },
    ready() {
      return !disposed && snapshot.devicesPassed && !snapshot.pending
        ? intent(true)
        : Promise.resolve();
    },
    unready() {
      return disposed ? Promise.resolve() : intent(false);
    },
    async retry() {
      if (disposed || running) return;
      publish({ pending: true, problem: false });
      try {
        if (!(await reread())) {
          publish({ problem: true });
          return;
        }
        if (!snapshot.devicesPassed) desired = false;
        await drive();
      } catch {
        publish({ problem: true });
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
