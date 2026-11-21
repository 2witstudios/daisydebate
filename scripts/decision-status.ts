import { z } from 'zod';

const decNumber = /^DEC-[1-9][0-9]*$/;
const status = z.enum([
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'confirmed',
  'overruled',
  'merged',
]);
const snapshotSchema = z.strictObject({
  version: z.literal(1),
  decisions: z.record(z.string().regex(decNumber), status),
});

export function parseDecisionSnapshot(raw: unknown) {
  const snapshot = snapshotSchema.parse(raw);
  if (Object.keys(snapshot.decisions).length === 0)
    throw new Error('Decision snapshot has no DEC entries');
  return snapshot;
}

const taskListSchema = z.object({
  tasks: z.array(z.object({ title: z.string(), status: z.string() })),
});

export function snapshotDecisionList(raw: unknown) {
  const { tasks } = taskListSchema.parse(raw);
  const decisions = tasks.flatMap(({ title, status: taskStatus }) => {
    const id = /^(DEC-[1-9][0-9]*)\b/.exec(title)?.[1];
    if (!id) return [];
    const parsed = status.safeParse(taskStatus);
    if (!parsed.success)
      throw new Error(`Unknown status for ${id}: ${taskStatus}`);
    return [{ id, status: parsed.data }];
  });
  if (new Set(decisions.map(({ id }) => id)).size !== decisions.length)
    throw new Error('Duplicate DEC number in decision list');
  return parseDecisionSnapshot({
    version: 1,
    decisions: Object.fromEntries(
      decisions
        .sort(
          (left, right) => Number(left.id.slice(4)) - Number(right.id.slice(4)),
        )
        .map(({ id, status }) => [id, status]),
    ),
  });
}

/** Only a whole decision's status line can retire its number. */
export function retiredAdr(path: string, text: string): string | undefined {
  const number = /^docs\/decisions\/(\d{4})-[^/]+\.md$/.exec(path)?.[1];
  const disposition = /^Status:[ \t]*(\w+)/im.exec(text)?.[1] ?? '';
  const retired = /^(overruled|superseded|withdrawn)$/i.test(disposition);
  return number && retired ? `ADR ${number}` : undefined;
}

const citations =
  /\bDEC-[1-9][0-9]*\b|\bADR[ \t]*[-#]?0*([1-9][0-9]{0,3})\b|\bdocs\/decisions\/(\d{4})-[\w-]+\.md\b/gi;

export function overruledCitations(
  path: string,
  text: string,
  overruled: ReadonlySet<string>,
) {
  if (path === 'policy/decision-status.json') return [];
  // Applied migration text is historical. The architecture rules prohibit rewriting it.
  if (path.startsWith('packages/db/migrations/')) return [];
  return text.split('\n').flatMap((line, index) => {
    const ids = new Set(
      [...line.matchAll(citations)].map(([citation, number, fileNumber]) =>
        number || fileNumber
          ? `ADR ${(number ?? fileNumber).padStart(4, '0')}`
          : citation.toUpperCase(),
      ),
    );
    return [...ids]
      .filter((id) => overruled.has(id))
      .map((id) => ({
        path,
        line: index + 1,
        rule: 'overruled-decision' as const,
        detail: `${id} is retired; cite the decision currently in force`,
      }));
  });
}
