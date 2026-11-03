import { MediaAccount } from '../../features/round-media/media-account';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { SampleActionNotice } from '../../ui/components/sample-action/sample-action-notice';
import { AppShell } from '../../ui/layout/app-shell/app-shell';
import {
  ONLINE_RAIL_COOKIE,
  parseOnlineRail,
  parseRailPreference,
  RAIL_COOKIE,
} from '../../ui/layout/app-shell/rail-preference';
import { UiStoreProvider } from '../../ui/store/store';
import { OnlineShell } from './online/online-shell';
import { setStatusAction } from './online/actions';
import { StatusForm } from '../../ui/online/status-form';
import { acknowledgeNoticeAction } from './moderation/actions';
import { readModerationNotices } from './moderation/read-notices';
import { readChosenStatus } from './online/read-online';
import { ModerationNotices } from '../../ui/moderation/moderation-notices';
import { shellAccount } from '../../lib/shell-account';
import {
  requestIdentity,
  requestMemberStandings,
} from '../../lib/request-session';
import type { ShellRatings } from '../../ui/layout/app-shell/account';
import { requestActiveRoom } from './active-room';
import { toggleRail } from './rail-actions';

/**
 * The signed-in product shell: renders AppShell's landmarks once (header,
 * nav, topic banner, content column, presence dock) and resolves the account once per
 * request, so every route in this group inherits the chrome instead of each
 * page composing it for itself. The root layout above keeps only <html>,
 * theme and fonts. The sample-action banner sits above every page: a control
 * with no backend answers with it on the same page. A member's active
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
  const onlineRail = parseOnlineRail(jar.get(ONLINE_RAIL_COOKIE)?.value);
  const online =
    identity.state === 'member'
      ? await OnlineShell({
          preference: onlineRail,
          activeRoomId: activeRoom?.id ?? null,
        })
      : null;
  const [chosen, notices] =
    identity.state === 'member'
      ? await Promise.all([readChosenStatus(), readModerationNotices()])
      : [null, []];
  const ratings: Promise<ShellRatings> | null =
    identity.state === 'member'
      ? requestMemberStandings(identity.username).then(
          (standings): ShellRatings => ({ state: 'ready', standings }),
          (): ShellRatings => ({ state: 'unavailable' }),
        )
      : null;
  return (
    <UiStoreProvider>
      <MediaAccount
        actorId={
          identity.state === 'member' ? identity.principal.actorId : null
        }
      />
      <AppShell
        account={shellAccount(identity)}
        activeRoom={activeRoom}
        rail={rail}
        ratings={ratings}
        toggleRail={toggleRail}
        online={online}
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
        <Suspense fallback={null}>
          <SampleActionNotice />
        </Suspense>
        {children}
      </AppShell>
    </UiStoreProvider>
  );
}
