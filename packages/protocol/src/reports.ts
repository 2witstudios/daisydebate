import { z } from 'zod';
import { usernameSchema as username } from './username';

/** The one reasons list, everywhere a member can report (ADR 0103). */
export const reportReasons = [
  'harassment',
  'hate',
  'cheating',
  'spam',
  'other',
] as const;
export const storedReportReasons = [...reportReasons, 'not-my-parent'] as const;
export type ReportReason = (typeof storedReportReasons)[number];
export const reportReasonLabels: Readonly<Record<ReportReason, string>> = {
  harassment: 'Harassment',
  hate: 'Hate speech',
  cheating: 'Second account or arranged result',
  spam: 'Spam',
  other: 'Other',
  'not-my-parent': 'Not my parent',
};

/** Where the report was made, the only evidence scope it carries. */
const memberReportSurfaces = ['people', 'profile', 'watch'] as const;
export const reportSurfaces = [
  ...memberReportSurfaces,
  'guardian-link',
] as const;
export type ReportSurface = (typeof reportSurfaces)[number];

export const reportOutcomes = [
  'dismissed',
  'warned',
  'suspended',
  'banned',
] as const;
export type ReportOutcome = (typeof reportOutcomes)[number];

export const reportCommandSchema = z.strictObject({
  version: z.literal(1),
  username,
  reason: z.enum(reportReasons),
  surface: z.enum(memberReportSurfaces),
});
export const reportResultSchema = z.strictObject({
  version: z.literal(1),
  username: z.string(),
  state: z.literal('reported'),
});
