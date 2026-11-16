import { settingsCatalogue } from '@daisy/protocol/settings';

export type StaffMinimumBand = 'adult' | '16-17';

const definition = settingsCatalogue['staff.minimum_band'];

/**
 * `staff.minimum_band` resolved at an organization: the organization's own
 * row when it has one, else the catalogue's default. The key is set only at
 * organization scope, so nothing above it can hold it.
 */
export const staffMinimumBandOf = (
  stored: { readonly value: unknown } | null,
): StaffMinimumBand => {
  if (stored !== null) return definition.value.parse(stored.value).value;
  if (definition.default.kind !== 'value')
    throw new Error('staff.minimum_band has no catalogue default');
  return definition.default.value.value;
};
