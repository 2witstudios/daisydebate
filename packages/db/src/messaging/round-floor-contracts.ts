import type { RoundFloorFact } from '@daisy/protocol/round-floor';
import type {
  ContextChannelAuthority,
  ContextChannelReadFrame,
  ContextChannelWriteFrame,
} from './context-channel-contracts';
export type RoundFloorScope = {
  readonly roundId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly actorId: string;
};
export type RoundFloorAuthority = Omit<
  ContextChannelAuthority<RoundFloorFact>,
  'scope'
> & { readonly scope: Omit<RoundFloorScope, 'channelId'> };
export type RoundFloorFence = (input: RoundFloorAuthority) => Promise<void>;
export type RoundFloorReadFrame = ContextChannelReadFrame<RoundFloorFact>;
export type RoundFloorWriteFrame = ContextChannelWriteFrame<RoundFloorFact>;
