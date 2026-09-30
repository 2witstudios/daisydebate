/**
 * What the hand-run proof scripts (`bun proof:test-redis`,
 * `bun proof:test-postgres`) share: numbered PASS/FAIL steps and an exit code
 * that fails when any step did.
 */
export function proofSteps() {
  const failures: string[] = [];
  return {
    check: (ok: boolean, what: string) => {
      process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${what}\n`);
      if (!ok) failures.push(what);
    },
    /** Prints the verdict and exits non-zero when any step failed. */
    finish: () => {
      if (failures.length > 0) {
        process.stderr.write(`\n${failures.length} proof step(s) failed\n`);
        process.exit(1);
      }
      process.stdout.write('\nall proof steps passed\n');
    },
  };
}
