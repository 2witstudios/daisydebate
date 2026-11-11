'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  done,
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
import { stayOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { audienceRefusalText } from '../../../ui/audience/audience-copy';
import {
  saveRefused,
  type SaveFormState,
} from '../../../features/forms/save-form';
import { choicesFromForm } from '../../../features/notifications/preference-form';
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
  const to = backTo(target.returnTo);
  revalidatePath(to);
  return stayOn(incoming, to) ?? done;
}

const FAILED = 'That did not go through. Try again.';

/** One no-input mutation: its route, then the page it stays on. */
const mutate = async (
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  form: FormData,
  to: string,
): Promise<FormState> => {
  const incoming = new Headers(await headers());
  try {
    const response = await post(route, path, body);
    if (!response.ok) {
      const refusal = await refusalOf(response);
      return refused(form, (refusal && audienceRefusalText[refusal]) ?? FAILED);
    }
  } catch {
    return refused(form, FAILED);
  }
  revalidatePath(to);
  return stayOn(incoming, to) ?? done;
};

/** Sends one reaction; the pressed button names which. */
export async function reactToRoundAction(
  target: { readonly roundId: string; readonly returnTo: string },
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return mutate(
    routes.reaction,
    roundPath(target.roundId, 'reactions'),
    { version: 1, kind: field(form, 'kind') },
    form,
    backTo(target.returnTo),
  );
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
  return mutate(
    routes.follow,
    '/api/debater-follows',
    { version: 1, username: target.username, state: target.state },
    form,
    backTo(target.returnTo),
  );
}

export async function forgetWatchedAction(
  roundId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return mutate(
    routes.history,
    '/api/watch-history',
    { version: 1, kind: 'forget', roundId },
    form,
    '/settings',
  );
}

export async function clearWatchHistoryAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return mutate(
    routes.history,
    '/api/watch-history',
    { version: 1, kind: 'clear' },
    form,
    '/settings',
  );
}

export async function markNotificationReadAction(
  notificationId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return mutate(
    routes.read,
    '/api/notifications/read',
    { version: 1, kind: 'one', notificationId },
    form,
    '/notifications',
  );
}

export async function markAllNotificationsReadAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return mutate(
    routes.read,
    '/api/notifications/read',
    { version: 1, kind: 'all' },
    form,
    '/notifications',
  );
}

/** Stores what the member chose; Settings then reads it back (ISSUE-1045). */
export async function saveNotificationPreferencesAction(
  _previous: SaveFormState,
  form: FormData,
): Promise<SaveFormState> {
  try {
    const response = await post(
      routes.preferences,
      '/api/notifications/preferences',
      { version: 2, choices: choicesFromForm(form) },
    );
    if (!response.ok) return saveRefused(form);
  } catch {
    return saveRefused(form);
  }
  revalidatePath('/settings');
  return done;
}

/** Files what the page's form names through /api/content-reports, then comes back. */
export async function reportFromPageAction(
  returnTo: string,
  form: FormData,
): Promise<never> {
  const result = await submitReport(
    inProcessFetch(routes.report, new Headers(await headers())),
    form,
  );
  redirect(`${backTo(returnTo)}?report=${result}`);
}
