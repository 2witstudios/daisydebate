import { messagingTypingSchemas } from '@daisy/protocol';
/** Shared browser readers/writers bind the strict wire result to their exact channel under CSP. */
export async function readTypingResponse(
  channelId: string,
  response: Promise<Response>,
) {
  try {
    const value = await response;
    if (!value.ok) return null;
    const parsed = messagingTypingSchemas.result.safeParse(await value.json(), {
      jitless: true,
    });
    return parsed.success && parsed.data.channelId === channelId
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
