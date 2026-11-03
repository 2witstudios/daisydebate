'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  field,
  refused,
  type FormState,
} from '../../../features/forms/form-state';
import { submitReport } from '../../../features/content-moderation/submit-report';
import { returnableDestination } from '../../../features/auth/redirect';
import {
  CHAT_POST_FAILED,
  chatRefusalText,
} from '../../../features/messaging/spectator-chat/form';
import { moveOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { post } from '../form-post';

const routes = {
  chat: processRoute((all) => all.audience.chat),
  reaction: processRoute((all) => all.audience.reaction),
  follow: processRoute((all) => all.audience.follow),
  history: processRoute((all) => all.audience.watchHistory),
  read: processRoute((all) => all.audience.notificationsRead),
  preferences: processRoute((all) => all.audience.notificationPreferences),
  report: processRoute((all) => all.contentModeration.report.POST),
};

/** Bound arguments round-trip through the page, so they are checked as untrusted. */
const backTo = (returnTo: unknown) =>
  returnableDestination(typeof returnTo === 'string' ? returnTo : null, '/');
const roundPath = (roundId: unknown, leaf: string) =>
  `/api/rounds/${encodeURIComponent(String(roundId))}/${leaf}`;

const refusalOf = async (response: Response) => {
  const body = (await response.json().catch(() => null)) as {
    refusal?: unknown;
  } | null;
  return typeof body?.refusal === 'string' ? body.refusal : null;
};

/** Posts to the Round's spectator chat, keeping the draft on any refusal. */
export async function postSpectatorChatAction(
  target: { readonly roundId: string; readonly returnTo: string },
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const incoming = new Headers(await headers());
  try {
    const response = await post(
      routes.chat,
      roundPath(target.roundId, 'chat'),
      {
        version: 1,
        requestId: field(form, 'requestId'),
        text: field(form, 'text'),
      },
    );
    if (!response.ok) {
      const refusal = await refusalOf(response);
      return refused(
        form,
        (refusal && chatRefusalText[refusal]) ?? CHAT_POST_FAILED,
      );
    }
  } catch {
    return refused(form, CHAT_POST_FAILED);
  }
  return { values: {}, ...moveOn(incoming, backTo(target.returnTo)) };
}

/** Sends one reaction; the pressed button names which. */
export async function reactToRoundAction(
  target: { readonly roundId: string; readonly returnTo: string },
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const incoming = new Headers(await headers());
  try {
    const response = await post(
      routes.reaction,
      roundPath(target.roundId, 'reactions'),
      { version: 1, kind: field(form, 'kind') },
    );
    if (!response.ok)
      return refused(form, 'That reaction did not go through. Try again.');
  } catch {
    return refused(form, 'That reaction did not go through. Try again.');
  }
  return { values: {}, ...moveOn(incoming, backTo(target.returnTo)) };
}

/** Follows or stops following a debater. */
export async function setDebaterFollowAction(
  target: {
    readonly username: string;
    readonly state: 'following' | 'not_following';
    readonly returnTo: string;
  },
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const incoming = new Headers(await headers());
  const failed = refused(form, 'That did not go through. Try again.');
  try {
    const response = await post(routes.follow, '/api/debater-follows', {
      version: 1,
      username: target.username,
      state: target.state,
    });
    if (!response.ok) return failed;
  } catch {
    return failed;
  }
  const to = backTo(target.returnTo);
  revalidatePath(to);
  return { values: {}, ...moveOn(incoming, to) };
}

const updateHistory = async (
  body: unknown,
  form: FormData,
): Promise<FormState> => {
  const incoming = new Headers(await headers());
  const failed = refused(form, 'That did not go through. Try again.');
  try {
    const response = await post(routes.history, '/api/watch-history', body);
    if (!response.ok) return failed;
  } catch {
    return failed;
  }
  revalidatePath('/settings');
  return { values: {}, ...moveOn(incoming, '/settings#watch-history') };
};

export async function forgetWatchedAction(
  roundId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return updateHistory({ version: 1, kind: 'forget', roundId }, form);
}

export async function clearWatchHistoryAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return updateHistory({ version: 1, kind: 'clear' }, form);
}

const markRead = async (body: unknown, form: FormData): Promise<FormState> => {
  const incoming = new Headers(await headers());
  const failed = refused(form, 'That did not go through. Try again.');
  try {
    const response = await post(routes.read, '/api/notifications/read', body);
    if (!response.ok) return failed;
  } catch {
    return failed;
  }
  revalidatePath('/notifications');
  return { values: {}, ...moveOn(incoming, '/notifications') };
};

export async function markNotificationReadAction(
  notificationId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return markRead({ version: 1, kind: 'one', notificationId }, form);
}

export async function markAllNotificationsReadAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return markRead({ version: 1, kind: 'all' }, form);
}

/** Stores what the member chose; Settings then reads it back (ISSUE-1045). */
export async function saveNotificationPreferencesAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const incoming = new Headers(await headers());
  const failed = refused(form, 'Could not save. Try again.');
  try {
    const response = await post(
      routes.preferences,
      '/api/notifications/preferences',
      {
        version: 1,
        followed_debater_live: form.get('followed_debater_live') === 'on',
        recording_ready: form.get('recording_ready') === 'on',
      },
    );
    if (!response.ok) return failed;
  } catch {
    return failed;
  }
  revalidatePath('/settings');
  return {
    values: {},
    ...moveOn(incoming, '/settings?notifications=saved#notifications'),
  };
}

/** Reports a chat message through /api/content-reports, then comes back. */
export async function reportChatMessageAction(
  returnTo: string,
  form: FormData,
): Promise<never> {
  const result = await submitReport(
    inProcessFetch(routes.report, new Headers(await headers())),
    form,
  );
  redirect(`${backTo(returnTo)}?report=${result}`);
}
