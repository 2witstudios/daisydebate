import { z } from 'zod';

const text = z.string().trim().min(1);
const policy = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), decision: text }).strict(),
  z
    .object({ status: z.literal('approved'), decision: text, rule: text })
    .strict(),
]);
const declaration = z
  .object({
    table: text,
    column: text,
    category: z.enum(['none', 'identifier', 'personal', 'sensitive', 'secret']),
    visibility: z.enum(['public', 'private']).optional(),
    storage: z.literal('postgres'),
    owner: text,
    purpose: text,
    lawfulBasis: policy,
    retention: policy,
    erasure: z.enum(['delete', 'scrub', 'retain-nonpersonal']),
    exportable: z.boolean(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.category === 'personal' && !field.visibility)
      context.addIssue({
        code: 'custom',
        path: ['visibility'],
        message: 'Personal fields require visibility',
      });
    if (
      ['personal', 'sensitive', 'secret'].includes(field.category) &&
      field.erasure === 'retain-nonpersonal'
    )
      context.addIssue({
        code: 'custom',
        path: ['erasure'],
        message: 'Personal data cannot be retained as nonpersonal',
      });
    if (field.category === 'secret' && field.exportable)
      context.addIssue({
        code: 'custom',
        path: ['exportable'],
        message: 'Secrets cannot be exported',
      });
  });
export type PrivacyExpectedColumns = Readonly<
  Record<string, readonly string[]>
>;

/** Exact producer adoption gate, not a claim to cover the whole repository. */
export function validatePrivacyAdoption(
  expected: PrivacyExpectedColumns,
  fields: readonly unknown[],
) {
  const problems: string[] = [];
  const keys = new Set(
    Object.entries(expected).flatMap(([table, columns]) =>
      columns.map((column) => `${table}.${column}`),
    ),
  );
  const seen = new Set<string>();
  let activationHeld = false;
  fields.forEach((input, index) => {
    const parsed = declaration.safeParse(input);
    if (!parsed.success) {
      problems.push(
        `Declaration ${index}: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      );
      return;
    }
    const field = parsed.data;
    const key = `${field.table}.${field.column}`;
    if (!keys.has(key)) problems.push(`${field.owner}: stale ${key}`);
    if (seen.has(key)) problems.push(`${field.owner}: duplicate ${key}`);
    seen.add(key);
    if (
      field.lawfulBasis.status === 'pending' ||
      field.retention.status === 'pending'
    )
      activationHeld = true;
  });
  for (const key of keys) if (!seen.has(key)) problems.push(`Missing ${key}`);
  return { problems, activationHeld: activationHeld || problems.length > 0 };
}
