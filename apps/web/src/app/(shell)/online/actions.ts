'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { systemId } from '@daisy/clock';
import {
  challengeListSchema,
  challengeResultSchema,
  contactBlockResultSchema,
  presenceSettingResultSchema,
  reportResultSchema,
} from '@daisy/protocol';
import {
  challengeFormUnavailable,
  challengeRefusal,
  type ChallengeFormState,
} from '../../../features/challenges/forms';
import {
  challengeRoomForm,
  templateFor,
} from '../../../features/challenges/room';
import { readRoomTemplates } from '../../../features/rooms/read-catalog';
import { submitRoomCreation } from '../../../features/rooms/create-room-form';
import {
  presenceFormUnavailable,
  type PresenceFormState,
} from '../../../features/presence/form';
import {
  personBlockedNotice,
  personBlockFailedNotice,
  type PersonBlockState,
} from '../../../features/contacts/block-form';
import {
  reportDoneNotice,
  reportFailedNotice,
  type ReportFormState,
} from '../../../features/reports/form';
import type { CreationFormState } from '../../../features/messaging/forms/create-form';
import { requestIdentity } from '../../../lib/request-session';
import { activeRoomRead } from '../actions';
import { createConversationAction } from '../messages/new/actions';
import { moveOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import {
  isOnlineRailChoice,
  ONLINE_RAIL_COOKIE,
  RAIL_COOKIE_OPTIONS,
} from '../../../ui/layout/app-shell/rail-preference';

const routes = {
  status: processRoute((all) => all.presence.set),
  send: processRoute((all) => all.challenges.send),
  list: processRoute((all) => all.challenges.list),
  accept: processRoute((all) => all.challenges.accept),
  decline: processRoute((all) => all.challenges.decline),
  cancel: processRoute((all) => all.challenges.cancel),
  report: processRoute((all) => all.reports.file),
  acknowledge: processRoute((all) => all.reports.acknowledge),
  block: processRoute((all) => all.contacts.blockByUsername),
  createRoom: processRoute((all) => all.rooms.create),
  catalog: processRoute((all) => all.rooms.catalog),
};

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

/** Posts as this request, through the route a script would call. */
const post = async (
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  inProcessFetch(route, new Headers(await headers()))(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** The rail's open or collapsed choice; a native POST, remembered per member. */
export async function setOnlineRail(form: FormData): Promise<void> {
  const choice = form.get('rail');
  if (!isOnlineRailChoice(choice)) return;
  (await cookies()).set(ONLINE_RAIL_COOKIE, choice, RAIL_COOKIE_OPTIONS);
}

/** The member's own status, from the account menu. */
export async function setStatusAction(
  _previous: PresenceFormState,
  form: FormData,
): Promise<PresenceFormState> {
  try {
    const response = await post(routes.status, '/api/presence', {
      version: 1,
      status: text(form, 'status'),
    });
    const result = presenceSettingResultSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    return result.success
      ? { status: result.data.status }
      : presenceFormUnavailable();
  } catch {
    return presenceFormUnavailable();
  }
}

/** Offers a debate: nothing exists until the other member accepts. */
export async function sendChallengeAction(
  _previous: ChallengeFormState,
  form: FormData,
): Promise<ChallengeFormState> {
  try {
    const response = await post(routes.send, '/api/challenges', {
      version: 1,
      commandId: systemId.next(),
      username: text(form, 'username'),
      mode: text(form, 'mode'),
      format: text(form, 'format'),
    });
    if (!response.ok)
      return { notice: challengeRefusal('send', response.status) };
    return challengeResultSchema.safeParse(await response.json()).success
      ? { sent: true, notice: 'Challenge sent.' }
      : challengeFormUnavailable();
  } catch {
    return challengeFormUnavailable();
  }
}

/**
 * Accepts: the acceptor opens the agreed room through the one room-create
 * route, then names it on the challenge, which rings the challenger, then both
 * of them go there. A room that opens but cannot be named still holds them.
 */
export async function acceptChallengeAction(
  _previous: ChallengeFormState,
  form: FormData,
): Promise<ChallengeFormState> {
  const identity = await requestIdentity();
  if (identity.state !== 'member')
    return { notice: challengeRefusal('accept', 404) };
  const incoming = new Headers(await headers());
  const challengeId = text(form, 'challengeId');
  try {
    const listed = await inProcessFetch(routes.list, incoming)(
      '/api/challenges',
      { method: 'GET' },
    );
    const list = challengeListSchema
      .loose()
      .safeParse(listed.ok ? await listed.json() : null);
    const offer = list.success
      ? list.data.incoming.find((row) => row.id === challengeId)
      : undefined;
    if (!offer) return { notice: challengeRefusal('accept', 404) };
    // A member already in a room finishes there first; nothing else is opened.
    if ((await activeRoomRead()) !== null)
      return { notice: challengeRefusal('accept-placed', 409) };
    const catalog = await readRoomTemplates(
      inProcessFetch(routes.catalog, incoming),
    );
    const template =
      catalog.kind === 'found'
        ? templateFor(catalog.choices, offer.format)
        : undefined;
    if (!template || catalog.kind !== 'found')
      return { notice: challengeRefusal('accept', 500) };
    let notNamed: string | undefined;
    const created = await submitRoomCreation(
      inProcessFetch(routes.createRoom, incoming),
      incoming,
      challengeRoomForm({
        host: identity.username,
        opponent: offer.username,
        mode: offer.mode,
        template,
        commandId: systemId.next(),
        resolutions: catalog.resolutions,
      }),
      '/api/rooms',
      async (roomId) => {
        try {
          const named = await inProcessFetch(routes.accept, incoming)(
            '/api/challenges/accept',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ version: 1, challengeId, roomId }),
            },
          );
          if (named.ok) return undefined;
          notNamed = challengeRefusal(
            named.status === 404 ? 'accept-lost' : 'accept-unnamed',
            named.status,
          );
        } catch {
          notNamed = challengeRefusal('accept-unnamed', 500);
        }
        return notNamed;
      },
      moveOn,
    );
    if (created.next !== undefined) return { next: created.next };
    return {
      notice:
        notNamed ??
        (offer.mode === 'ranked'
          ? challengeRefusal('accept-ranked', 500)
          : (created.error ?? challengeRefusal('accept', 500))),
    };
  } catch (error) {
    // moveOn's redirect for a native post is not a failure.
    if (isRedirect(error)) throw error;
    return challengeFormUnavailable();
  }
}

