import type { SettingValues } from '@daisy/protocol/setting-values';

/** Each school's partial group of accepted entries owes a whole group of judges. */
export const judgesOwed = (
  policy: SettingValues['entry.judge_obligation'],
  acceptedEntries: number,
): number | null =>
  policy.kind === 'unconfigured'
    ? null
    : Math.ceil(acceptedEntries / policy.entriesPerJudge) *
      policy.judgesPerGroup;
