import { requestApp, requestIdentity } from '../../lib/page-reads';

/**
 * The reply address /support starts with: the signed-in account's own
 * email, which they may change, or empty for a visitor (SUPP-1).
 */
export const requestSupportReplyAddress = async (): Promise<string> => {
  const { principal } = await requestIdentity();
  if (principal.kind !== 'user') return '';
  return (
    (await requestApp().database.readSupportReplyAddress(principal.userId)) ??
    ''
  );
};
