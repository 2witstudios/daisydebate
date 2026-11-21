import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createId } from '@paralleldrive/cuid2';
import { hostedTournamentsViewSchema } from '@daisy/protocol/lobby/hosting-read';
import {
  signInHref,
  type SearchParams,
} from '../../../features/access/decision';
import { hostedTournamentsPath } from '../../../features/hosting-purchases/routes';
import { linkTo } from '../../../features/tab/action';
import { requireHostTiersRelease } from '../../../features/tab/release';
import { hostRoutes } from '../../../features/tab/routes';
import {
  requestHostedLeagues,
  requestIdentity,
} from '../../../lib/request-session';
import { CreateTournamentForm } from '../../../ui/hosting/create-tournament-form';
import { HostingHome } from '../../../ui/hosting/hosting-home';
import { GET } from '../../api/tab/hosted-tournaments/route';
import { readOwnRoute } from '../../(shell)/friends/read-route';
import { createTournamentAction } from './actions';

export const metadata: Metadata = { title: 'Host' };

/** Six letters and digits from the id generator's CSPRNG, for a unique handle. */
const handleSuffix = () => createId().slice(-6);

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireHostTiersRelease();
  // /host stays a public root; its home is for a signed-in member.
  if ((await requestIdentity()).state !== 'member')
    redirect(signInHref(hostRoutes.home));
  const hosted = await readOwnRoute(
    GET,
    hostedTournamentsPath,
    hostedTournamentsViewSchema,
  );
  if (!hosted) notFound();
  const open = (await searchParams).new === '1';
  return (
    <HostingHome
      rail={{
        title: 'Host',
        subtitle: null,
        heading: 'Coming up',
        items: hosted.tournaments.map((tournament) => ({
          id: tournament.handle,
          label: tournament.name,
          time: null,
          standing: null,
          action: linkTo(tournament.name, hostRoutes.setup(tournament.handle)),
        })),
        footHeading: null,
        foot: [],
      }}
      hosted={hosted}
      leagues={(await requestHostedLeagues()).map((league) => ({
        ...league,
        href: hostRoutes.league(league.handle),
      }))}
      open={open}
      newHref={`${hostRoutes.home}?new=1`}
      closeHref={hostRoutes.home}
      addressOf={(handle) => hostRoutes.setup(handle)}
      createForm={
        <CreateTournamentForm
          action={createTournamentAction.bind(null, {
            lobbyCommandId: createId(),
            eventCommandId: createId(),
            divisionCommandId: createId(),
            suffix: handleSuffix(),
          })}
        />
      }
    />
  );
}
