import { signInHref } from '../../features/access/decision';
import type { AudienceViewer } from './audience-panel';

type Actions = {
  readonly react: Extract<AudienceViewer, { kind: 'account' }>['react'];
  readonly reportMessage: Extract<
    AudienceViewer,
    { kind: 'account' }
  >['reportMessage'];
  readonly postChat: Extract<AudienceViewer, { kind: 'account' }>['postChat'];
};

/**
 * Who the audience panel is for. A visitor's sign-in comes back to `returnTo`,
 * the page they were reading; a place in the live room never posts.
 */
export const audienceViewerOf = (input: {
  readonly account: { readonly actorId: string | null } | null;
  readonly restricted: boolean;
  readonly usernameClaimed: boolean;
  readonly inLiveRoom: boolean;
  readonly returnTo: string;
  readonly requestId: () => string;
  readonly actions: Actions;
}): AudienceViewer => {
  const { account, actions } = input;
  if (account === null)
    return { kind: 'visitor', signInHref: signInHref(input.returnTo) };
  if (input.restricted) return { kind: 'restricted' };
  if (account.actorId === null || !input.usernameClaimed)
    return { kind: 'needs-username' };
  const { react, reportMessage, postChat } = actions;
  return input.inLiveRoom
    ? { kind: 'live-room', react, reportMessage }
    : {
        kind: 'account',
        requestId: input.requestId(),
        postChat,
        react,
        reportMessage,
      };
};
