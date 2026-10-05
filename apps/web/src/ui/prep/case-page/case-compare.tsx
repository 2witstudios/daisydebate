import type { Change, WordSegment } from '../../../features/prep/case-diff';
import type { CaseView } from '../../../features/prep/case-view';
import { inertActions } from '../../../features/prep/actions';
import { buttonClass } from '../../components/button/button-class';
import { controlClass } from '../form-controls/form-class';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';

const opMark: Readonly<Record<Change['op'], { mark: string; cls: string }>> = {
  add: { mark: '+', cls: 'text-online' },
  remove: { mark: '−', cls: 'text-live' },
  move: { mark: '~', cls: 'text-gold' },
  edit: { mark: '~', cls: 'text-gold' },
};

const chipLabel: Readonly<Record<Change['op'], string>> = {
  add: 'added',
  remove: 'removed',
  move: 'moved',
  edit: 'edited',
};

const chipTone: Readonly<Record<Change['op'], string>> = {
  add: 'bg-accent-soft text-accent',
  remove: 'bg-live-soft text-live',
  move: 'bg-surface-overlay text-ink-muted',
  edit: 'bg-gold-soft text-gold',
};

function Words({ segments }: { readonly segments: readonly WordSegment[] }) {
  return (
    <span>
      {segments.map((segment, index) =>
        segment.kind === 'del' ? (
          <del key={index} className="text-live">
            {segment.text}
          </del>
        ) : segment.kind === 'ins' ? (
          <ins key={index} className="text-online no-underline">
            {segment.text}
          </ins>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

function VersionSelect(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-strong text-ink-muted">
      {props.label}
      <select
        name={props.name}
        defaultValue={props.value}
        className={controlClass}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Compare two versions, or a version and the draft, change by change. */
export function CaseCompare({ view }: { readonly view: CaseView }) {
  const { compare } = view;
  const { diff } = compare;
  return (
    <div className="flex flex-col gap-4">
      <form
        action={`/prep/cases/${view.case.id}`}
        method="get"
        aria-label="Choose versions to compare"
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="view" value="compare" />
        <VersionSelect
          name="from"
          label="From"
          value={compare.from}
          options={compare.fromOptions}
        />
        <PrepIcon name="arrowRight" size={18} className="mb-3 text-ink-faint" />
        <VersionSelect
          name="to"
          label="To"
          value={compare.to}
          options={compare.toOptions}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Compare
        </button>
        {compare.restoreVersion === null ? null : (
          <span className="ml-auto">
            <InertActionButton
              action={inertActions.restoreVersion}
              label={`Restore v${compare.restoreVersion} as a new version`}
            />
          </span>
        )}
      </form>
      {diff.total === 0 ? (
        <p
          role="status"
          className="rounded-md border border-border bg-surface-raised p-6 text-center text-base text-ink-muted"
        >
          No changes
        </p>
      ) : (
        <>
          <ul aria-label="Changes" className="flex flex-wrap gap-2">
            {(['add', 'remove', 'move', 'edit'] as const)
              .filter((op) => diff.counts[op] > 0)
              .map((op) => (
                <li
                  key={op}
                  className={`rounded-round px-3 py-1 text-sm font-strong ${chipTone[op]}`}
                >
                  {`${diff.counts[op]} ${chipLabel[op]}`}
                </li>
              ))}
          </ul>
          {diff.groups.map((group) => (
            <section
              key={group.speech}
              aria-label={group.speech}
              className="flex flex-col gap-2"
            >
              <h3 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
                {group.speech}
              </h3>
              <ul className="overflow-hidden rounded-lg border border-border">
                {group.changes.map((change, index) => (
                  <li
                    key={`${change.title}-${index}`}
                    className={`flex items-start gap-3 border-t border-border p-3 first:border-t-0 ${
                      change.op === 'edit' || change.op === 'move'
                        ? 'bg-gold-soft'
                        : 'bg-surface-raised'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-4 text-lg leading-none font-bold ${opMark[change.op].cls}`}
                    >
                      {opMark[change.op].mark}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-base font-strong">
                        <span className="sr-only">{`${chipLabel[change.op]}: `}</span>
                        {change.title}
                      </span>
                      <span className="text-sm text-ink-muted">
                        {change.op === 'edit' ? (
                          <Words segments={change.segments} />
                        ) : (
                          change.detail
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
