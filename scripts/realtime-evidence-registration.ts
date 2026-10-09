import {
  browserProofClaimProblems,
  readBrowserProofSources,
  type BrowserRegistration,
} from './browser-evidence-registration';

type Scripts = Readonly<Record<string, string>>;
type Registration = Omit<
  BrowserRegistration,
  'rootScript' | 'webScript' | 'dedicatedConfig'
> & {
  readonly rootScripts: Scripts;
  readonly webScripts: Scripts;
  readonly roomConfig: string;
  readonly messagingConfig: string;
};
export function realtimeClaimProblems(input: Registration) {
  return (['room', 'messaging'] as const).flatMap((profile) => {
    const room = profile === 'room';
    const command = room ? 'test:e2e:realtime' : 'test:e2e:messaging-realtime';
    return browserProofClaimProblems(
      {
        ...input,
        rootScript: input.rootScripts[command] ?? '',
        webScript: input.webScripts[command] ?? '',
        dedicatedConfig: room ? input.roomConfig : input.messagingConfig,
      },
      {
        label: `Realtime ${profile}`,
        command,
        companionCommands: [
          'test:e2e:room-launch',
          'test:e2e:realtime',
          'test:e2e:messaging-realtime',
        ],
        profile,
        runnerPath: 'e2e/support/realtime-runner.ts',
        configPath: room
          ? 'e2e/support/realtime-config.ts'
          : 'e2e/support/messaging-realtime-config.ts',
        suites: [
          room
            ? '**/realtime-room-delivery.e2e.ts'
            : '**/messaging-realtime.e2e.ts',
        ],
        outputDir: `test-results/${room ? 'realtime' : 'messaging-realtime'}`,
        reportCommand: `bun scripts/e2e-report-counts.ts apps/web/test-results/${room ? 'realtime' : 'messaging-realtime'}-results.json`,
      },
    );
  });
}

/** Existing evidence runner supplies its own checkout reads; no environment or services here. */
export async function loadRealtimeClaimProblems({
  read,
  rootScripts,
  webScripts,
  workflow,
}: {
  readonly read: (path: string) => Promise<string | undefined>;
  readonly rootScripts: Scripts;
  readonly webScripts: Scripts;
  readonly workflow: string;
}) {
  const [defaultConfig, roomConfig, messagingConfig, runner, profileSource] =
    await readBrowserProofSources(read, [
      'apps/web/playwright.config.ts',
      'apps/web/e2e/support/realtime-config.ts',
      'apps/web/e2e/support/messaging-realtime-config.ts',
      'apps/web/e2e/support/realtime-runner.ts',
      'apps/web/e2e/support/realtime-profile.ts',
    ]);
  return realtimeClaimProblems({
    rootScripts,
    webScripts,
    workflow,
    defaultConfig: defaultConfig!,
    roomConfig: roomConfig!,
    messagingConfig: messagingConfig!,
    runner: runner!,
    profileSource: profileSource!,
  });
}
