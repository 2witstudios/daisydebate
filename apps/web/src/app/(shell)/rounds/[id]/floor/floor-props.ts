import { systemId } from '@daisy/clock';
import { unavailableRead } from '../../../../../server/temporary-read';
import { parseContextChatDiscovery } from '../../../../../features/messaging/context-chat/view';
import { roundFloorContext } from '../../../../../features/messaging/round-floor/floor-context';
import type { FloorChatProps } from '../../../../../ui/round-floor/floor-chat';
import {
  discoverFloor,
  sendFloorMessageAction,
  mutateFloorMessageAction,
  reportFloorMessageAction,
} from './actions';
/** Props carry no authority or content; every client entry uses the canonical gate. */
export function liveFloorProps(
  roundId: string,
  actorId: string,
  socketUrl: string | null,
  readOnlyHint = false,
): FloorChatProps {
  return {
    roundId,
    actorId,
    socketUrl,
    requestId: systemId.next(),
    readOnlyHint,
    sendAction: sendFloorMessageAction.bind(null, roundId),
    mutateAction: mutateFloorMessageAction.bind(null, roundId),
    reportAction: reportFloorMessageAction.bind(null, roundId),
  };
}
/** Read the floor's current admission before rendering a dedicated chat page. */
export async function readFloorProps(
  roundId: string,
  actorId: string,
  socketUrl: string | null,
  terminal: boolean,
) {
  const response = await discoverFloor(roundId);
  if (response.status === 403 || response.status === 404)
    return { kind: 'missing' as const };
  if (!response.ok) return unavailableRead(response);
  const value = parseContextChatDiscovery(
    roundFloorContext,
    await response.json(),
    roundId,
  );
  if (!value) return { kind: 'unavailable' as const };
  return {
    kind: 'found' as const,
    props: liveFloorProps(
      roundId,
      actorId,
      socketUrl ?? response.headers.get('x-realtime-socket-url'),
      value.channel?.readOnly ?? terminal,
    ),
  };
}

/** Optional chat discovery must not take down a competitive room or its results. */
export async function floorProps(
  roundId: string,
  actorId: string,
  socketUrl: string | null,
  terminal: boolean,
): Promise<FloorChatProps | null> {
  try {
    const read = await readFloorProps(roundId, actorId, socketUrl, terminal);
    return read.kind === 'found' ? read.props : null;
  } catch {
    return null;
  }
}
