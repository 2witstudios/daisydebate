import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import type {
  ContextChannelAuthority,
  ContextChannelReadFrame,
  ContextChannelWriteFrame,
} from './context-channel-contracts';
export type RoomCommunityScope = {
  readonly roomId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly actorId: string;
};
type RoomCommunityAuthority = Omit<
  ContextChannelAuthority<RoomCommunityFact>,
  'scope'
> & { readonly scope: Omit<RoomCommunityScope, 'channelId'> };
export type RoomCommunityFence = (
  input: RoomCommunityAuthority,
) => Promise<void>;
export type RoomCommunityReadFrame = ContextChannelReadFrame<RoomCommunityFact>;
export type RoomCommunityWriteFrame =
  ContextChannelWriteFrame<RoomCommunityFact>;
