import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  canonicalPipeline,
  retirePipelineReference,
  withPipelineFiles,
  installPipelineSkill,
} from './pipeline-sync-files';
setupRitewayBun();

describe('pipeline distribution integrity', () => {
  test('preserves visible inline whitespace while ignoring block formatting', () => {
    assert({
      given:
        'adjacent inline words with and without a space, and block-only formatting',
      should: 'detect visible drift and ignore block formatting',
      actual: [
        canonicalPipeline('<strong>Owner</strong> <em>approved</em>') ===
          canonicalPipeline('<strong>Owner</strong><em>approved</em>'),
        canonicalPipeline('<h1>Owner</h1>\n<p>approved</p>') ===
          canonicalPipeline('<h1>Owner</h1><p>approved</p>'),
      ],
      expected: [false, true],
    });
  });
  test('reports retired references without changing them during a dry run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipeline-retire-'));
    try {
      const path = join(directory, 'old.md');
      writeFileSync(path, 'contradictory retired instructions');
      const found = retirePipelineReference(path, false);
      const stillPresent = existsSync(path);
      const removed = retirePipelineReference(path, true);
      assert({
        given: 'a retired installed reference',
        should: 'report drift in check mode and remove it only in apply mode',
        actual: [
          found,
          stillPresent,
          removed,
          existsSync(path),
          retirePipelineReference(path, false),
        ],
        expected: [true, true, true, false, false],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test('keeps content private and cleans up when the writer fails', () => {
    let directory = '';
    let modes: number[] = [];
    let failed = false;
    try {
      withPipelineFiles('new', 'old', (file, old) => {
        directory = dirname(file);
        modes = [directory, file, old].map(
          (path) => statSync(path).mode & 0o777,
        );
        throw new Error('concurrent writer');
      });
    } catch (error) {
      failed = error instanceof Error && error.message === 'concurrent writer';
    }
    assert({
      given: 'a write rejected for concurrent mutation',
      should:
        'protect both snapshots and remove private scratch before propagating failure',
      actual: { modes, failed, remaining: existsSync(directory) },
      expected: {
        modes: [0o700, 0o600, 0o600],
        failed: true,
        remaining: false,
      },
    });
  });
});

describe('installed pipeline checkout isolation', () => {
  test('detaches linked skills without changing their source checkout', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipeline-install-'));
    try {
      const source = join(directory, 'parent-skill');
      const installed = join(directory, 'installed-skill');
      mkdirSync(source);
      writeFileSync(join(source, 'SKILL.md'), 'parent policy');
      writeFileSync(join(source, 'reference.md'), 'keep reference');
      symlinkSync(source, installed);
      installPipelineSkill(
        join(installed, 'SKILL.md'),
        'new branch authority',
        'parent policy',
      );
      assert({
        given: 'an installed skill directory linked to another checkout',
        should:
          'update the local copy, preserve references and leave parent source untouched',
        actual: {
          parent: readFileSync(join(source, 'SKILL.md'), 'utf8'),
          local: readFileSync(join(installed, 'SKILL.md'), 'utf8'),
          reference: readFileSync(join(installed, 'reference.md'), 'utf8'),
          linked: lstatSync(installed).isSymbolicLink(),
        },
        expected: {
          parent: 'parent policy',
          local: 'new branch authority',
          reference: 'keep reference',
          linked: false,
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test('creates missing Codex installs and replaces file links locally', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipeline-file-link-'));
    try {
      const source = join(directory, 'source.md');
      const linked = join(directory, 'linked.md');
      const missing = join(directory, 'codex-skill', 'SKILL.md');
      writeFileSync(source, 'source contract');
      symlinkSync(source, linked);
      installPipelineSkill(linked, 'installed contract', 'source contract');
      installPipelineSkill(missing, 'new Codex contract', '');
      assert({
        given: 'a linked SKILL file and an absent Codex skill directory',
        should:
          'create independent local files without altering the link source',
        actual: [
          readFileSync(source, 'utf8'),
          readFileSync(linked, 'utf8'),
          readFileSync(missing, 'utf8'),
          lstatSync(linked).isSymbolicLink(),
        ],
        expected: [
          'source contract',
          'installed contract',
          'new Codex contract',
          false,
        ],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test('refuses a concurrent change before detaching or writing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipeline-race-'));
    try {
      const path = join(directory, 'SKILL.md');
      writeFileSync(path, 'concurrent policy');
      let refused = false;
      try {
        installPipelineSkill(path, 'replacement', 'previous policy');
      } catch (error) {
        refused = error instanceof Error && error.message.includes('changed');
      }
      assert({
        given: 'installed content changed since the distribution read',
        should: 'refuse and preserve the concurrent content',
        actual: [refused, readFileSync(path, 'utf8')],
        expected: [true, 'concurrent policy'],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
