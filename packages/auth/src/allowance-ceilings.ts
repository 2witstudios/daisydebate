import type { UsageKind } from '@daisy/protocol/billing';

export type AllowanceCeilings = {
  readonly freeLifetime: number;
  readonly premiumPerDay: Readonly<Record<UsageKind, number>>;
};

/**
 * The one trusted fair-use configuration (ADR 0146). A free account tries
 * each AI feature once, ever; Premium has no visible quantity, only a per-UTC
 * day ceiling set well above anyone debating for real, so it stops scripts
 * and abuse. Nothing outside the allowance decision ever reads these numbers.
 */
export const allowanceCeilings = {
  freeLifetime: 1,
  premiumPerDay: { ai_round: 12, casual_ai_judge: 24, round_analysis: 24 },
} as const satisfies AllowanceCeilings;
