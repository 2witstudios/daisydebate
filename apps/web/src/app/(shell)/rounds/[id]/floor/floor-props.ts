import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
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
/** Optional chat discovery must not take down a competitive room or its results. */
export async function floorProps(
  roundId: string,
  actorId: string,
  socketUrl: string | null,
  terminal = false,
  required = false,
): Promise<FloorChatProps | null> {
  try {
    const response = await discoverFloor(roundId);
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw createAppError('INFRASTRUCTURE');
    const value = parseContextChatDiscovery(
      roundFloorContext,
      await response.json(),
      roundId,
    );
    if (!value) throw createAppError('INFRASTRUCTURE');
    return liveFloorProps(
      roundId,
      actorId,
      socketUrl ?? response.headers.get('x-realtime-socket-url'),
      value.channel?.readOnly ?? terminal,
    );
  } catch (error) {
    if (required) throw error;
    return null;
  }
}
