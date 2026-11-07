import type { ReleaseAdmission } from '@daisy/db/flags';
import { flagCatalogue, type ReleaseFlagKey } from './catalogue';
import { catalogueProblems } from './catalogue-validation';
import { resolveFlag } from './resolver';

/** Only this trusted server catalogue supplies the complete admission closure. */
export function releaseAdmission(key: ReleaseFlagKey): ReleaseAdmission {
  if (catalogueProblems(flagCatalogue).length > 0)
    return { keys: [key], decide: () => false };
  const entries = new Map<string, { readonly dependencies: readonly string[] }>(
    flagCatalogue.map((entry) => [entry.key, entry]),
  );
  const keys = new Set<string>();
  const visit = (name: string) => {
    if (keys.has(name)) return;
    keys.add(name);
    entries.get(name)?.dependencies.forEach(visit);
  };
  visit(key);
  return {
    keys: [...keys].sort(),
    decide: (snapshot, now) =>
      resolveFlag({ catalogue: flagCatalogue, snapshot, key, now }).enabled,
  };
}
