import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';
import { Chips } from '../choice/choices';
import { DebriefForm, type DebriefContext } from './debrief-form';

type Props = DebriefContext;

/** Feedback on the session; its free text is never named, so never in a URL. */
export function FeedbackCard({ config, plan, query }: Props) {
  return (
    <TrainCard title="How was this session?">
      {query.feedbackSent ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md bg-accent-soft p-3 text-base text-accent"
        >
          <Icon name="check" size={16} />
          Thanks for the feedback
        </p>
      ) : (
        <DebriefForm
          config={config}
          plan={plan}
          query={query}
          keepSaved={true}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <span className="text-sm font-strong text-ink">Difficulty</span>
            <Chips
              name="difficulty"
              legend="Difficulty"
              value=""
              options={[
                { value: 'easy', label: 'Too easy' },
                { value: 'right', label: 'About right' },
                { value: 'hard', label: 'Too hard' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-strong text-ink">The AI debater</span>
            <Chips
              name="fair"
              legend="The AI debater"
              value=""
              options={[
                { value: 'fair', label: 'Fair and useful' },
                { value: 'off', label: 'Off or unfair' },
              ]}
            />
          </div>
          <label
            htmlFor="feedback"
            className="flex items-baseline gap-2 text-sm font-strong text-ink"
          >
            Anything we should change?
            <span className="font-book text-ink-faint">Optional</span>
          </label>
          {/* Unnamed on purpose: free text never goes in a URL. */}
          <textarea
            id="feedback"
            rows={2}
            className="rounded-md border border-border bg-surface-raised p-3 text-base text-ink"
          />
          <button
            type="submit"
            name="sent"
            value="1"
            className={cn(buttonClass('secondary'))}
          >
            Send feedback
          </button>
        </DebriefForm>
      )}
    </TrainCard>
  );
}
