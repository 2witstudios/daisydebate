import { requestApp, requestIdentity } from '../../lib/page-reads';

export const requestProfileChallengeModes = async (username: string) => {
  const identity = await requestIdentity();
  return identity.state === 'member'
    ? requestApp().database.readProfileChallengeModes(
        identity.principal.userId,
        username,
      )
    : [];
};
