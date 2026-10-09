import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacySubject } from './contracts';
import {
  validatePrivacyAdoption,
  type PrivacyExpectedColumns,
} from './declarations';

export const privacyVendors = [
  'sentry',
  'posthog',
  'beehiiv',
  'resend',
  'object-storage',
] as const;
export type PrivacyVendor = (typeof privacyVendors)[number];
export type PrivacyAdoption = {
  readonly requiredAdopters: readonly {
    readonly id: string;
    readonly phase: PrivacyAdopter['phase'];
    readonly expectedColumns: PrivacyExpectedColumns;
  }[];
  readonly adopters: readonly PrivacyAdopter[];
};
function checkAdopter(
  requirement: PrivacyAdoption['requiredAdopters'][number],
  adopter: PrivacyAdopter | undefined,
) {
  if (
    !requirement.id.trim() ||
    !adopter ||
    adopter.phase !== requirement.phase ||
    !['before-auth', 'after-scrub'].includes(adopter.phase) ||
    typeof adopter.erase !== 'function' ||
    typeof adopter.export !== 'function' ||
    validatePrivacyAdoption(requirement.expectedColumns, adopter.fields)
      .problems.length > 0
  )
    throw createAppError('VALIDATION');
}
export function planPrivacyExport(
  subject: PrivacySubject,
  adoption: PrivacyAdoption,
) {
  if (
    !idSchema.safeParse(subject.userId).success ||
    !idSchema.safeParse(subject.actorId).success
  )
    throw createAppError('VALIDATION');
  const expected = adoption.requiredAdopters;
  const actual = adoption.adopters;
  if (
    new Set(expected.map((item) => item.id)).size !== expected.length ||
    new Set(actual.map((item) => item.id)).size !== actual.length ||
    actual.length !== expected.length
  )
    throw createAppError('VALIDATION');
  for (const requirement of expected) {
    checkAdopter(
      requirement,
      actual.find((item) => item.id === requirement.id),
    );
  }
  // Local subject rights do not approve collection: pending basis/retention
  // remain activation holds. Explicit erasure/export rules are still required.
  return {
    subject: { ...subject },
    adopterIds: expected.map((item) => item.id),
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
