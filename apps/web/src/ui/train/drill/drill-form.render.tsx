import {
  MAX_PART,
  drillParts,
  type DrillPart,
  type DrillState,
  type PartCheck,
} from '../../../features/train/drill';
import type { DrillScreen } from '../../../features/train/drill-view';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { chipClass } from '../choice/choice-class';
import { labels } from './drill-labels';
import { Saved } from './drill-saved';

export type DrillFormViewProps = {
  readonly state: DrillState;
  readonly screen: DrillScreen;
  readonly pending: boolean;
  /** The form's POST: a server action, so it works before hydration. */
  readonly post: (form: FormData) => void;
};

const definitions: Readonly<Record<DrillPart, string>> = {
  claim: 'What you are asking the judge to believe, in one sentence.',
  warrant: 'Why the claim is true. The reason, not a repeat of the claim.',
  impact: 'Why it matters, and to whom.',
};

const placeholders: Readonly<Record<DrillPart, string>> = {
  claim: 'Cities should...',
  warrant: 'This is true because...',
  impact: 'This matters because...',
};

const statusWords: Readonly<Record<PartCheck['status'], string>> = {
  clear: 'Clear',
  'needs-work': 'Needs work',
  missing: 'Missing',
};

const statusIcon: Readonly<Record<PartCheck['status'], string>> = {
  clear: 'check',
  'needs-work': 'alert',
  missing: 'alert',
};

const pillClass = (status: PartCheck['status']): string =>
  cn(
    'rounded-round px-3 py-1 text-xs font-bold',
    status === 'clear' && 'bg-accent-soft text-accent',
    status === 'needs-work' && 'bg-gold-soft text-gold',
    status === 'missing' && 'bg-live-soft text-live',
  );

const blockClass = (status: PartCheck['status']): string =>
  cn(
    'rounded-md border p-4 text-base text-ink',
    status === 'clear' && 'border-border',
    status === 'needs-work' && 'border-gold',
    status === 'missing' && 'border-live',
  );

/** A checked part: its text with the vague phrase marked, and what to do. */
function CheckedPart({
  part,
  text,
  check,
}: {
  readonly part: DrillPart;
  readonly text: string;
  readonly check: PartCheck;
}) {
  const mark = check.highlight;
  return (
    <>
      <input type="hidden" name={part} value={text} />
      <div className={blockClass(check.status)}>
        {mark ? (
          <>
            {text.slice(0, mark.start)}
            <mark className="bg-gold-soft text-ink underline decoration-gold">
              {text.slice(mark.start, mark.end)}
            </mark>
            {text.slice(mark.end)}
          </>
        ) : (
          text
        )}
        {text.trim() === '' ? (
          <span className="text-ink-faint">Nothing written yet</span>
        ) : null}
      </div>
      <p className="flex items-start gap-2 text-sm text-ink-muted">
        <Icon name={statusIcon[check.status]} size={16} />
        {check.message}
      </p>
    </>
  );
}

function Field({
  part,
  state,
}: {
  readonly part: DrillPart;
  readonly state: DrillState;
}) {
  const check = state.check?.parts.find((c) => c.part === part);
  const checked = state.phase === 'checked' && check !== undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={`drill-${part}`}
          className="text-base font-strong text-ink"
        >
          {labels[part]}
        </label>
        {checked ? (
          <span className={pillClass(check.status)}>
            {statusWords[check.status]}
          </span>
        ) : null}
      </div>
      <span className="text-sm text-ink-muted">{definitions[part]}</span>
      {checked ? (
        <CheckedPart part={part} text={state.text[part]} check={check} />
      ) : (
        <textarea
          key={`${part}-${state.text[part]}`}
          id={`drill-${part}`}
          name={part}
          rows={3}
          maxLength={MAX_PART}
          defaultValue={state.text[part]}
          placeholder={placeholders[part]}
          className="rounded-md border border-border bg-surface-raised p-3 text-base text-ink"
        />
      )}
    </div>
  );
}

const submit = (
  intent: string,
  label: string,
  variant: 'primary' | 'secondary' | 'ghost',
  pending: boolean,
) => (
  <button
    type="submit"
    name="intent"
    value={intent}
    disabled={pending}
    className={buttonClass(variant)}
  >
    {label}
  </button>
);

const modes = [
  ['write', 'Write'],
  ['speak', 'Speak'],
] as const;

/** The drill form's markup, pure so every phase is testable. */
export function renderDrillForm({
  state,
  screen,
  pending,
  post,
}: DrillFormViewProps) {
  if (state.phase === 'saved') return <Saved state={state} screen={screen} />;
  const checked = state.phase === 'checked';
  const allClear = state.check?.allClear === true;
  return (
    <form action={post} aria-busy={pending} className="flex flex-col gap-5">
      <input type="hidden" name="mode" value={state.mode} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-bold tracking-widest text-ink-faint uppercase">
          Argument drill
        </span>
        <div role="group" aria-label="Input" className="flex gap-2">
          {modes.map(([value, label]) => (
            <button
              key={value}
              type="submit"
              name="intent"
              value={`mode-${value}`}
              aria-pressed={state.mode === value}
              className={cn(
                chipClass,
                state.mode === value &&
                  'border-accent bg-accent-soft text-accent',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-4">
        <span className="text-xs font-bold tracking-widest text-ink-faint uppercase">
          Drill prompt
        </span>
        <p className="text-base text-ink">{`Motion: ${screen.motion}`}</p>
        <p className="text-base text-ink-muted">{screen.task}</p>
      </div>
      {state.mode === 'speak' ? (
        <p className="flex items-start gap-3 rounded-md border border-border p-4 text-sm text-ink-muted">
          <Icon name="message" size={18} />
          Speaking is not connected yet. Type your argument in the boxes below;
          once speech is connected it will fill them for you to fix before you
          check.
        </p>
      ) : null}
      {state.notice === 'nothing-to-check' ? (
        <p role="alert" className="text-sm font-strong text-live">
          Write at least one part before you check.
        </p>
      ) : null}
      {state.notice === 'unavailable' ? (
        <p role="alert" className="text-sm font-strong text-live">
          That did not reach Daisy. What you wrote is kept; try again.
        </p>
      ) : null}
      {checked && state.check ? (
        <p className="text-base text-ink">
          <b className="font-strong">{`${state.check.clearCount} of 3 parts clear`}</b>
          <span className="text-ink-muted"> Highlighted text needs work.</span>
        </p>
      ) : null}
      {drillParts.map((part) => (
        <Field key={part} part={part} state={state} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {checked ? (
          allClear ? (
            <>
              <p className="flex w-full items-center gap-2 text-base font-strong text-accent">
                <Icon name="check" size={18} />
                All three parts are clear.
              </p>
              {submit('save', 'Save argument', 'primary', pending)}
              {submit('revise', 'Edit again', 'secondary', pending)}
            </>
          ) : (
            submit('revise', 'Revise', 'primary', pending)
          )
        ) : (
          <>
            {submit('check', 'Check structure', 'primary', pending)}
            {submit('stem', 'Use a stem for impact', 'secondary', pending)}
            <span className="text-sm text-ink-faint">Suggested: 2 min</span>
          </>
        )}
      </div>
    </form>
  );
}
