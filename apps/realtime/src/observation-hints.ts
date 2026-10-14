import type { ObservationBinding } from '@daisy/db/observation';
import type {
  Outbound,
  SessionBinding,
  TypingHint,
} from './observation-frames';

/** A lossy resource hint (typing) reaches each socket that observes the
 * resource under a current permit, once; it carries no content and needs no
 * authority read of its own. */
export function deliverObservationHint(
  bindings: Iterable<SessionBinding>,
  resource: ObservationBinding['resource'],
  frame: TypingHint,
) {
  const reached = new Set<Outbound>();
  for (const binding of bindings) {
    const observed = binding.input.resource;
    if (
      observed.kind !== resource.kind ||
      observed.id !== resource.id ||
      !binding.permit.current()
    )
      continue;
    for (const recipient of binding.recipients)
      if (!recipient.closed && !reached.has(recipient.outbound)) {
        reached.add(recipient.outbound);
        recipient.outbound.send(frame);
      }
  }
}
