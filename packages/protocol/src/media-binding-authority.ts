/** A signed media binding loses current seat authority when its identity retires or its human admission is withdrawn. */
export const mediaBindingRevoked = (
  participants: readonly {
    readonly id: string;
    readonly kind: 'human' | 'bot';
    readonly eligible: boolean;
  }[],
  participantId: string,
): boolean => {
  const seat = participants.find((person) => person.id === participantId);
  return seat === undefined || (seat.kind === 'human' && !seat.eligible);
};
