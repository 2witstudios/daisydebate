import type { Routes } from './routes';
type ChannelReads = {
  readonly messaging: Pick<Routes['messaging'], 'typing' | 'preferences'>;
};
type ChannelReadHandler = (request: Request) => Promise<Response>;
/** Both channel metadata routes receive the approved process binder; this module reaches no process globals. */
export function messagingChannelRead(
  bind: (
    pick: (routes: ChannelReads) => ChannelReadHandler,
  ) => ChannelReadHandler,
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
