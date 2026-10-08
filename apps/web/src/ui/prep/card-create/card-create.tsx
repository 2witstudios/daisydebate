import type { CardCreateView } from '../../../features/prep/cards/card-create';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { PrepTabs } from '../prep-tabs/prep-tabs';
import { CreateCiteStep } from './create-cite-step';
import { CreateHighlightStep } from './create-highlight-step';
import { CreatePreview } from './create-preview';
import { CreateSourceStep } from './create-source-step';

/** The three-step evidence card creator, fed by the flow driver's view. */
export function CardCreate({ view }: { readonly view: CardCreateView }) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      <Breadcrumb
        crumbs={[
          { label: 'Prep', href: '/prep' },
          { label: 'Evidence cards', href: '/prep?view=cards' },
          { label: 'New card' },
        ]}
      />
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        New evidence card
      </h1>
      <div className="flex gap-8 max-rail:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PrepTabs
            label="Steps"
            current={view.query.step}
            tabs={view.steps.map((step) => ({
              id: step.id,
              label: `${step.number}  ${step.label}`,
              href: step.href,
            }))}
          />
          {view.query.step === 'source' ? (
            <CreateSourceStep view={view} />
          ) : null}
          {view.query.step === 'highlight' ? (
            <CreateHighlightStep view={view} />
          ) : null}
          {view.query.step === 'cite' ? <CreateCiteStep view={view} /> : null}
        </div>
        <CreatePreview view={view} />
      </div>
    </div>
  );
}
