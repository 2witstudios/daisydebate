import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

test('native evidence survives an earlier prerequisite refusal without bypassing sanitization', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file('.github/workflows/e2e.yml').text(),
  ) as {
    jobs: Record<
      string,
      {
        steps: {
          id?: string;
          name?: string;
          if?: string;
          with?: Record<string, unknown>;
        }[];
      }
    >;
  };
  const steps = workflow.jobs['room-launch']!.steps;
  const sanitize = steps.findIndex((step) => step.id === 'sanitize_launch');
  const upload = steps.findIndex(
    (step) => step.name === 'Retain Launch evidence on success and failure',
  );
  assert({
    given:
      'a failed archive prerequisite followed by realtime artifacts, or no artifacts at all',
    should:
      'always sanitize existing evidence, publish only after success, and truthfully ignore an empty upload',
    actual: {
      sanitize: steps[sanitize]?.if,
      uploadAfterSanitize: upload > sanitize,
      uploadGuard: steps[upload]?.if,
      noFiles: steps[upload]?.with?.['if-no-files-found'],
      selectedReportGuard: steps.find(
        (step) =>
          step.name === 'Verify selected native specs produced outcomes',
      )?.if,
    },
    expected: {
      sanitize: '${{ always() && !cancelled() }}',
      uploadAfterSanitize: true,
      uploadGuard:
        "${{ always() && !cancelled() && steps.sanitize_launch.outcome == 'success' }}",
      noFiles: 'ignore',
      selectedReportGuard:
        "${{ always() && !cancelled() && (steps.launch.outcome == 'success' || steps.launch.outcome == 'failure') }}",
    },
  });
});

test('the real sanitizer CLI fails the upload gate for unscannable evidence', async () => {
  const {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    chmodSync,
    symlinkSync,
    rmSync,
    readFileSync,
  } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const parent = mkdtempSync(join(tmpdir(), 'daisy-launch-publication-'));
  const outside = join(parent, 'outside.log');
  const payload = 'token=synthetic-private-token';
  writeFileSync(outside, payload);
  const refusals: boolean[] = [];
  try {
    for (const mode of ['corrupt-zip', 'subtree', 'read', 'symlink'] as const) {
      const root = join(parent, mode);
      mkdirSync(root);
      const protectedPath = join(
        root,
        mode === 'subtree' ? 'private' : 'trace.log',
      );
      if (mode === 'corrupt-zip')
        writeFileSync(join(root, 'trace.zip'), payload);
      else if (mode === 'symlink') symlinkSync(outside, protectedPath);
      else if (mode === 'subtree') {
        mkdirSync(protectedPath);
        chmodSync(protectedPath, 0o000);
      } else {
        writeFileSync(protectedPath, payload);
        chmodSync(protectedPath, 0o000);
      }
      try {
        const child = Bun.spawnSync(
          ['bun', 'scripts/e2e-artifact-sanitizer.ts', root],
          { stdout: 'ignore', stderr: 'ignore', timeout: 10000 },
        );
        refusals.push(child.exitCode !== 0);
      } finally {
        if (mode === 'read' || mode === 'subtree')
          chmodSync(protectedPath, 0o755);
      }
    }
    const missing = Bun.spawnSync(
      ['bun', 'scripts/e2e-artifact-sanitizer.ts', join(parent, 'missing')],
      { stdout: 'pipe', stderr: 'ignore', timeout: 10000 },
    );
    assert({
      given:
        'real CLI corrupt/read/scan/symlink failures or a missing top root',
      should:
        'exit unsuccessfully for every unsafe upload and no-op only for absence without touching foreign data',
      actual: [
        refusals,
        missing.exitCode,
        missing.stdout.toString().includes('scanned 0 file(s)'),
        readFileSync(outside, 'utf8'),
      ],
      expected: [[true, true, true, true], 0, true, payload],
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
