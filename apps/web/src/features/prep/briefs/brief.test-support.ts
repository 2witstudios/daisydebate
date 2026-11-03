import { getBrief } from './get-brief';
import { samplePrepSource } from '../../../ui/mock/prep-source';

/** A sample brief by id, or a loud failure naming the id. */
export function requireBrief(id: string) {
  const found = getBrief(samplePrepSource, id);
  if (found === undefined) throw new Error(`no sample ${id}`);
  return found;
}
