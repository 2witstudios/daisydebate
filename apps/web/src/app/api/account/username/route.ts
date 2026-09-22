import { createUsernameHandler } from '../../../../features/account/username';
import { getAuth } from '../../../../lib/auth';
import { identify } from '../../../../lib/identity';
import { getResources } from '../../../../server/resources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createUsernameHandler({
  origin: () => getAuth().config.PUBLIC_APP_URL,
  identify: (request) => identify(request.headers),
  limiter: () => getAuth().limiter,
  claim: (input) => getResources().database.claimUsername(input),
});
