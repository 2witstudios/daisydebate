import { attendanceReceiptSchema, idSchema } from '@daisy/protocol';
export type PublicCheckInProbeConfiguration = {
  readonly origin: string;
  readonly roundId: string;
  readonly segmentId: string;
  readonly participantId: string;
  readonly cookie: string;
};
/** Credentials enter only from the process edge; missing configuration remains unhealthy. */
export function createPublicCheckInProbe(input: {
  readonly configuration: PublicCheckInProbeConfiguration | null;
  readonly nextId: () => string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}): () => Promise<boolean> {
  const config = input.configuration;
  if (!config) return async () => false;
  const origin = new URL(config.origin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !config.cookie ||
    ![config.roundId, config.segmentId, config.participantId].every(
      (id) => idSchema.safeParse(id).success,
    )
  )
    throw new Error('Invalid public check-in probe configuration');
  return async () => {
    const commandId = input.nextId();
    try {
      const response = await input.fetch(
        `${origin.origin}/api/rounds/${config.roundId}/check-in`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(900),
          headers: {
            'content-type': 'application/json',
            origin: origin.origin,
            cookie: config.cookie,
          },
          body: JSON.stringify({
            version: 1,
            commandId,
            segmentId: config.segmentId,
          }),
        },
      );
      if (!response.ok) return false;
      const parsed = attendanceReceiptSchema.safeParse(await response.json());
      return (
        parsed.success &&
        parsed.data.commandId === commandId &&
        parsed.data.roundId === config.roundId &&
        parsed.data.segmentId === config.segmentId &&
        parsed.data.participantId === config.participantId
      );
    } catch {
      return false;
    }
  };
}
