import {
  bindingKey,
  state,
  type Outbound,
  type Principal,
  type Recipient,
  type Request,
  type SessionBinding,
} from './observation-frames';

/** One socket's observation requests. Identical session bindings coalesce on
 * the node; each request generation tracks its own recipient so a rebinding
 * never leaks snapshots across generations. */
export function createObservationConnection({
  principal,
  outbound,
  maxPerSession,
  isClosed,
  bind,
  ready,
  admit,
  release,
}: {
  readonly principal: Principal;
  readonly outbound: Outbound;
  readonly maxPerSession: number;
  readonly isClosed: () => boolean;
  readonly bind: (
    principal: Principal,
    request: Request,
  ) => SessionBinding | null;
  readonly ready: (binding: SessionBinding, recipient: Recipient) => boolean;
  readonly admit: (binding: SessionBinding) => boolean;
  readonly release: (principal: Principal, recipient: Recipient) => void;
}) {
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
    if (ended || isClosed()) return;
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
    if (admit(binding)) return;
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
