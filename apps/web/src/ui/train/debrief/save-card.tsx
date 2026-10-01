import { type DebriefView } from '../../../features/train/debrief';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';
import { DebriefForm, type DebriefContext } from './debrief-form';

type Props = DebriefContext & {
  readonly view: DebriefView;
};

/** Choose arguments to keep; saving is the next step of the mock flow. */
export function SaveCard({ view, config, plan, query }: Props) {
  return (
    <TrainCard title="Save arguments to review" sample>
      <p className="text-sm text-ink-muted">
        Arguments from your speeches. Saved ones come back on a spaced schedule.
      </p>
      {view.savedCount > 0 ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md bg-accent-soft p-3 text-base text-accent"
        >
          <Icon name="check" size={16} />
          {`Saved ${view.savedCount}. The first review is tomorrow.`}
        </p>
      ) : (
        <DebriefForm
          config={config}
          plan={plan}
          query={query}
          keepSaved={false}
          className="flex flex-col gap-3"
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Arguments to save</legend>
            {view.arguments.map((arg) => (
              <label
                key={arg.id}
                className="flex cursor-pointer items-start gap-3 text-base text-ink"
              >
                <input
                  type="checkbox"
                  name="saved"
                  value={arg.id}
                  defaultChecked={arg.checked}
                  className="mt-1 h-4 w-4 shrink-0 accent-accent"
                />
                {arg.text}
              </label>
            ))}
          </fieldset>
          {view.saveError ? (
            <p role="alert" className="text-sm font-strong text-live">
              Choose at least one argument to save.
            </p>
          ) : null}
          <button
            type="submit"
            name="save"
            value="1"
            className={cn(buttonClass('primary'))}
          >
            Save to review
          </button>
        </DebriefForm>
      )}
    </TrainCard>
  );
}
