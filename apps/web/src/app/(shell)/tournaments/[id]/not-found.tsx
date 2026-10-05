import { tournamentRoutes } from '../../../../features/tournaments/routes';
import { LinkButton } from '../../../../ui/tournaments/link-button/link-button';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { PageFrame } from '../../../../ui/tournaments/page-frame/page-frame';

export default function TournamentNotFound() {
  return (
    <PageFrame>
      <PageHeader
        title="We could not find that tournament"
        actions={
          <LinkButton href={tournamentRoutes.index} variant="primary">
            Browse tournaments
          </LinkButton>
        }
      />
    </PageFrame>
  );
}
