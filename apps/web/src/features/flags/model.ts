/** Release control never represents account permissions or entitlement grants. */
export type FlagDefinition = {
  readonly key: string;
  readonly owner: string;
  readonly taskCode: string;
  readonly expiresOn: string;
  readonly dependencies: readonly string[];
} & (
  | { readonly kind: 'release'; readonly safeDefault: false }
  | { readonly kind: 'ops'; readonly safeDefault: boolean }
);

export type { FlagState, FlagFact, FlagSnapshot } from '@daisy/protocol/flags';

export type FlagResolution = {
  readonly enabled: boolean;
  readonly reason:
    | 'UNKNOWN'
    | 'DISABLED'
    | 'TARGETING_MATCH'
    | 'STATIC'
    | 'DEFAULT'
    | 'ERROR'
    | 'DEPENDENCY'
    | 'EXPIRED';
};
