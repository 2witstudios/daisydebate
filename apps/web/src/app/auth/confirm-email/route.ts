import { createConfirmEmailHandlers } from '../../../features/auth/confirm-email';
import { getAuth } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
  readonly internalAdapter: {
    readonly listSessions: (
      userId: string,
    ) => Promise<
      readonly { readonly token: string; readonly userId: string }[]
    >;
    readonly deleteSession: (token: string) => Promise<unknown>;
  };
};

const handlers = createConfirmEmailHandlers({
  auth: () => {
    const { instance, config } = getAuth();
    return {
      handler: instance.handler,
      config,
      internalAdapter: async () =>
        ((await instance.$context) as Context).internalAdapter,
    };
  },
});
export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const POST = handlers.POST;
