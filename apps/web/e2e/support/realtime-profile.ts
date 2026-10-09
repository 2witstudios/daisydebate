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

/** The runner reads the selected config before spawning its real browser command. */
export function assertRealtimeProofConfig(
  profile: ReturnType<typeof realtimeProofProfile>,
  config: {
    readonly testMatch?: unknown;
    readonly outputDir?: unknown;
    readonly reporter?: unknown;
  },
) {
  const reporters = Array.isArray(config.reporter) ? config.reporter : [];
  const reported = reporters.some(
    (entry) =>
      Array.isArray(entry) &&
      entry[0] === 'json' &&
      entry[1]?.outputFile === profile.report,
  );
  if (
    config.testMatch !== profile.spec ||
    config.outputDir !== profile.report.replace('-results.json', '') ||
    !reported
  )
    throw new Error(
      'Realtime proof config does not preserve its exact suite and artifacts',
    );
}
