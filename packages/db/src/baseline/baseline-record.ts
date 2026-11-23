import { resolve } from 'node:path';
import { z } from 'zod';

const repository = resolve(import.meta.dir, '../../../..');

/** The one baseline `policy/migration-baselines.json` records (ADR 0913). */
export const baselineRecord = z.object({
  tag: z.string().regex(/^\d{14}_baseline$/),
  cutoff: z.string().regex(/^\d{14}_[a-z0-9_]+$/),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  supersededHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type BaselineRecord = z.infer<typeof baselineRecord>;

/** Development and tests read the record from the repository's policy. */
export async function readBaselineRecord(): Promise<BaselineRecord> {
  const registry = z
    .object({ baselines: z.array(z.looseObject({})).length(1) })
    .parse(await Bun.file(resolve(repository, 'policy/migration-baselines.json')).json());
  return baselineRecord.parse(registry.baselines[0]);
}
