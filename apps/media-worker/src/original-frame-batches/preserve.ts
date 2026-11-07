import { createAppError } from '@daisy/errors';
import { isTransientControlFailure } from '@daisy/media/worker';
import {
  canonicalCaptureEvidenceBody,
  evidenceIngressReplySchema,
  type CaptureEvidenceBody,
} from '@daisy/protocol';
import { CAPTURE_OUTAGE_BUDGET_MS } from '../capture-memory';

/** Local admission only: a committed original payload is not permission to publish or proof of hearing. */
export async function preserve(
  input: {
    readonly bodies: readonly CaptureEvidenceBody[];
    readonly send: (
      body: CaptureEvidenceBody,
      signal: AbortSignal,
    ) => Promise<unknown>;
    readonly nowMs: () => number;
    readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
  },
  signal: AbortSignal,
): Promise<void> {
  // Own canonical snapshots: caller mutation cannot change a retry's original identity/body.
  const bodies = input.bodies.map((raw) => {
    const encoded = canonicalCaptureEvidenceBody(raw);
    if (encoded.kind !== 'encoded') throw createAppError('VALIDATION');
    return encoded.body;
  });
  const deadline = input.nowMs() + CAPTURE_OUTAGE_BUDGET_MS;
  for (const body of bodies) {
    for (;;) {
      signal.throwIfAborted();
      if (input.nowMs() >= deadline) throw createAppError('INFRASTRUCTURE');
      let raw: unknown;
      try {
        raw = await input.send(body, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (!isTransientControlFailure(error)) throw error;
        await input.waitUntilMs(
          Math.min(deadline, input.nowMs() + 250),
          signal,
        );
        continue;
      }
      signal.throwIfAborted();
      const parsed = evidenceIngressReplySchema.safeParse(raw);
      if (!parsed.success) throw createAppError('INVARIANT');
      const reply = parsed.data;
      if (reply.kind === 'refused') throw createAppError('CONFLICT');
      if (reply.evidenceId !== body.evidenceId)
        throw createAppError('INVARIANT');
      if (reply.kind === 'received') break;
      await input.waitUntilMs(Math.min(deadline, input.nowMs() + 250), signal);
    }
  }
}
