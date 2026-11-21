import { createId } from '@paralleldrive/cuid2';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { StandingLobbyManagement } from '../../../../../features/tab/reads/standing-lobby-management';
import type { TimelineRail } from '../../../../../features/tab/tournament';
import { hostRoutes } from '../../../../../features/tab/routes';
import { PageHeader } from '../../../../../ui/components/page-header/page-header';
import { HostShell } from '../../../../../ui/tab/host-shell/host-shell';
import { StandingLobby } from '../../../../../ui/tab/standing-lobby-management/lobby';
import { StandingLobbyEditor } from '../../../../../ui/tab/standing-lobby-management/editor';
import { submitStandingLobby } from './lobby-actions';

type Selection = {
  readonly lobby?: string;
  readonly panel?: string;
  readonly item?: string;
};
const dayOf = (value: Date | null) => value?.toISOString().slice(0, 10) ?? '';

export function StandingLobbyPage({
  slug,
  read,
  rail,
  selection,
}: {
  readonly slug: string;
  readonly read: StandingLobbyManagement;
  readonly rail: TimelineRail;
  readonly selection: Selection;
}) {
  const league = hostRoutes.league(slug);
  const lobby = read.lobbies.find(({ id }) => id === selection.lobby);
  const panel = selection.panel;
  if (panel && !read.canManage) notFound();
  if ((selection.lobby && !lobby) || (!lobby && panel !== 'new-lobby'))
    notFound();

  const organizationId = read.organizationId;
  const commandId = createId();
  const context = { slug, commandId, organizationId };
  const manage = lobby
    ? hostRoutes.standingLobbies(slug, { lobby: lobby.id })
    : league;
  const address = lobby ? { ...context, lobbyId: lobby.id } : null;
  const season = lobby?.seasons.find(
    ({ id, status }) => id === selection.item && status === 'active',
  );
  const ladder = lobby?.ladders.find(({ id }) => id === selection.item);

  const editor = (() => {
    if (panel === 'new-lobby' && !lobby)
      return {
        title: 'New lobby',
        lede: `Create a standing lobby for ${read.name}.`,
        form: (
          <StandingLobbyEditor
            editor={{ kind: 'lobby' }}
            action={submitStandingLobby.bind(null, {
              ...context,
              kind: 'new-lobby',
            })}
            initialValues={{}}
            submitLabel="Create lobby"
            cancel={league}
          />
        ),
      };
    if (!lobby || !address) notFound();
    const lede = `${lobby.name} · ${read.name}`;
    switch (panel) {
      case undefined:
        return null;
      case 'edit-lobby':
        return {
          title: 'Edit lobby',
          lede: read.name,
          form: (
            <StandingLobbyEditor
              editor={{ kind: 'lobby' }}
              action={submitStandingLobby.bind(null, {
                ...address,
                kind: 'edit-lobby',
                lobbyVersion: lobby.version,
              })}
              initialValues={{ name: lobby.name, ageRule: lobby.ageRule }}
              submitLabel="Save changes"
              cancel={manage}
            />
          ),
        };
      case 'ladder':
        if (selection.item && !ladder) notFound();
        return {
          title: ladder ? 'Edit ladder' : 'New ladder',
          lede,
          form: (
            <StandingLobbyEditor
              editor={{ kind: 'ladder', lobbyName: lobby.name }}
              action={submitStandingLobby.bind(null, {
                ...address,
                kind: 'ladder',
                lobbyVersion: lobby.version,
                ladderId: ladder?.id ?? null,
              })}
              initialValues={{ name: ladder?.name ?? '' }}
              submitLabel={ladder ? 'Save changes' : 'Create ladder'}
              cancel={manage}
            />
          ),
        };
      case 'open-season':
        if (
          lobby.ladders.length === 0 ||
          lobby.seasons.some(({ status }) => status === 'active')
        )
          notFound();
        return {
          title: 'Open season',
          lede,
          form: (
            <StandingLobbyEditor
              editor={{ kind: 'open-season', today: read.today }}
              action={submitStandingLobby.bind(null, {
                ...address,
                kind: 'open-season',
              })}
              initialValues={{}}
              submitLabel="Open season"
              cancel={manage}
            />
          ),
        };
      case 'edit-season':
      case 'close-season':
        if (!season) notFound();
        return {
          title:
            panel === 'edit-season' ? 'Edit season' : `Close ${season.name}`,
          lede,
          form: (
            <StandingLobbyEditor
              editor={
                panel === 'edit-season'
                  ? { kind: panel }
                  : {
                      kind: panel,
                      lobbyName: lobby.name,
                      seasonName: season.name,
                    }
              }
              action={submitStandingLobby.bind(null, {
                ...address,
                kind: panel,
                seasonId: season.id,
                seasonVersion: season.version,
              })}
              initialValues={{ name: season.name, ends: dayOf(season.endsAt) }}
              submitLabel={
                panel === 'edit-season' ? 'Save changes' : 'Close season'
              }
              cancel={manage}
            />
          ),
        };
      default:
        notFound();
    }
  })();
  return (
    <HostShell rail={rail} current="league">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap gap-2 text-sm text-ink-muted"
      >
        <Link href={league}>League</Link>
        <span aria-hidden="true">/</span>
        {lobby && editor ? (
          <Link href={manage}>{lobby.name}</Link>
        ) : (
          <span>Standing lobbies</span>
        )}
      </nav>
      {editor ? (
        <>
          <PageHeader title={editor.title} lede={editor.lede} />
          {editor.form}
        </>
      ) : lobby ? (
        <StandingLobby
          slug={slug}
          name={read.name}
          lobby={lobby}
          canManage={read.canManage}
        />
      ) : null}
    </HostShell>
  );
}
