import type {
  MessagingAuthorizationFence,
  MessagingChannelStore,
} from './records';
type MessagingDmDecision = 'accept' | 'decline' | 'cancel';
export type MessagingDmFence = (
  capability: 'read' | 'decide' | 'cancel' | 'result',
) => MessagingAuthorizationFence;
type Receipt = {
  readonly kind: string;
  readonly digest: string | null;
  readonly channelId: string | null;
};
type Decision = {
  readonly requestId: string;
  readonly decision: MessagingDmDecision;
};
export type MessagingDmFrame = {
  readDecisionState(command: Decision): Promise<{
    readonly channelId: string;
    readonly state: string;
    readonly requestedAt: string;
    readonly receipt: Receipt | null;
  }>;
  commitDecision(
    command: Decision & { readonly digest: string; readonly now: string },
  ): Promise<{
    readonly channelId: string;
    readonly state: 'accepted' | 'declined' | 'cancelled';
  }>;
};
export type MessagingDmStore = {
  /** The request preview under the shared fences (MSG-2.1-arch1). */
  readRequest(
    input: Parameters<MessagingChannelStore['withChannel']>[0],
  ): Promise<{
    readonly channelId: string;
    readonly senderActorId: string;
    readonly introduction: string | null;
    readonly requestedAt: string;
  }>;
  withChannel<T>(
    input: Parameters<MessagingChannelStore['withChannel']>[0],
    work: (frame: MessagingDmFrame) => Promise<T>,
  ): Promise<T>;
};
