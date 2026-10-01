import { tournamentRoutes } from '../../../../features/tournaments/routes';
import { LinkButton } from '../../../../ui/tournaments/link-button/link-button';
import {
  PageFrame,
  PageHeader,
} from '../../../../ui/tournaments/page-frame/page-frame';

export default function TournamentNotFound() {
  return (
    <PageFrame>
      <PageHeader
        title="We could not find that tournament"
        lede="It may have been removed, or the link is wrong."
        actions={
          <LinkButton href={tournamentRoutes.index} variant="primary">
            Browse tournaments
          </LinkButton>
        }
      />
    </PageFrame>
  );
}
