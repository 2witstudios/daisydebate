import {
  ENVELOPE_VERSION,
  observationBaseKey,
  observationJsonBytes,
  observationOverlaySchema,
  type ObservationBase,
  type ObservationOverlay,
} from '@daisy/protocol';
import type { ObservationBinding } from '@daisy/db/observation';
import {
  createObservationPermit,
  type ObservationPermit,
} from './observation-permit';
import type { ObservationAuthorityReadResult } from './observation-authority';
import { createObservationAuthorityScheduler } from './observation-authority-scheduler';
import type { ObservationSnapshot } from './observation-node';
import {
  bindingKey,
  detach,
  encodeObservationSnapshot,
  evidenceExpiry,
  state,
  type Outbound,
  type Principal,
  type Recipient,
  type Request,
} from './observation-frames';

type Binding = {
  readonly key: string;
  readonly input: ObservationBinding;
  readonly permit: ObservationPermit;
  readonly recipients: Set<Recipient>;
  base: ObservationBase | null;
  /** Actor-private facts from the latest canonical read; never shared. */
  overlay: ObservationOverlay;
  overlayBytes: number;
  retryAt: number;
};
type AuthorityRead = (
  bindings: readonly ObservationBinding[],
) => Promise<readonly ObservationAuthorityReadResult[]>;
const renewWithinMs = 2500,
  retryAfterMs = 1000,
  maxBindings = 5000;

/** Socket observation lifecycle. Identical session bindings coalesce on the
 * node; node fanout exists only while a current permit exists. Content
 * never triggers or extends authority.
 */
