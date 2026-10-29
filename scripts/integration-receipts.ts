import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type IntegrationReceipt = {
  readonly workspace: string;
  readonly shard: string;
  readonly files: readonly string[];
  readonly elapsedMs: number;
};

/** Only called after the runner and all of its cleanup checks succeed. */
export function recordIntegrationReceipt(
  directory: string | undefined,
  receipt: IntegrationReceipt,
): void {
  if (directory === undefined) return;
  if (directory === '') throw new Error('Empty integration receipt directory');
  mkdirSync(directory, { recursive: true });
  const name = `${receipt.workspace.replaceAll('/', '-')}-${receipt.shard.replace('/', '-')}.json`;
  writeFileSync(join(directory, name), JSON.stringify(receipt));
}

type Inventory = Readonly<Record<string, readonly string[]>>;

function isReceipt(value: unknown): value is IntegrationReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const { workspace, shard, files, elapsedMs } =
    value as Partial<IntegrationReceipt>;
  return (
    typeof workspace === 'string' &&
    typeof shard === 'string' &&
    Array.isArray(files) &&
    files.every((file) => typeof file === 'string') &&
    typeof elapsedMs === 'number' &&
    Number.isFinite(elapsedMs) &&
    elapsedMs >= 0
  );
}

/** Receipts are untrusted artifacts: require every worker and exact coverage. */
export function verifyIntegrationReceipts(
  inventory: Inventory,
  receipts: readonly unknown[],
  count: number,
): readonly string[] {
  const problems: string[] = [];
  if (!Number.isInteger(count) || count < 1 || count > 64)
    return ['Invalid integration shard count'];
  const seen = new Set<string>();
  const coverage = new Map<string, string[]>();
  const selectors = Array.from(
    { length: count },
    (_, index) => `${index + 1}/${count}`,
  );
  if (Object.keys(inventory).length === 0)
    problems.push('No integration workspaces discovered');
  for (const value of receipts) {
    if (
      !isReceipt(value) ||
      !Object.hasOwn(inventory, value.workspace) ||
      !selectors.includes(value.shard)
    ) {
      problems.push('Invalid integration receipt');
      continue;
    }
    const { workspace, shard, files } = value;
    const key = `${workspace}:${shard}`;
    if (seen.has(key)) problems.push(`Duplicate receipt: ${key}`);
    seen.add(key);
    coverage.set(workspace, [...(coverage.get(workspace) ?? []), ...files]);
  }
  for (const [workspace, files] of Object.entries(inventory)) {
    if (files.length === 0)
      problems.push(`Empty integration inventory: ${workspace}`);
    for (let index = 1; index <= count; index++) {
      const key = `${workspace}:${index}/${count}`;
      if (!seen.has(key)) problems.push(`Missing receipt: ${key}`);
    }
    // Sorting, not a set: a duplicated file cannot hide a missing one.
    if (
      JSON.stringify([...(coverage.get(workspace) ?? [])].sort()) !==
      JSON.stringify([...files].sort())
    )
      problems.push(
        `Incomplete or overlapping integration coverage: ${workspace}`,
      );
  }
  return problems;
}
