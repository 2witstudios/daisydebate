import { isNamedSeat, type RoomCommand, type RoomView } from '@daisy/protocol';
import type { RoomRead } from './read-assembly';
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
  readonly read: () => Promise<RoomRead>;
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
  // A Ready whose answer was lost may have committed; the view cannot say yet.
  let readyUnconfirmed = false;
  let heldPass = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const own = () =>
    snapshot.view.participants
      .filter(isNamedSeat)
      .find((p) => p.actorId === actorId);
  const effective = () => own()?.ready === 'ready';
  const publish = (patch: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const reportProblem = () => {
    if (!disposed && snapshot.view.capabilities.canReady)
      publish({ problem: true });
  };
  const adopt = (next: RoomView) => {
    const nextOwn = next.participants
      .filter(isNamedSeat)
      .find((p) => p.actorId === actorId);
    if (
      next.id !== view.id ||
      next.version < snapshot.view.version ||
      next.changeVersion < snapshot.view.changeVersion ||
      (next.version === snapshot.view.version &&
        (nextOwn?.consentVersion ?? 0) < (own()?.consentVersion ?? 0))
    )
      return false;
    if (!next.capabilities.canReady) desired = null;
    publish({
      view: next,
      ...(!next.capabilities.canReady
        ? { pending: false, problem: false }
        : {}),
    });
    return true;
  };
  const reread = async () => {
    const result = await read();
    if (result.kind !== 'found' || !adopt(result.view)) return false;
    readyUnconfirmed = false;
    return true;
  };
  const command = (): ConsentCommand | null => {
    const participant = own();
    if (
      !snapshot.view.capabilities.canReady ||
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
      ...(desired && snapshot.view.captureNotice
        ? { noticeVersion: snapshot.view.captureNotice.version }
        : {}),
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
    !disposed &&
    snapshot.view.capabilities.canReady &&
    desired !== null &&
    desired !== effective();
  const acknowledge = (
    result: Awaited<ReturnType<typeof submitAssembly>>,
    revision: number,
  ) => {
    if (result.kind !== 'accepted' || !adopt(result.view)) return false;
    return !hasIntent() || (own()?.consentVersion ?? revision) > revision;
  };
  const submit = async (intent: ConsentCommand) => {
    if (intent.type === 'ready') readyUnconfirmed = true;
    const result = await send(intent);
    if (result.kind !== 'unavailable') readyUnconfirmed = false;
    return result;
  };
  const execute = async () => {
    let conflicts = 0;
    try {
      if (desired === false && readyUnconfirmed && !(await reread())) {
        reportProblem();
        return;
      }
      while (hasIntent()) {
        const intent = command();
        if (!intent) break;
        const result = await submit(intent);
        if (!snapshot.view.capabilities.canReady) break;
        if (acknowledge(result, intent.expectedConsentVersion)) continue;
        if (await recoverConflict(result, conflicts++)) continue;
        reportProblem();
        return;
      }
      if (!disposed) {
        desired = null;
        publish({ pending: false, problem: false });
      }
    } catch {
      reportProblem();
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
    if (!snapshot.view.capabilities.canReady) return Promise.resolve();
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
      if (effective()) readyUnconfirmed = false;
      // Any unacknowledged withdrawal retries. A Ready this tab owes no
      // withdrawal for, made in another tab, is not its to take back.
      if (desired === false && !snapshot.devicesPassed && effective())
        void intent(false);
    },
    /** `invalidated`: the device check reported a reasoned loss, not a re-check. */
    devices(passed: boolean, invalidated = false) {
      if (disposed) return Promise.resolve();
      // Only a pass this tab held can be lost. A tab that never passed (a new
      // tab, a reload) knows nothing against a standing Ready: it fences its own
      // Start and leaves the consent alone. Re-checking a working device says
      // nothing yet: its own failure arrives as a reasoned invalidation.
      const lost = heldPass && !passed && invalidated;
      if (passed) heldPass = true;
      else if (lost) heldPass = false;
      publish({ devicesPassed: passed });
      return lost && (effective() || desired === true || snapshot.pending)
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
      if (disposed || running || !snapshot.view.capabilities.canReady) return;
      publish({ pending: true, problem: false });
      try {
        if (!(await reread())) {
          reportProblem();
          return;
        }
        if (!snapshot.devicesPassed) desired = false;
        await drive();
      } catch {
        reportProblem();
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
