import { MediaAccount } from '../../ui/round-media/media-account';
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
import { SelfCard, type SelfCards } from '../../ui/people/self-card';
import type { ChosenStatus } from '@daisy/protocol/presence-setting';
import type { ShellAccount } from '../../ui/layout/app-shell/account';
import { acknowledgeNoticeAction } from './moderation/actions';
import { readModerationNotices } from './moderation/read-notices';
import { readChosenStatus } from './people/read-people';
import { ModerationNotices } from '../../ui/moderation/moderation-notices';
import { shellAccount } from '../../lib/shell-account';
import { requestIdentity } from '../../lib/page-reads';
import {
  requestMemberDivision,
  requestMemberStandings,
} from '../../features/ratings/page-reads';
import { requestOwnProfileCard } from '../../features/profile/page-reads';
import { requestRealtimeEndpoint } from '../../features/realtime/page-reads';
import type { ShellRatings } from '../../ui/layout/app-shell/account';
import { requestActiveRoom } from './active-room';
import { toggleRail } from './rail-actions';
import { VisitorFeatures } from '../visitor-features';

/** A member's card in each place it sits: the people rail, its mini form, the phone's More. */
function selfCards(
  account: Extract<ShellAccount, { readonly state: 'member' }>,
  ratings: Promise<ShellRatings>,
  chosen: ChosenStatus | null,
): SelfCards {
  const props = {
    username: account.username,
    displayName: account.displayName,
    photoId: account.photoId,
    ratings,
  };
  // Each place gets its own status form, as each list's rows are its own.
  const status = () =>
    chosen ? (
      <StatusForm action={setStatusAction} chosen={chosen} />
    ) : undefined;
  return {
    card: <SelfCard {...props} statusControl={status()} />,
    mini: <SelfCard {...props} compact statusControl={status()} />,
    sheet: <SelfCard {...props} statusControl={status()} />,
  };
}

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
 * member's ratings start reading here but are not awaited: their card
 * streams the headline rating in, so the page never waits on it.
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
  const memberReads =
    identity.state === 'member'
      ? Promise.all([
          readChosenStatus(),
          readModerationNotices(),
          // A failed read shows the username and initials, as before ADR 0143.
          requestOwnProfileCard(identity.principal.actorId).catch(() => null),
        ])
      : Promise.resolve([null, [], null] as const);
  // Your card, built once the status and profile card are read: the people
  // rail waits for it beside its own reads, so neither waits on the other.
  const self = memberReads.then(([chosen, , card]) => {
    const account = shellAccount(identity, card);
    return account.state === 'member' && ratings
      ? selfCards(account, ratings, chosen)
      : null;
  });
  const people =
    identity.state === 'member'
      ? await PeopleShell({
          actorId: identity.principal.actorId,
          socketUrl: requestRealtimeEndpoint(),
          preference: peopleRail,
          activeRoomId: activeRoom?.id ?? null,
          self,
        })
      : null;
  const [, notices, card] = await memberReads;
  const cards = await self;
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
          toggleRail={toggleRail}
          people={people}
          selfCard={cards?.sheet}
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
