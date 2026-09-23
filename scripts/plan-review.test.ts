import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { adrIndex, parseVerdict, planReviewPrompt } from './plan-review';

setupRitewayBun();

describe('planReviewPrompt', () => {
  const prompt = planReviewPrompt({
    agents: 'AGENTS RULES: greenfield over backward compatibility',
    adrs: [
      { number: '0018', title: 'cuid2 identifiers' },
      { number: '0023', title: 'Greenfield baseline' },
    ],
    plan: '<h1>Plan — X</h1><p>Backfill existing rows.</p>',
  });

  test('gives the external reviewer the repository constraints and the plan', () => {
    assert({
      given: 'AGENTS.md, the ADR index and a plan',
      should: 'include all three and the required verdict line',
      actual: [
        prompt.includes('AGENTS RULES'),
        prompt.includes('ADR 0023: Greenfield baseline'),
        prompt.includes('Backfill existing rows.'),
        prompt.includes('PLAN REVIEW: APPROVE'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('asks for contradictions with accepted decisions before tasking', () => {
    assert({
      given: 'the prompt',
      should: 'name the checks the retrospective found missing',
      actual: [
        /contradict/i.test(prompt),
        /prerequisite/i.test(prompt),
        /superseded/i.test(prompt),
      ],
      expected: [true, true, true],
    });
  });
});

describe('adrIndex', () => {
  test('reads number and title from decision records', () => {
    assert({
      given: 'decision file names and their first lines',
      should: 'return the index sorted by number',
      actual: adrIndex([
        {
          file: '0023-greenfield-baseline.md',
          firstLine: '# 0023: Greenfield baseline',
        },
        { file: '0018-cuid2.md', firstLine: '# 0018: cuid2 identifiers' },
        {
          file: '0001-bun-runtime.md',
          firstLine: '# ADR 0001: Bun as the only runtime',
        },
        { file: '0040-no-heading.md', firstLine: 'Status: draft' },
        { file: 'README.md', firstLine: '# Decisions' },
      ]),
      expected: [
        { number: '0001', title: 'Bun as the only runtime' },
        { number: '0018', title: 'cuid2 identifiers' },
        { number: '0023', title: 'Greenfield baseline' },
        { number: '0040', title: 'no heading' },
      ],
    });
  });

  test('indexes every decision record in the repository', () => {
    const dir = new URL('../docs/decisions/', import.meta.url).pathname;
    const files = readdirSync(dir).filter((file) => /^\d{4}-/.test(file));
    assert({
      given: 'docs/decisions, whose older records are headed "# ADR 0001: …"',
      should: 'feed every one of them to the review',
      actual: adrIndex(
        files.map((file) => ({
          file,
          firstLine: readFileSync(join(dir, file), 'utf8').split('\n')[0],
        })),
      ).length,
      expected: files.length,
    });
  });
});

describe('parseVerdict', () => {
  test('reads the verdict line and refuses output without one', () => {
    assert({
      given:
        'an approving review, a change request, and output with no verdict',
      should: 'return the verdict or undefined',
      actual: [
        parseVerdict('findings…\nPLAN REVIEW: APPROVE\n'),
        parseVerdict('PLAN REVIEW: CHANGES REQUESTED'),
        parseVerdict('looks fine'),
      ],
      expected: ['APPROVE', 'CHANGES REQUESTED', undefined],
    });
  });

  test('reads the last whole verdict line, not a verdict quoted earlier', () => {
    assert({
      given:
        'an approval quoted mid-sentence before a final change request, and two verdict lines',
      should: 'return the final verdict line each time',
      actual: [
        parseVerdict(
          'I would give PLAN REVIEW: APPROVE once the backfill goes.\nPLAN REVIEW: CHANGES REQUESTED\n',
        ),
        parseVerdict(
          'PLAN REVIEW: APPROVE\nmore findings\nPLAN REVIEW: CHANGES REQUESTED',
        ),
      ],
      expected: ['CHANGES REQUESTED', 'CHANGES REQUESTED'],
    });
  });
});