export function createObservationSessions({
  now,
  nodeIncarnation,
  authority,
  node,
  maxPerSession,
  overlayBudgetBytes = 32 * 1024 * 1024,
}: {
  readonly now: () => number;
  readonly nodeIncarnation: string;
  readonly authority: {
    readonly admit: AuthorityRead;
    readonly renew: AuthorityRead;
  };
  readonly node: {
    readonly observe: (
      base: ObservationBase,
      permit: ObservationPermit,
      send: (snapshot: ObservationSnapshot) => unknown,
    ) => () => void;
  };
  readonly maxPerSession: number;
  /** Bytes of actor-private overlays one node retains across bindings. */
  readonly overlayBudgetBytes?: number;
}) {
  const bindings = new Map<string, Binding>();
  let closed = false,
    overlayBytes = 0;
  function attach(binding: Binding, recipient: Recipient) {
    const base = binding.base!;
    detach(recipient);
    const generation = ++recipient.generation;
    recipient.base = base;
    // A new request generation starts without an overlay on the client.
    recipient.overlaySent = 'null';
    return () => {
      recipient.release = node.observe(base, binding.permit, (snapshot) => {
        if (recipient.closed || recipient.generation !== generation) return;
        recipient.outbound.sendText(
          encodeObservationSnapshot(recipient.request.id, generation, snapshot),
        );
      });
    };
  }
  /** Ready precedes node attachment so a baseline never outruns its permit frame. */
  function ready(binding: Binding, recipient: Recipient) {
    const grant = binding.permit.grant();
    if (!grant || !binding.base || recipient.closed) return false;
    const validForMs = Math.min(
      4900,
      Math.floor(evidenceExpiry(grant) - now()),
    );
    if (!(validForMs >= 1)) return false;
    const rebind =
      recipient.base === null ||
      observationBaseKey(recipient.base) !== observationBaseKey(binding.base);
    const install = rebind ? attach(binding, recipient) : () => {};
    // The overlay travels only when it changed for this request generation.
    const overlayKey = JSON.stringify(binding.overlay);
    const overlayChanged = overlayKey !== recipient.overlaySent;
    recipient.overlaySent = overlayKey;
    recipient.outbound.send({
      v: ENVELOPE_VERSION,
      type: 'observation.ready',
      id: recipient.request.id,
      generation: recipient.generation,
      base: binding.base,
      minimumContentRevision: grant.minimumContentRevision,
      validForMs,
      ...(overlayChanged ? { overlay: binding.overlay } : {}),
    });
    install();
    return true;
  }
  function hide(binding: Binding, value: 'denied' | 'unavailable') {
    for (const recipient of binding.recipients) {
      detach(recipient);
      state(recipient, value);
    }
  }
  /** Retained overlays share one node budget; past it an overlay degrades to
   * none rather than growing memory with bindings. */
  function retainOverlay(binding: Binding, value: unknown) {
    const parsed = observationOverlaySchema.safeParse(value);
    const bytes = parsed.success ? observationJsonBytes(parsed.data) : 0;
    const fits =
      overlayBytes - binding.overlayBytes + bytes <= overlayBudgetBytes;
    overlayBytes -= binding.overlayBytes;
    binding.overlay = parsed.success && fits ? parsed.data : null;
    binding.overlayBytes = parsed.success && fits ? bytes : 0;
    overlayBytes += binding.overlayBytes;
  }
  function drop(binding: Binding) {
    overlayBytes -= binding.overlayBytes;
    binding.overlayBytes = 0;
    if (bindings.get(binding.key) === binding) bindings.delete(binding.key);
    scheduler.forget(binding);
    binding.permit.invalidate();
    for (const recipient of binding.recipients) {
      detach(recipient);
      recipient.forget();
    }
    binding.recipients.clear();
  }
  function admitted(
    binding: Binding,
    attempt: ReturnType<ObservationPermit['begin']>,
    result: Extract<ObservationAuthorityReadResult, { status: 'allowed' }>,
  ) {
    if (!binding.permit.install(attempt, result.grant)) return false;
    // An unbounded overlay degrades actor-private extras, never shared delivery.
    retainOverlay(binding, result.overlay);
    binding.base = result.grant.base;
    binding.retryAt = 0;
    for (const recipient of binding.recipients)
      if (!ready(binding, recipient)) state(recipient, 'unavailable');
    return true;
  }
  function settle(
    binding: Binding,
    attempt: ReturnType<ObservationPermit['begin']>,
    result: ObservationAuthorityReadResult | undefined,
  ) {
    if (bindings.get(binding.key) !== binding || !binding.recipients.size)
      return drop(binding);
    if (result?.status === 'denied') {
      hide(binding, 'denied');
      return drop(binding);
    }
    if (result?.status === 'allowed' && admitted(binding, attempt, result))
      return;
    // Infrastructure uncertainty is unavailable, never denial; interest survives.
    binding.retryAt = now() + retryAfterMs;
    if (binding.permit.grant()) return;
    binding.base = null;
    hide(binding, 'unavailable');
  }
  /** Hide now, refuse every in-flight result, and readmit from fresh facts. */
  function fence(binding: Binding) {
    binding.permit.invalidate();
    binding.base = null;
    binding.retryAt = 0;
    hide(binding, 'unavailable');
    scheduler.admit(binding);
  }
  const scheduler = createObservationAuthorityScheduler<Binding>({
    now,
    authority,
    settle,
  });
  function bind(principal: Principal, request: Request) {
    const key = bindingKey(principal, request);
    const existing = bindings.get(key);
    if (existing || bindings.size >= maxBindings) return existing ?? null;
    const binding: Binding = {
      key,
      input: { principal, resource: request.resource, window: request.window },
      permit: createObservationPermit({ now, nodeIncarnation }),
      recipients: new Set(),
      base: null,
      overlay: null,
      overlayBytes: 0,
      retryAt: 0,
    };
    bindings.set(key, binding);
    return binding;
  }
  function release(principal: Principal, recipient: Recipient) {
    detach(recipient);
    const binding = bindings.get(bindingKey(principal, recipient.request));
    if (!binding?.recipients.delete(recipient)) return;
    if (!binding.recipients.size) drop(binding);
  }
  function connect(principal: Principal, outbound: Outbound) {
    const recipients = new Map<string, Recipient>();
    let ended = false;
    function unobserve(request: Request) {
      const key = bindingKey(principal, request);
      for (const [id, recipient] of recipients)
        if (bindingKey(principal, recipient.request) === key) {
          recipients.delete(id);
          release(principal, recipient);
        }
    }
    function observe(request: Request) {
      if (ended || closed) return;
      unobserve(request);
      const recipient: Recipient = {
        outbound,
        request,
        generation: 0,
        base: null,
        closed: false,
        overlaySent: 'null',
        release: () => {},
        forget: () => {
          if (recipients.get(request.id) === recipient)
            recipients.delete(request.id);
        },
      };
      const binding =
        recipients.size < maxPerSession ? bind(principal, request) : null;
      if (!binding) return state(recipient, 'unavailable');
      binding.recipients.add(recipient);
      recipients.set(request.id, recipient);
      if (binding.permit.grant() && ready(binding, recipient)) return;
      if (scheduler.admit(binding)) return;
      state(recipient, 'unavailable');
      recipients.delete(request.id);
      release(principal, recipient);
    }
    return {
      observe,
      unobserve,
      close() {
        if (ended) return;
        ended = true;
        for (const recipient of recipients.values()) {
          recipient.closed = true;
          release(principal, recipient);
        }
        recipients.clear();
      },
    };
  }
  return {
    connect,
    /** Driven by a bounded interval: early renewal plus unavailable retries. */
    renewDue() {
      if (closed) return;
      const at = now();
      const due: Binding[] = [];
      for (const binding of bindings.values()) {
        if (scheduler.pending(binding) || at < binding.retryAt) continue;
        const grant = binding.permit.grant();
        if (!grant) scheduler.admit(binding);
        else if (evidenceExpiry(grant) - at <= renewWithinMs) due.push(binding);
      }
      scheduler.renew(due);
    },
    /** A durable session revocation fences that session's (or actor's) bindings. */
    revokeSession(actorId: string, sessionId: string | null) {
      for (const binding of bindings.values()) {
        const { principal } = binding.input;
        if (
          principal.actorId === actorId &&
          (sessionId === null || principal.sessionId === sessionId)
        )
          fence(binding);
      }
    },
    stats: () => ({ bindings: bindings.size, ...scheduler.stats() }),
    settled: () => scheduler.settled(),
    close() {
      if (closed) return;
      closed = true;
      scheduler.close();
      for (const binding of [...bindings.values()]) {
        hide(binding, 'unavailable');
        drop(binding);
      }
    },
  };
}
