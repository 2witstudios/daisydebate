import Link from 'next/link';
import type { CardCreateView } from '../../../features/prep/card-create';
import { buttonClass } from '../../components/button/button-class';
import {
  controlClass,
  fieldClass,
  helperClass,
  labelClass,
  textareaClass,
} from '../form-controls/form-class';
import { InertActionButton } from '../inert-action/inert-action';
import { StateAlert } from '../state-alert/state-alert';
import { citeFields, type CiteField } from './create-fields';

const inert = {
  save: {
    label: 'Save card',
    reason: 'Saving a card needs the Prep service, which is not built yet.',
  },
  saveAdd: {
    label: 'Save and add to brief',
    reason: 'Saving a card needs the Prep service, which is not built yet.',
  },
} as const;

const valueOf = (field: CiteField, view: CardCreateView): string => {
  const { fields } = view.cite;
  switch (field.key) {
    case 'tagLine':
    case 'tags':
      return '';
    case 'retrieved':
      return '[yyyy-mm-dd]';
    default:
      return fields[field.key];
  }
};

/** Step 3: the citation. Every field is a plain control; saving is inert. */
export function CreateCiteStep({ view }: { readonly view: CardCreateView }) {
  return (
    <section aria-labelledby="cite-heading" className="flex flex-col gap-4">
      <h2 id="cite-heading" className="text-lg font-bold">
        Cite the source
      </h2>
      {view.cite.notice === null ? null : (
        <StateAlert notice={view.cite.notice} />
      )}
      <div
        id="citation"
        className="grid grid-cols-2 gap-4 max-compact:grid-cols-1"
      >
        {citeFields.map((field) => (
          <div
            key={field.id}
            className={`${fieldClass} ${field.wide ? 'col-span-2 max-compact:col-span-1' : ''}`}
          >
            <label htmlFor={field.id} className={labelClass}>
              {field.label}
              {field.required ? (
                <span className="font-book text-ink-faint"> (required)</span>
              ) : null}
            </label>
            {field.multiline ? (
              <textarea
                id={field.id}
                name={field.id}
                rows={3}
                defaultValue={valueOf(field, view)}
                placeholder={field.placeholder}
                className={textareaClass}
              />
            ) : (
              <input
                id={field.id}
                name={field.id}
                type="text"
                defaultValue={valueOf(field, view)}
                placeholder={field.placeholder}
                className={controlClass}
              />
            )}
            {field.helper === undefined ? null : (
              <p className={helperClass}>{field.helper}</p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view.backHref === null ? null : (
          <Link
            href={view.backHref}
            className={`${buttonClass('secondary')} no-underline hover:no-underline`}
          >
            Back
          </Link>
        )}
        <div className="flex flex-wrap gap-3">
          <InertActionButton action={inert.saveAdd} />
          <InertActionButton
            action={inert.save}
            variant="primary"
            symbol="check"
          />
        </div>
      </div>
    </section>
  );
}
