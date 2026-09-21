import { createConfirmHandlers } from '../../../features/auth/confirm';
import { getAuth } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createConfirmHandlers({
  auth: () => {
    const { instance, config } = getAuth();
    return { handler: instance.handler, config };
  },
});
export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const POST = handlers.POST;
