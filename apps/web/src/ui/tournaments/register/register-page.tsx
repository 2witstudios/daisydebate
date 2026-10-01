import type { RegisterScreen } from '../../../features/tournaments/register-flow';
import {
  rulesLabel,
  structureLabel,
} from '../../../features/tournaments/labels';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { FactList } from '../fact-list/fact-list';
import { PageHeader } from '../../components/page-header/page-header';
import { PageFrame } from '../page-frame/page-frame';
import { RefusalCard } from './refusal';
import { Stepper } from './stepper';
import { DoneStep, EligibilityStep, EntryStep, ReviewStep } from './steps';

type Flow = Extract<RegisterScreen, { kind: 'flow' }>;

function Current({ flow }: { readonly flow: Flow }) {
  switch (flow.step) {
    case 'eligibility':
      return <EligibilityStep flow={flow} />;
    case 'entry':
      return <EntryStep flow={flow} />;
    case 'review':
      return <ReviewStep flow={flow} />;
    case 'done':
      return <DoneStep flow={flow} />;
  }
}

/** The registration flow for one tournament, or why it is refused. */
export function RegisterPage({ screen }: { readonly screen: RegisterScreen }) {
  const { tournament } = screen;
  return (
    <PageFrame>
      <Breadcrumb
        trail={[
          { label: 'Tournaments', href: tournamentRoutes.index },
          {
            label: tournament.name,
            href: tournamentRoutes.detail(tournament.id),
          },
          { label: 'Register' },
        ]}
      />
      <PageHeader title={`Register for ${tournament.name}`} />
      {screen.kind === 'refused' ? (
        <RefusalCard
          reason={screen.reason}
          tournament={tournament}
          viewer={screen.viewer}
        />
      ) : (
        <>
          <Stepper label="Registration steps" steps={screen.steps} />
          <div className="flex items-start gap-6 max-rail:flex-col">
            <div className="flex min-w-0 flex-1 flex-col gap-4 max-rail:w-full">
              <Current flow={screen} />
            </div>
            <aside
              aria-label="Your entry"
              className="flex w-rail shrink-0 flex-col gap-3 rounded-xl bg-surface p-6 shadow-1 max-rail:w-full"
            >
              <p className="text-xs font-bold tracking-widest text-ink-muted uppercase">
                Your entry
              </p>
              <p className="text-md font-strong text-ink">{tournament.name}</p>
              <p className="text-sm text-ink-muted">
                {`${structureLabel(tournament.structure)}, ${rulesLabel(tournament.rules).toLowerCase()}`}
              </p>
              <FactList facts={screen.summary} />
            </aside>
          </div>
        </>
      )}
    </PageFrame>
  );
}
