import { getBrief } from './get-brief';

/** A sample brief by id, or a loud failure naming the id. */
export function requireBrief(id: string) {
  const found = getBrief(id);
  if (found === undefined) throw new Error(`no sample ${id}`);
  return found;
}
