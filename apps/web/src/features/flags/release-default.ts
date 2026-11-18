/** The deployment's release-flag default from validated config (ADR 0118). */
export const releaseFlagDefault = (config: {
  readonly DAISY_RELEASE_FLAG_DEFAULT?: 'enabled' | undefined;
}): boolean => config.DAISY_RELEASE_FLAG_DEFAULT === 'enabled';
