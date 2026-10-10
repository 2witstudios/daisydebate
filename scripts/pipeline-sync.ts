#!/usr/bin/env bun
/** Explicit distribution of versioned pipeline sources to local skills and Daisy Library. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  canonicalPipeline as canonical,
  retirePipelineReference,
  withPipelineFiles,
  installPipelineSkill,
  pipelineSkillNeedsInstall,
} from './pipeline-sync-files';

const root = resolve(import.meta.dir, '..');
const targets = JSON.parse(
  readFileSync(join(root, 'policy/agent-pipeline/targets.json'), 'utf8'),
) as {
  pages: { id: string; source: string }[];
  skills: string[];
  retiredTaskReferences: string[];
  additionalSkills: { source: string; target: string }[];
};
const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--local-only'].includes(arg)))
  throw new Error('usage: bun pipeline:sync [--apply] [--local-only]');
const apply = args.includes('--apply');
const source = (path: string) => readFileSync(join(root, path), 'utf8');
const call = (argv: string[]) => {
  const result = Bun.spawnSync(['pagespace', ...argv, '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0)
    throw new Error(
      `PageSpace ${argv.slice(0, 2).join(' ')} failed; no credential copied or provisioned`,
    );
  return JSON.parse(result.stdout.toString()) as {
    content: string;
    totalLines: number;
    contentMode?: string;
    page?: { contentMode?: string };
  };
};
let drift = 0;
const localSkills = [
  ...targets.skills.map((name) => ({
    source: `.claude/skills/${name}/SKILL.md`,
    target: `.agents/skills/${name}/SKILL.md`,
  })),
  ...targets.additionalSkills,
];
for (const skill of localSkills) {
  const desired = source(skill.source);
  const path = join(homedir(), skill.target);
  let before = '';
  try {
    before = readFileSync(path, 'utf8');
  } catch {
    /* absent skill is drift */
  }
  const installedRoot = dirname(dirname(path));
  if (!pipelineSkillNeedsInstall(path, desired, installedRoot)) continue;
  drift++;
  if (apply) {
    installPipelineSkill(path, desired, before, installedRoot);
  }
  process.stdout.write(
    `${apply ? 'updated' : 'drift'} local skill ${skill.target}\n`,
  );
}
for (const name of targets.retiredTaskReferences) {
  if (
    !retirePipelineReference(
      join(homedir(), '.agents/skills/task/references', name),
      apply,
      join(homedir(), '.agents/skills'),
    )
  )
    continue;
  drift++;
  process.stdout.write(
    `${apply ? 'removed' : 'drift'} retired task reference ${name}\n`,
  );
}
if (!args.includes('--local-only'))
  for (const page of targets.pages) {
    const desired = source(page.source);
    const before = call(['pages', 'read', page.id]);
    if (canonical(before.content) === canonical(desired)) continue;
    drift++;
    if (apply) {
      // The board writer compares content again immediately before replacing.
      withPipelineFiles(desired, before.content, (file, old) => {
        const written = Bun.spawnSync(
          [
            'bun',
            'scripts/board.ts',
            'replace',
            page.id,
            '--start',
            '1',
            '--end',
            String(before.totalLines),
            '--expect-lines',
            String(before.totalLines),
            '--file',
            file,
            '--old-file',
            old,
          ],
          { cwd: root, stdout: 'pipe', stderr: 'pipe' },
        );
        if (written.exitCode !== 0)
          throw new Error(
            `Concurrent change or write failure for ${page.id}; retry after reading current state`,
          );
        if (
          canonical(call(['pages', 'read', page.id]).content) !==
          canonical(desired)
        )
          throw new Error(`Pipeline readback differs for ${page.id}`);
      });
    }
    process.stdout.write(`${apply ? 'updated' : 'drift'} Library ${page.id}\n`);
  }
process.stdout.write(`${drift} target differences${apply ? ' applied' : ''}\n`);
if (drift && !apply) process.exitCode = 1;
