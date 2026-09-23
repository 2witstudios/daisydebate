#!/usr/bin/env bun
/**
 * `bun decision:record "<decision>" --context <pageId> [--why "<reason>"]`
 * (ADR 0035). A decision an agent makes on the owner's behalf goes on the
 * drive's Pending decisions list as an open DEC-n task, linked to where it
 * was made, and the owner is notified in Epic Updates. It stays open (To Do)
 * until the owner moves it to Confirmed or Overruled.
 */
import { runBoard } from './board';

export const PENDING_DECISIONS_ID = 'jdesqcu11mczngtmahbcybc3';
const EPIC_UPDATES_CHANNEL_ID = 'ywfbps4h7dgnfnv3phwjs1yn';
const DRIVE_URL = 'https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha';
const PAGE_ID = /^[a-z0-9]{20,32}$/;

export type DecisionDeps = {
  readonly board: (args: readonly string[]) => {
    readonly code: number;
    readonly pageId?: string;
    readonly title?: string;
  };
  readonly notify: (message: string) => boolean;
  readonly out: (text: string) => void;
};

function parse(argv: readonly string[]) {
  const values: Record<string, string> = {};
  const text: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      values[argv[index]] = argv[index + 1] ?? '';
      index += 1;
    } else text.push(argv[index]);
  }
  return {
    decision: text.join(' ').trim(),
    context: values['--context'] ?? '',
    why: values['--why'],
  };
}

export function recordDecision(
  deps: DecisionDeps,
  argv: readonly string[],
): number {
  const { decision, context, why } = parse(argv);
  if (decision === '' || !PAGE_ID.test(context)) {
    deps.out(
      'usage: bun decision:record "<decision>" --context <pageId> [--why "<reason>"]\n',
    );
    return 2;
  }
  const created = deps.board([
    'create',
    PENDING_DECISIONS_ID,
    '--prefix',
    'DEC',
    '--title',
    decision,
    '--criterion',
    `Given this decision, made on the owner's behalf${why ? ` because ${why}` : ''}, the owner should confirm or overrule it; it stays open until then (Confirmed or Overruled).`,
    '--related',
    `Context=${context}`,
  ]);
  if (created.code !== 0 || !created.pageId) return 1;
  const notified = deps.notify(
    `📌 Decision made on your behalf, open until you confirm or overrule it: ${created.title ?? decision}\n${DRIVE_URL}/${created.pageId}`,
  );
  deps.out(
    `${created.title ?? decision} recorded; owner ${notified ? 'notified' : 'NOT notified (channel send failed)'}\n`,
  );
  return notified ? 0 : 1;
}

if (import.meta.main) {
  const run = (args: readonly string[]) => {
    const result = Bun.spawnSync(['pagespace', ...args], {
      stdout: 'pipe',
      stderr: 'inherit',
    });
    return { code: result.exitCode, stdout: result.stdout.toString() };
  };
  process.exitCode = recordDecision(
    {
      board: (args) => {
        const lines: string[] = [];
        const code = runBoard(
          {
            pagespace: run,
            readFile: () => '',
            scratch: (name) =>
              `${process.env.TMPDIR ?? '/tmp'}/decision-${process.pid}-${name}`,
            out: (text) => void lines.push(text),
          },
          args,
        );
        const [pageId, ...title] = (lines.at(-1) ?? '').trim().split(' ');
        return { code, pageId, title: title.join(' ') };
      },
      notify: (message) =>
        run(['channels', 'send', EPIC_UPDATES_CHANNEL_ID, message]).code === 0,
      out: (text) => process.stdout.write(text),
    },
    process.argv.slice(2),
  );
}
