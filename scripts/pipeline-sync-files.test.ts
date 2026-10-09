import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  canonicalPipeline,
  retirePipelineReference,
  withPipelineFiles,
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
