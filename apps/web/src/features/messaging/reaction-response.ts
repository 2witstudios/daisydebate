import { realtimePublicUrlSchema } from '@daisy/config';
import { z } from 'zod';
import { createMessagingReactionSchemas } from '@daisy/protocol';
/** The reaction page accepts only the requested current aggregate and explicit deployment choices. */
export async function readReactionResponse(
  response: Response,
  channelId: string,
  messageId: string,
) {
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    const policy = z
      .strictObject({
        reactionUnits: z.number().int().positive().safe(),
        choices: z.array(z.string()).nonempty(),
      })
      .parse(z.object({ policy: z.unknown() }).parse(body).policy);
    const schemas = createMessagingReactionSchemas(policy);
    const parsed = schemas.result
      .extend({ policy: z.unknown() })
      .safeParse(body);
    if (
      !parsed.success ||
      parsed.data.channelId !== channelId ||
      parsed.data.messageId !== messageId
    )
      return null;
    const endpoint = response.headers.get('x-realtime-socket-url');
    return {
      result: parsed.data,
      policy,
      socketUrl:
        endpoint === null ? null : realtimePublicUrlSchema.parse(endpoint),
    };
  } catch {
    return null;
  }
}
