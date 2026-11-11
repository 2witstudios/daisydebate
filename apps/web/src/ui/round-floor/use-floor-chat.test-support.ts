import { createElement } from 'react';
import { useFloorChat, type FloorChatProps } from './use-floor-chat';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

type Held = ReturnType<typeof useFloorChat>;

/** Renders what the hook holds, and hands the test its actions. */
export function FloorProbe(
  props: FloorChatProps & { readonly hold: (held: Held) => void },
) {
  const { hold, ...chat } = props;
  const held = useFloorChat(chat);
  hold(held);
  return createElement(
    'output',
    null,
    JSON.stringify({
      state: held.state.kind,
      readOnly:
        held.state.kind === 'ready' ? held.state.metadata.readOnly : null,
      paging: held.paging,
    }),
  );
}
