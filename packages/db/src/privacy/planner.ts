import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacySubject } from './contracts';

export const privacyVendors = [
  'sentry',
  'posthog',
  'beehiiv',
  'resend',
  'object-storage',
  'messaging-typing',
] as const;
export type PrivacyVendor = (typeof privacyVendors)[number];
/** Every feature's subject-rights step, in the order they run. */
export type PrivacyAdoption = readonly PrivacyAdopter[];

const adopterValid = (adopter: PrivacyAdopter) =>
  adopter.id.trim().length > 0 &&
  ['before-auth', 'after-close'].includes(adopter.phase) &&
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
  return {
    subject: { ...subject },
    adopterIds: adoption.map((adopter) => adopter.id),
  };
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
  const date = new Date(input.now);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== input.now ||
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
