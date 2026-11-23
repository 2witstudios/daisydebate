import type { composeMessagingRoutes } from './composition';
type ChannelReads = Pick<
  ReturnType<typeof composeMessagingRoutes>,
  'typing' | 'preferences'
>;
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
        ? routes.typing(incoming, false, channelId)
        : routes.preferences(incoming, 'read', channelId);
    })(request);
}
