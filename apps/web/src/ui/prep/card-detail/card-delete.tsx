import Link from 'next/link';
import type { Card } from '../../../features/prep/card';
import { inertActions } from '../../../features/prep/actions';
import { deleteInUse } from '../../../features/prep/notices';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { InertActionButton } from '../inert-action/inert-action';
import { StateAlert } from '../state-alert/state-alert';

/**
 * The delete confirmation. A card still used somewhere raises the in-use
 * alert; an unused one asks plainly. Deleting itself needs the service.
 */
export function CardDelete({ card }: { readonly card: Card }) {
  const back = `/prep/cards/${card.id}`;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      <Breadcrumb
        crumbs={[
          { label: 'Prep', href: '/prep' },
          { label: card.tagLine, href: back },
          { label: 'Delete' },
        ]}
      />
      <h1 className="font-display text-2xl leading-tight font-bold">{`Delete “${card.tagLine}”?`}</h1>
      {card.uses.length > 0 ? (
        <StateAlert notice={deleteInUse(card.uses.length, back)} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-base text-ink-muted">This cannot be undone.</p>
          <div className="flex gap-3">
            <InertActionButton action={inertActions.deleteCard} />
            <Link href={back} className="self-center">
              Keep card
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