const isRedirect = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'digest' in error &&
  String((error as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');

/** Declines or withdraws an open offer. */
export async function endChallengeAction(
  _previous: ChallengeFormState,
  form: FormData,
): Promise<ChallengeFormState> {
  const command = text(form, 'command') === 'cancel' ? 'cancel' : 'decline';
  try {
    const response = await post(routes[command], `/api/challenges/${command}`, {
      version: 1,
      challengeId: text(form, 'challengeId'),
    });
    return response.ok
      ? {}
      : { notice: challengeRefusal('end', response.status) };
  } catch {
    return challengeFormUnavailable();
  }
}

/** Opens a conversation from the menu, minting its request here: a row has none. */
export async function messagePersonAction(
  previous: CreationFormState,
  form: FormData,
): Promise<CreationFormState> {
  form.set('requestId', systemId.next());
  return createConversationAction('dm', previous, form);
}

/** Reports a member, with a reason. */
export async function reportAction(
  _previous: ReportFormState,
  form: FormData,
): Promise<ReportFormState> {
  try {
    const response = await post(routes.report, '/api/reports', {
      version: 1,
      username: text(form, 'username'),
      reason: text(form, 'reason'),
      surface: text(form, 'surface'),
    });
    const result = reportResultSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    return result.success
      ? { done: true, notice: reportDoneNotice }
      : { notice: reportFailedNotice };
  } catch {
    return { notice: reportFailedNotice };
  }
}

/** Blocks a member, through Contacts' own route. */
export async function blockAction(
  _previous: PersonBlockState,
  form: FormData,
): Promise<PersonBlockState> {
  try {
    const response = await post(routes.block, '/api/contacts/username', {
      version: 1,
      requestId: systemId.next(),
      username: text(form, 'username'),
      blocked: true,
    });
    const result = contactBlockResultSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    return result.success
      ? { done: true, notice: personBlockedNotice }
      : { notice: personBlockFailedNotice };
  } catch {
    return { notice: personBlockFailedNotice };
  }
}

/** Marks a warning read. A form with no typed input, so a failure stays silent. */
export async function acknowledgeNoticeAction(form: FormData): Promise<void> {
  await post(routes.acknowledge, '/api/reports/notices', {
    version: 1,
    id: text(form, 'id'),
  });
  revalidatePath('/', 'layout');
}
