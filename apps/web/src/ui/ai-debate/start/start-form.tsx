'use client';

import { useEffect } from 'react';

import { AI_VOICES } from '@daisy/ai-voice';
import { buttonClass } from '../../components/button/button-class';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { TrainCard } from '../../train/card/train-card';
import { TrainPage } from '../../train/train-page/train-page';

export type StartFormState = {
  readonly resolution: string;
  readonly notice: string;
  readonly next?: string;
};

const initialStartState: StartFormState = { resolution: '', notice: '' };

/** IPDA-style resolutions to start from; the person can write their own. */
const SUGGESTED_RESOLUTIONS = [
  'Social media does more harm than good',
  'Standardized testing should be abolished in college admissions',
  'Cities should make public transit free',
  'Artificial intelligence will create more jobs than it destroys',
  'College athletes should be paid',
  'Remote work is better than office work',
] as const;

const unavailable = (form: FormData): StartFormState => ({
  resolution: String(form.get('resolution') ?? ''),
  notice: 'Could not reach Daisy. Check your connection and try again.',
});

/**
 * Starts an AI debate. A real form posting to a server action: it works
 * before hydration and with JavaScript off, and moves on to the debate room.
 */
export function AiDebateStartForm({
  action,
}: {
  readonly action: FormAction<StartFormState>;
}) {
  const [state, formAction, pending] = useFormAction(
    action,
    initialStartState,
    unavailable,
  );
  useEffect(() => {
    if (state.next) window.location.assign(state.next);
  }, [state.next]);
  return (
    <TrainPage>
      <TrainCard title="Debate the AI">
        <p className="text-ink-muted">
          A strict IPDA round by voice: constructives, cross-examination,
          rebuttals and 4:00 of prep for you. An AI judge gives you a ballot at
          the end.
        </p>
        <form
          action={formAction}
          className="flex flex-col gap-5"
          aria-label="Start an AI debate"
        >
          <label className="flex flex-col gap-2">
            <span className="font-strong text-ink">Resolution</span>
            <input
              id="ai-debate-resolution"
              name="resolution"
              list="ai-debate-resolutions"
              defaultValue={state.resolution || SUGGESTED_RESOLUTIONS[0]}
              minLength={3}
              maxLength={200}
              required
              className="rounded-sm border border-border-strong bg-surface px-3 py-2 text-ink"
            />
            <datalist id="ai-debate-resolutions">
              {SUGGESTED_RESOLUTIONS.map((resolution) => (
                <option key={resolution} value={resolution} />
              ))}
            </datalist>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-strong text-ink">Your side</legend>
            <div className="flex flex-wrap gap-4">
              {[
                ['random', 'Flip a coin'],
                ['affirmative', 'Affirmative'],
                ['negative', 'Negative'],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-ink">
                  <input
                    type="radio"
                    name="side"
                    value={value}
                    defaultChecked={value === 'random'}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-2">
            <span className="font-strong text-ink">
              Your opponent&apos;s voice
            </span>
            <select
              id="ai-debate-voice"
              name="voice"
              defaultValue={AI_VOICES[0].id}
              className="rounded-sm border border-border-strong bg-surface px-3 py-2 text-ink"
            >
              {AI_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          </label>
          {state.notice ? (
            <p role="alert" className="text-sm text-live">
              {state.notice}
            </p>
          ) : null}
          <button
            type="submit"
            className={buttonClass('primary')}
            disabled={pending}
          >
            {pending ? 'Setting up…' : 'Go to the debate room'}
          </button>
        </form>
      </TrainCard>
    </TrainPage>
  );
}
