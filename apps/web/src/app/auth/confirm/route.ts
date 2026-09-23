import { createConfirmHandlers } from '../../../features/auth/confirm';
import { confirmAuth } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createConfirmHandlers({ auth: confirmAuth });
export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const POST = handlers.POST;
