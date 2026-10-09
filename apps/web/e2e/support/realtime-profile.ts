/** Closed dedicated proof profiles; the ordinary HTTP suite remains in the default runner. */
export function realtimeProofProfile(name: string | undefined) {
  switch (name) {
    case 'room':
      return {
        config: 'e2e/support/realtime-config.ts',
        spec: '**/realtime-room-delivery.e2e.ts',
        report: 'test-results/realtime-results.json',
      } as const;
    case 'messaging':
      return {
        config: 'e2e/support/messaging-realtime-config.ts',
        spec: '**/messaging-realtime.e2e.ts',
        report: 'test-results/messaging-realtime-results.json',
      } as const;
    default:
      throw new Error(
        'Realtime proof requires an explicit room or messaging profile',
      );
  }
}
