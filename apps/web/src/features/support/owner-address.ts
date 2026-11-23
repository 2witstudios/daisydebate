/**
 * Where support messages are emailed (SUPP-1): their own address when one
 * is set, otherwise the owner address beta access already uses, so messages
 * reach the owner without a new secret. Neither set, no address: messages
 * are stored and their email waits.
 */
export const supportOwnerAddress = (config: {
  readonly SUPPORT_NOTIFY_EMAIL?: string | undefined;
  readonly BETA_NOTIFY_EMAIL?: string | undefined;
}): string | undefined =>
  config.SUPPORT_NOTIFY_EMAIL ?? config.BETA_NOTIFY_EMAIL;
