import {
  browserProofClaimProblems,
  readBrowserProofSources,
  type BrowserRegistration,
} from './browser-evidence-registration';

/** Existing paired Room proof contract; extraction changes no runner or suite claims. */
export function roomLaunchClaimProblems(input: BrowserRegistration) {
  return browserProofClaimProblems(input, {
    label: 'Launch',
    runnerPath: 'e2e/support/room-launch-runner.ts',
    configPath: 'e2e/support/room-launch-config.ts',
    command: 'test:e2e:room-launch',
    suites: ['**/room-launch.e2e.ts', '**/debate-room.e2e.ts'],
  });
}

export async function loadRoomLaunchClaimProblems({
  read,
  rootScripts,
  webScripts,
  workflow,
}: {
  readonly read: (path: string) => Promise<string | undefined>;
  readonly rootScripts: Readonly<Record<string, string>>;
  readonly webScripts: Readonly<Record<string, string>>;
  readonly workflow: string;
}) {
  const [defaultConfig, dedicatedConfig, runner] =
    await readBrowserProofSources(read, [
      'apps/web/playwright.config.ts',
      'apps/web/e2e/support/room-launch-config.ts',
      'apps/web/e2e/support/room-launch-runner.ts',
    ]);
  return roomLaunchClaimProblems({
    rootScript: rootScripts['test:e2e:room-launch'] ?? '',
    webScript: webScripts['test:e2e:room-launch'] ?? '',
    defaultConfig: defaultConfig!,
    dedicatedConfig: dedicatedConfig!,
    runner: runner!,
    workflow,
  });
}
