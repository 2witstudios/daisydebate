import type { TournamentsIndex } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ActionLink } from '../action-control/action-control';
import { TournamentGroups } from '../tournament-groups/tournament-groups';

/** The tournaments index: the viewer's own, what is open to enter, and recent ones. */
export function TournamentsDirectory({
  index,
}: {
  readonly index: TournamentsIndex;
}) {
  return (
    <ReadingPage>
      <PageHeader title="Tournaments" />
      <TournamentGroups label="Tournaments" groups={index.groups} />
      {index.host === null ? null : (
        <ActionLink action={index.host} className="self-start" />
      )}
    </ReadingPage>
  );
}
