import { isUnhealableProviderRefusal } from '@daisy/ai-voice';
import { publicationStopOf } from '@daisy/media/audio';

/**
 * The fixed cause a failed bot speech logs (ISSUE-1460): where a publish
 * stopped, or that the vendor refused the request itself, which no retry of
 * the same request can clear (a model that refuses its reasoning setting, an
 * unknown model). Anything else adds no cause: its error code says enough.
 */
export const speakingFailureCause = (
  error: unknown,
): 'connect' | 'handoff' | 'provider_refused' | undefined =>
  publicationStopOf(error) ??
  (isUnhealableProviderRefusal(error) ? 'provider_refused' : undefined);
