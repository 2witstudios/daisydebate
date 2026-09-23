import { createConfirmEmailHandlers } from '../../../features/auth/confirm-email';
import { confirmAuth } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createConfirmEmailHandlers({ auth: confirmAuth });
export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const POST = handlers.POST;
