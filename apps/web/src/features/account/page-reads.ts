import { cache } from 'react';
import { requestApp, requestIdentity } from '../../lib/page-reads';

/** Whether this render's account without a username has answered the age step. */
export const requestHasRecordedAge = cache(async (): Promise<boolean> => {
  const identity = await requestIdentity();
  if (identity.state !== 'provisional') return false;
  return requestApp().database.hasRecordedAge(identity.principal.userId);
});
