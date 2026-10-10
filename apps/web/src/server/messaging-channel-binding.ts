import type { Routes } from './routes';
import type { createRouteBinder } from './route-binding';
type ChannelReads = {
  readonly messaging: Pick<Routes['messaging'], 'typing' | 'preferences'>;
};
/** Both channel metadata routes receive the approved process binder; this module reaches no process globals. */
export function messagingChannelRead(
  bind: ReturnType<typeof createRouteBinder<ChannelReads>>,
  operation: 'typing' | 'preferences',
) {
  return (
    request: Request,
    context: { params: Promise<{ channelId: string }> },
  ) =>
    bind((routes) => async (incoming) => {
      const { channelId } = await context.params;
      return operation === 'typing'
        ? routes.messaging.typing(incoming, false, channelId)
        : routes.messaging.preferences(incoming, 'read', channelId);
    })(request);
}
