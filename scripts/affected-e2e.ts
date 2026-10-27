/** Ownership is exhaustive; new/unknown inputs conservatively retain the full suite. */
const auth = [
  'packages/auth/',
  'apps/web/src/features/auth/',
  'apps/web/src/ui/auth/',
];
const room = ['apps/web/src/features/rooms/', 'apps/web/src/ui/rooms/'];
const round = ['apps/web/src/features/round-', 'apps/web/src/ui/debate-room/'];
const media = [
  'packages/media/',
  'apps/web/src/features/media/',
  'apps/web/src/ui/media/',
];
const theme = ['apps/web/src/features/theme/', 'apps/web/src/ui/theme/'];
const realtime = ['apps/realtime/', 'apps/web/src/features/realtime/'];
const messaging = [
  'apps/web/src/features/messaging/',
  'apps/web/src/ui/messaging/',
];
export const browserOwners: Readonly<Record<string, readonly string[]>> = {
  'app.e2e.ts': ['apps/web/src/ui/dashboard/'],
  'shell.e2e.ts': ['apps/web/src/ui/shell/'],
  'csp.e2e.ts': auth,
  'journey.e2e.ts': auth,
  'journey-no-js.e2e.ts': auth,
  'onboarding.e2e.ts': auth,
  'onboarding-accessibility.e2e.ts': auth,
  'form-transport.e2e.ts': auth,
  'answer-focus.e2e.ts': auth,
  'passkey-lifecycle.e2e.ts': auth,
  'email-change-and-sessions.e2e.ts': auth,
  'accessibility.e2e.ts': auth,
  'headings.e2e.ts': auth,
  'auth-routes.e2e.ts': auth,
  'csp-confirm.e2e.ts': auth,
  'passkey-autofill.e2e.ts': auth,
  'theme.e2e.ts': theme,
  'visual.e2e.ts': [...theme, ...auth],
  'device-checks.e2e.ts': [...room, ...media],
  'media-navigation.e2e.ts': [...room, ...media],
  'hero-join.e2e.ts': room,
  'lobby.e2e.ts': room,
  'room-accounts.e2e.ts': [...room, ...auth],
  'realtime-connection-store.e2e.ts': realtime,
  'round-clock-csp.e2e.ts': round,
  'stall-evidence.e2e.ts': round,
  'room-launch.e2e.ts': room,
  'ballot.e2e.ts': round,
  'round-journeys.e2e.ts': round,
  'attendance.e2e.ts': round,
  'round-media.e2e.ts': [...round, ...media],
  'debate-room.e2e.ts': round,
  'round-commands.e2e.ts': round,
  'round-command-recovery.e2e.ts': round,
  'realtime-room-delivery.e2e.ts': [...room, ...realtime],
  'messaging-realtime.e2e.ts': [...messaging, ...realtime],
  'friends.e2e.ts': [...messaging, ...realtime, 'apps/web/src/ui/friends/'],
};
// Realtime profiles remain complete one-file proofs.
const native = new Set(
  [
    'room-launch',
    'ballot',
    'round-journeys',
    'attendance',
    'round-media',
    'debate-room',
    'round-commands',
    'round-command-recovery',
    'realtime-room-delivery',
    'messaging-realtime',
  ].map((name) => `${name}.e2e.ts`),
);
const launch = [...native].filter((spec) => !spec.includes('realtime'));
const standard = Object.keys(browserOwners).filter((spec) => !native.has(spec));
const smoke = [
  'app.e2e.ts',
  'journey-no-js.e2e.ts',
  'csp.e2e.ts',
  'shell.e2e.ts',
];

export function selectBrowserSpecs(
  files: readonly string[],
  event: string,
  enforced: boolean,
) {
  const matches = (file: string, spec: string, owners: readonly string[]) =>
    file === `apps/web/e2e/${spec}` ||
    owners.some((owner) => file.startsWith(owner));
  const known = (file: string) =>
    Object.entries(browserOwners).some(([spec, owners]) =>
      matches(file, spec, owners),
    );
  const full =
    event !== 'pull_request' ||
    !enforced ||
    files.length === 0 ||
    files.some((file) => !known(file));
  const specs = full
    ? standard
    : standard.filter(
        (spec) =>
          smoke.includes(spec) ||
          files.some((file) => matches(file, spec, browserOwners[spec])),
      );
  const nativeFull =
    full ||
    files.some((file) =>
      [...auth, ...room, ...realtime, ...messaging].some((prefix) =>
        file.startsWith(prefix),
      ),
    );
  const nativeSpecs = nativeFull
    ? launch
    : launch.filter(
        (spec) =>
          spec === 'room-launch.e2e.ts' ||
          files.some((file) => matches(file, spec, browserOwners[spec])),
      );
  return {
    nativeSpecs,
    mode: full ? 'full' : 'affected',
    specs,
    excluded: standard.filter((spec) => !specs.includes(spec)),
  };
}

type Rule = {
  type: string;
  parameters?: {
    required_status_checks?: { context: string; integration_id: number }[];
  };
};
export function queueEnforced(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const rules = value as readonly Rule[];
  const checks = rules.flatMap((rule) =>
    rule.type === 'required_status_checks'
      ? (rule.parameters?.required_status_checks ?? [])
      : [],
  );
  return (
    rules.some((rule) => rule.type === 'merge_queue') &&
    ['CI gate', 'Playwright E2E', 'Isolated Room Launch E2E'].every((name) =>
      checks.some(
        (check) => check.context === name && check.integration_id === 15368,
      ),
    ) &&
    checks.some(
      (check) =>
        check.context === 'review-record' && check.integration_id === 5049967,
    )
  );
}
