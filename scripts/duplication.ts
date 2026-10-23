// The copy-paste gate (ADR 0026): the source scan, then the test scan. Both
// always run and report, so a red source scan never hides test clones
// (ISSUE-483); the gate fails if either found a clone not in its baseline.
const scans: readonly (readonly string[])[] = [
  [],
  ['--config', '.jscpd-tests.json'],
];

export async function runDuplicationScans(
  run: (args: readonly string[]) => Promise<number>,
): Promise<number> {
  const exits: number[] = [];
  for (const args of scans) exits.push(await run(args));
  return exits.every((code) => code === 0) ? 0 : 1;
}

if (import.meta.main)
  process.exit(
    await runDuplicationScans(
      (args) =>
        Bun.spawn(['bunx', '--bun', 'jscpd', ...args], {
          stdio: ['inherit', 'inherit', 'inherit'],
        }).exited,
    ),
  );
