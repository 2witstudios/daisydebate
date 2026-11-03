import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Step = {
  id?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
export type Job = {
  'runs-on': string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
};
export type Workflow = {
  on: Record<string, { inputs?: Record<string, { required?: boolean }> }>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

const path = '.github/workflows/rebaseline-visuals.yml';
export const read = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
export const workflow = Bun.YAML.parse(read(path)) as Workflow;

/**
 * Runs one workflow step's script with stub commands first on its PATH, over a
 * scratch folder that `setup` fills and `readBack` reads.
 */
export const runStep = <T>(
  step: Step,
  setup: (dir: string) => {
    stubs: Record<string, string>;
    env: Record<string, string>;
  },
  readBack: (dir: string) => T,
) => {
  const dir = mkdtempSync(join(tmpdir(), 'rebaseline-step-'));
  try {
    const { stubs, env } = setup(dir);
    for (const [name, script] of Object.entries(stubs)) {
      writeFileSync(join(dir, name), `#!/bin/sh\n${script}\n`);
      chmodSync(join(dir, name), 0o755);
    }
    const run = Bun.spawnSync(['bash', '-c', step.run!], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'owner/daisy',
        ...env,
      },
    });
    return { ok: run.exitCode === 0, ...readBack(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
