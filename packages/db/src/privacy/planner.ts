import { tryCanonicalInstantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import {
  privacyPhases,
  type PrivacyAdopter,
  type PrivacySubject,
} from './contracts';
import { privacyVendors, type PrivacyVendor } from '../schema/privacy-jobs';

export { privacyVendors, type PrivacyVendor } from '../schema/privacy-jobs';

/** Every feature's subject-rights step, in the order they run. */
export type PrivacyAdoption = readonly PrivacyAdopter[];

const adopterValid = (adopter: PrivacyAdopter) =>
  adopter.id.trim().length > 0 &&
  privacyPhases.includes(adopter.phase) &&
  typeof adopter.erase === 'function' &&
  typeof adopter.export === 'function';

export function planPrivacyExport(
  subject: PrivacySubject,
  adoption: PrivacyAdoption,
) {
  if (
    !idSchema.safeParse(subject.userId).success ||
    !idSchema.safeParse(subject.actorId).success ||
    new Set(adoption.map((adopter) => adopter.id)).size !== adoption.length ||
    !adoption.every(adopterValid)
  )
    throw createAppError('VALIDATION');
  return { subject: { ...subject } };
}
export type PrivacyErasureInput = {
  readonly subject: PrivacySubject;
  readonly now: string;
  readonly vendors: readonly string[];
  readonly jobIds: readonly string[];
};
export function planPrivacyErasure(
  input: PrivacyErasureInput,
  adoption: PrivacyAdoption,
) {
  const plan = planPrivacyExport(input.subject, adoption);
  if (
    tryCanonicalInstantMs(input.now) === undefined ||
    input.vendors.length !== input.jobIds.length ||
    new Set(input.vendors).size !== input.vendors.length ||
    new Set(input.jobIds).size !== input.jobIds.length ||
    input.vendors.some(
      (vendor) => !privacyVendors.some((known) => known === vendor),
    ) ||
    input.jobIds.some((id) => !idSchema.safeParse(id).success)
  )
    throw createAppError('VALIDATION');
  return {
    ...plan,
    now: input.now,
    jobs: input.vendors.map((vendor, index) => ({
      id: input.jobIds[index]!,
      vendor: vendor as PrivacyVendor,
      subjectRef: input.subject.userId,
      createdAt: input.now,
    })),
  };
}
