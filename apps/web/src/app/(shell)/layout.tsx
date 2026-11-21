import { MediaAccount } from '../../features/round-media/media-account';
import { cookies } from 'next/headers';
import { AppShell } from '../../ui/layout/app-shell/app-shell';
import {
  PEOPLE_RAIL_COOKIE,
  parsePeopleRail,
  parseRailPreference,
  RAIL_COOKIE,
} from '../../ui/layout/app-shell/rail-preference';
import { UiStoreProvider } from '../../ui/store/store';
import { PeopleShell } from './people/people-shell';
import { setStatusAction } from './people/actions';
import { StatusForm } from '../../ui/people/status-form';
import { acknowledgeNoticeAction } from './moderation/actions';
import { readModerationNotices } from './moderation/read-notices';
import { readChosenStatus } from './people/read-people';
import { ModerationNotices } from '../../ui/moderation/moderation-notices';
import { shellAccount } from '../../lib/shell-account';
import {
  requestIdentity,
  requestMemberDivision,
  requestMemberStandings,
  requestOwnProfileCard,
} from '../../lib/request-session';
import type { ShellRatings } from '../../ui/layout/app-shell/account';
import { requestActiveRoom } from './active-room';
import { toggleRail } from './rail-actions';
import { VisitorFeatures } from '../visitor-features';

/**
 * The signed-in product shell: renders AppShell's landmarks once (header,
 * nav, topic banner, content column, presence dock) and resolves the account once per
 * request, so every route in this group inherits the chrome instead of each
 * page composing it for itself, and renders the visitor features (ADR 0123).
 * The root layout above keeps only <html>, theme and fonts. The
 * sample-action banner sits above every page: a control with no backend
 * answers with it on the same page. A member's active
 * Room (ADR 0070) shows its way back on every page but its own. The rail
 * width is a cookie read per request (validated: it is untrusted), so the
 * served HTML already carries the viewer's rail (ADR 0091), and the toggle's
 * server action travels down as a prop: ui/ never imports from app/. The
 * member's ratings start reading here but are not awaited: the account menu
 * streams them in, so the page never waits on them.
 */
export default async function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requestIdentity();
  const activeRoom =
    identity.state === 'member' ? await requestActiveRoom() : null;
  const jar = await cookies();
  const rail = parseRailPreference(jar.get(RAIL_COOKIE)?.value);
  const peopleRail = parsePeopleRail(jar.get(PEOPLE_RAIL_COOKIE)?.value);
  const people =
    identity.state === 'member'
      ? await PeopleShell({
          actorId: identity.principal.actorId,
          preference: peopleRail,
          activeRoomId: activeRoom?.id ?? null,
        })
      : null;
  const [chosen, notices, card] =
    identity.state === 'member'
      ? await Promise.all([
          readChosenStatus(),
          readModerationNotices(),
          // A failed read shows the username and initials, as before ADR 0143.
          requestOwnProfileCard(identity.principal.actorId).catch(() => null),
        ])
      : [null, [], null];
  const ratings: Promise<ShellRatings> | null =
    identity.state === 'member'
      ? Promise.all([
          requestMemberStandings(identity.username),
          requestMemberDivision(),
        ]).then(
          ([standings, division]): ShellRatings => ({
            state: 'ready',
            standings,
            division,
          }),
          (): ShellRatings => ({ state: 'unavailable' }),
        )
      : null;
  return (
    <>
      <UiStoreProvider>
        {/* An unread identity says nothing about who this is: a refusal is no sign-out. */}
        {identity.state === 'unavailable' ? null : (
          <MediaAccount
            actorId={
              identity.state === 'member' ? identity.principal.actorId : null
            }
          />
        )}
        <AppShell
          account={shellAccount(identity, card)}
          activeRoom={activeRoom}
          rail={rail}
          ratings={ratings}
          toggleRail={toggleRail}
          people={people}
          statusControl={
            chosen ? (
              <StatusForm action={setStatusAction} chosen={chosen} />
            ) : undefined
          }
        >
          <ModerationNotices
            notices={notices}
            acknowledge={acknowledgeNoticeAction}
          />
          {children}
        </AppShell>
      </UiStoreProvider>
      <VisitorFeatures />
    </>
  );
}
