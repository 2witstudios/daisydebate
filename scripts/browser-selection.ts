/**
 * What one Browser E2E run executes. The workflow runs on main pushes, the
 * nightly schedule and manual dispatch, never on a PR (ADR 0098), and each of
 * those runs its whole inventory; only the browser projects differ.
 */

// Launch specs run in the Isolated Room Launch job; realtime specs are its
// complete one-file proofs. Everything else runs in the ordinary browser job.
const launch = [
  'room-launch',
  'resolution-strike',
  'ballot',
  'transcript-recovery',
  'round-journeys',
  'attendance',
  'round-media',
  'round-media-recovery',
  'round-media-source-isolation',
  'round-media-lifecycle',
  'round-timing-skew',
  'media-stage',
  'debate-room',
  'round-commands',
  'round-command-recovery',
  'round-notes-recovery',
].map((name) => `${name}.e2e.ts`);
const realtime = ['realtime-room-delivery', 'messaging-realtime'].map(
  (name) => `${name}.e2e.ts`,
);
export const nativeSpecs: readonly string[] = [...launch, ...realtime];

const visual = 'visual.e2e.ts';

export function selectBrowserSpecs(
  discovered: readonly string[],
  event: string,
) {
  // A main push runs Chromium alone, which has no visual project; the nightly
  // run and a dispatch keep every engine, mobile layout and visual.
  const chromiumOnly = event === 'push';
  const standard = discovered.filter((spec) => !nativeSpecs.includes(spec));
  const specs = standard.filter((spec) => !chromiumOnly || spec !== visual);
  return {
    nativeSpecs: launch,
    projectArgs: chromiumOnly ? ['--project=chromium'] : [],
    browsers: chromiumOnly ? 'chromium' : 'chromium firefox webkit',
    specs,
    excluded: standard.filter((spec) => !specs.includes(spec)),
  };
}
