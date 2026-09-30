import Link from 'next/link';
import type { BriefCardRef, BriefResponse } from '../../../features/prep/brief';
import { inertActions } from '../../../features/prep/actions';
import {
  fieldClass,
  helperClass,
  textareaClass,
  controlClass,
} from '../form-controls/form-class';
import { IconButtonInert } from '../inert-action/icon-button-inert';
import { InertActionButton } from '../inert-action/inert-action';
import { ItemTile } from '../item-tile/item-tile';
import { PrepIcon } from '../prep-icon/prep-icon';

/** A labelled plain control with its running word count and helper. */
export function WordField(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly words?: number;
  readonly helper?: string;
  readonly rows?: number;
  readonly single?: boolean;
  readonly placeholder?: string;
}) {
  return (
    <div className={fieldClass}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={props.id} className="text-sm font-strong">
          {props.label}
        </label>
        {props.words === undefined ? null : (
          <span className="text-xs text-ink-faint">{`${props.words} words`}</span>
        )}
      </div>
      {props.single ? (
        <input
          id={props.id}
          name={props.id}
          type="text"
          defaultValue={props.value}
          placeholder={props.placeholder}
          className={controlClass}
        />
      ) : (
        <textarea
          id={props.id}
          name={props.id}
          rows={props.rows ?? 3}
          defaultValue={props.value}
          placeholder={props.placeholder}
          className={textareaClass}
        />
      )}
      {props.helper === undefined ? null : (
        <p className={helperClass}>{props.helper}</p>
      )}
    </div>
  );
}

/** The evidence attached to a section, with attach and find actions. */
export function EvidenceList(props: {
  readonly cards: readonly BriefCardRef[];
  readonly showCount: boolean;
  readonly findHref?: string;
}) {
  const { cards } = props;
  return (
    <section aria-label="Evidence" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-md font-strong">Evidence</h3>
        {props.showCount ? (
          <span className="text-sm text-ink-muted">{`${cards.length} attached`}</span>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <p className="text-sm text-ink-muted">No card attached yet.</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border">
          {cards.map((card) => (
            <li
              key={card.cardId}
              className="flex min-h-16 items-center gap-3 border-t border-border bg-surface-raised px-3 py-2 first:border-t-0"
            >
              <ItemTile kind="card" />
              <Link
                href={`/prep/cards/${card.cardId}`}
                className="flex min-w-0 flex-1 flex-col no-underline hover:no-underline"
              >
                <span className="text-base font-strong text-ink">
                  {card.title}
                </span>
                <span className="text-sm text-ink-muted">
                  {`${card.cite} · reads in ${card.words} words`}
                </span>
              </Link>
              <IconButtonInert label="Move up" symbol="arrowUp" />
              <IconButtonInert label="Detach card" symbol="x" />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <InertActionButton action={inertActions.attachCard} symbol="plus" />
        {props.findHref === undefined ? null : (
          <Link
            href={props.findHref}
            className="inline-flex items-center gap-1 font-strong"
          >
            <PrepIcon name="search" size={16} />
            Find in library
          </Link>
        )}
      </div>
    </section>
  );
}

/** They-say and we-say pairs. */
export function ResponseList(props: {
  readonly responses: readonly BriefResponse[];
}) {
  return (
    <ul className="flex flex-col gap-2">
      {props.responses.map((response) => (
        <li
          key={response.say}
          className="flex flex-col gap-1 rounded-md border border-border bg-surface-raised p-3 text-sm"
        >
          <p>
            <strong className="font-semibold">They say </strong>
            {response.say}
          </p>
          <p className="text-ink-muted">
            <strong className="font-semibold">We say </strong>
            {response.we}
          </p>
        </li>
      ))}
    </ul>
  );
}
