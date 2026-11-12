import { createElement } from 'react';
import { testChatContext } from '../../features/messaging/context-chat/chat-context.test-support';
import { useContextChat, type ContextChatProps } from './use-context-chat';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

type Held = ReturnType<typeof useContextChat>;

/** Renders what the hook holds, and hands the test its actions. */
export function ContextChatProbe(
  props: ContextChatProps & { readonly hold: (held: Held) => void },
) {
  const { hold, ...chat } = props;
  const held = useContextChat({ ...chat, context: testChatContext });
  hold(held);
  return createElement(
    'output',
    null,
    JSON.stringify({
      state: held.state.kind,
      readOnly:
        held.state.kind === 'ready' ? held.state.metadata.readOnly : null,
      paging: held.paging,
      notice: held.notice,
    }),
  );
}
