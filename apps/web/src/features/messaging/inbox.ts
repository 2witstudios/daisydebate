export type MessagingInboxEntry = {
  readonly channelId: string;
  readonly kind:
    | 'conversation'
    | 'group_conversation'
    | 'incoming_request'
    | 'outgoing_request'
    | 'incoming_invitation';
};
