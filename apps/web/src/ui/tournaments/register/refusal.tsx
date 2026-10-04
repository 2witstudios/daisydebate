import { onboardingHref } from '../../../features/access/decision';
import { bandLabel } from '../../../features/tournaments/labels';
import type { Refusal } from '../../../features/tournaments/register-flow';
import { registerHref } from '../../../features/tournaments/register-flow';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import type { Tournament } from '../../../features/tournaments/tournament';
import type { Viewer } from '../../../features/tournaments/entry';
import { Icon } from '../../components/icon/icon';
import { LinkButton } from '../link-button/link-button';

type Copy = {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly actions: readonly {
    readonly label: string;
    readonly href: string;
    readonly primary?: boolean;
  }[];
};

function copyFor(
  reason: Refusal,
  tournament: Tournament,
  viewer: Viewer | null,
): Copy {
  const { id } = tournament;
  switch (reason) {
    case 'outside-band':
      return {
        title: `This tournament is for ratings ${bandLabel(tournament.band)}`,
        paragraphs: [`Your rating is ${viewer?.rating ?? 'not set'}.`],
        actions: [
          {
            label: 'See events open to me',
            href: tournamentRoutes.index,
            primary: true,
          },
          {
            label: 'Back to the tournament',
            href: tournamentRoutes.detail(id),
          },
        ],
      };
    case 'closed':
      return {
        title: 'Registration is closed',
        paragraphs: [],
        actions: [
          {
            label: 'Follow this tournament',
            href: tournamentRoutes.bracket(id),
            primary: true,
          },
          { label: 'Find another event', href: tournamentRoutes.index },
        ],
      };
    case 'no-profile':
      return {
        title: 'Create a debater profile first',
        paragraphs: [],
        actions: [
          {
            label: 'Create my profile',
            href: onboardingHref(registerHref(id, 'eligibility')),
            primary: true,
          },
          { label: 'Not now', href: tournamentRoutes.detail(id) },
        ],
      };
  }
}

/** Why the viewer cannot enter, and where to go instead. */
export function RefusalCard({
  reason,
  tournament,
  viewer,
}: {
  readonly reason: Refusal;
  readonly tournament: Tournament;
  readonly viewer: Viewer | null;
}) {
  const copy = copyFor(reason, tournament, viewer);
  return (
    <section
      aria-labelledby="refusal-title"
      className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
    >
      <div className="flex items-center gap-3">
        <span className="text-gold">
          <Icon name="alert" size={22} />
        </span>
        <h2 id="refusal-title" className="text-lg font-strong text-ink">
          {copy.title}
        </h2>
      </div>
      {copy.paragraphs.map((text) => (
        <p key={text} className="text-base text-ink-muted">
          {text}
        </p>
      ))}
      <div className="flex flex-wrap gap-3">
        {copy.actions.map((action) => (
          <LinkButton
            key={action.href}
            href={action.href}
            variant={action.primary ? 'primary' : 'secondary'}
          >
            {action.label}
          </LinkButton>
        ))}
      </div>
    </section>
  );
}
