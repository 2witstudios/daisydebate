import Link from 'next/link';
import type { CaseView } from '../../../features/prep/case-view';
import { inertActions } from '../../../features/prep/actions';
import { buttonClass } from '../../components/button/button-class';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';

/** Export and print: choose a file kind and what goes in it. */
export function CaseExport({ view }: { readonly view: CaseView }) {
  const { export: exp } = view;
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="exp-format" className="flex flex-col gap-2">
        <h2 id="exp-format" className="text-md font-bold">
          Export as
        </h2>
        <ul className="flex flex-col gap-2">
          {exp.choices.map((choice) => (
            <li key={choice.id}>
              <Link
                href={choice.href}
                aria-current={choice.current ? 'true' : undefined}
                className={`flex min-h-12 flex-col rounded-md border px-4 py-3 text-ink no-underline hover:no-underline ${
                  choice.current
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface-raised'
                }`}
              >
                <span className="text-base font-strong">{choice.label}</span>
                <span className="text-sm text-ink-muted">{choice.help}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <form
        action={`/prep/cases/${view.case.id}`}
        method="get"
        aria-labelledby="exp-options"
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="view" value="export" />
        <input type="hidden" name="fmt" value={view.query.fmt} />
        <input type="hidden" name="set" value="1" />
        <h2 id="exp-options" className="text-md font-bold">
          Options
        </h2>
        <ul className="flex flex-col gap-2">
          {exp.settings.map((setting) => (
            <li key={setting.id}>
              <label className="flex min-h-12 items-start gap-3 text-base">
                <input
                  type="checkbox"
                  name="opt"
                  value={setting.id}
                  defaultChecked={setting.checked}
                  className="mt-1 size-5 accent-accent"
                />
                <span className="flex flex-col">
                  {setting.label}
                  {setting.help === null ? null : (
                    <span className="text-sm text-ink-muted">
                      {setting.help}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <button
          type="submit"
          className={`${buttonClass('secondary')} self-start`}
        >
          Update preview
        </button>
      </form>
      <section aria-labelledby="exp-preview" className="flex flex-col gap-2">
        <h2 id="exp-preview" className="text-md font-bold">
          Preview, first page
        </h2>
        <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-cream p-5 text-sm text-forest">
          {exp.preview.map((line, index) => (
            <p
              key={`${line}-${index}`}
              className={index === 0 ? 'text-2xs font-bold tracking-wider' : ''}
            >
              {line}
            </p>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap gap-3">
        <InertActionButton
          action={inertActions.exportPdf}
          variant="primary"
          symbol="download"
        />
        <InertActionButton action={inertActions.print} symbol="print" />
        <InertActionButton action={inertActions.copyText} symbol="copy" />
      </div>
      <p
        role="status"
        className="flex items-start gap-3 rounded-md bg-accent-soft p-4 text-sm"
      >
        <PrepIcon name="info" size={18} className="mt-1 text-accent" />
        <span>
          <strong className="block text-base">
            An export is a file you hold
          </strong>
          Anyone you give it to can read it, and Daisy cannot take it back.
          Share inside Daisy when you want to control who sees it.
        </span>
      </p>
    </div>
  );
}
