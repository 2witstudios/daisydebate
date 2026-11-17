'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { FormField } from '../../components/form-field/form-field';
import {
  NumberField,
  TextField,
  Toggle,
  WrittenFields,
  authoringControlClass as control,
} from './ballot-authoring-fields';
import { BallotCriteriaFields } from './ballot-criteria-fields';
import { BallotSpeechWeights } from './ballot-speech-weights';
import { usePostedValues } from '../../form-action/posted-values';
/**
 * The publish form's definition fields. Their selects are controlled (each
 * mounts the fields it governs), so when a post resets the form, which puts
 * every field back to its server-rendered default, they are mounted afresh:
 * from the fields just posted while the answer gives them back (a refusal,
 * or a retry awaiting its answer), else from the definition. No select can
 * then show one choice while the fields under it follow another. Focus held
 * in a field returns to the field of the same name.
 */
export function BallotDefinitionFields({
  view,
}: {
  readonly view: EventBallotAuthoringView;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const focused = useRef<string | null>(null);
  const [resets, setResets] = useState(0);
  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    const reset = () => {
      const active = form.ownerDocument.activeElement as {
        readonly name?: unknown;
      } | null;
      focused.current =
        active &&
        form.contains(active as Node) &&
        typeof active.name === 'string'
          ? active.name
          : null;
      setResets((count) => count + 1);
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, []);
  useEffect(() => {
    const name = focused.current;
    focused.current = null;
    const form = anchor.current?.closest('form');
    if (resets === 0 || !name || !form) return;
    const field = form.elements.namedItem(name) as {
      focus?: () => void;
    } | null;
    field?.focus?.();
  }, [resets]);
  return (
    <>
      <span ref={anchor} hidden />
      <DefinitionFields key={resets} view={view} />
    </>
  );
}

function DefinitionFields({
  view,
}: {
  readonly view: EventBallotAuthoringView;
}) {
  const body = view.definition?.ballot;
  const posted = usePostedValues();
  const [kind, setKind] = useState(
    posted?.decision ??
      (body?.decision.kind === 'winner'
        ? 'winner'
        : body?.decision.kind === 'ranking'
          ? `ranking-${body.decision.of}`
          : ''),
  );
  const [per, setPer] = useState(
    posted?.['score-subject'] ?? (body ? (body.points?.per ?? 'none') : ''),
  );
  const [target, setTarget] = useState(posted?.['publish-target'] ?? 'new');
  const id = useId();
  return (
    <>
      <FormField id={`${id}-target`} label="Publish as">
        <select
          id={`${id}-target`}
          name="publish-target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className={control}
        >
          <option value="new">A new definition</option>
          {view.definitions
            .filter((definition) => definition.owned)
            .map((definition) => (
              <option key={definition.id} value={definition.id}>
                A new version of {definition.name}
              </option>
            ))}
        </select>
      </FormField>
      {target === 'new' ? (
        <TextField name="definition-name" label="Definition name" />
      ) : null}
      <FormField id={`${id}-decision`} label="Decision">
        <select
          id={`${id}-decision`}
          name="decision"
          required
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className={control}
        >
          <option value="" disabled>
            Choose a decision
          </option>
          <option value="winner">Winner between sides</option>
          <option value="ranking-sides">Rank sides</option>
          <option value="ranking-speakers">Rank speakers</option>
        </select>
      </FormField>
      <Toggle
        name="ties"
        label="Allow tied decisions"
        value={
          body?.decision.kind === 'winner'
            ? body.decision.tie
            : (body?.decision.ties ?? false)
        }
      />
      {kind === 'winner' ? (
        <>
          <Toggle
            name="double-loss"
            label="Allow a loss for both sides"
            value={body?.decision.kind === 'winner' && body.decision.doubleLoss}
          />
          <Toggle
            name="low-point-win"
            label="Allow a winner with fewer points"
            value={
              body?.decision.kind === 'winner' && body.decision.lowPointWin
            }
          />
          <Toggle
            name="speaker-ranks"
            label="Also rank every speaker individually"
            value={body?.speakerRanks ?? false}
          />
        </>
      ) : null}
      <FormField id={`${id}-per`} label="Scores">
        <select
          id={`${id}-per`}
          name="score-subject"
          required
          value={per}
          onChange={(event) => setPer(event.target.value)}
          className={control}
        >
          <option value="" disabled>
            Choose who receives scores
          </option>
          <option value="none">No scores</option>
          <option value="side">Each side</option>
          <option value="seat">Each speaker</option>
          <option value="speech">Each individual speech</option>
        </select>
      </FormField>
      {per !== '' && per !== 'none' ? (
        <>
          <div className="grid grid-cols-2 gap-4 max-narrow:grid-cols-1">
            <NumberField
              name="score-min"
              label="Minimum"
              value={body?.points?.scale.min}
            />
            <NumberField
              name="score-max"
              label="Maximum"
              value={body?.points?.scale.max}
            />
            <NumberField
              name="score-step"
              label="Step from minimum"
              value={body?.points?.scale.step}
            />
            <NumberField
              name="score-default"
              label="Starting score"
              value={body?.points?.default}
            />
          </div>
          <BallotCriteriaFields view={view} />
          {per === 'speech' ? <BallotSpeechWeights view={view} /> : null}
        </>
      ) : null}
      <WrittenFields kind="reason" value={body?.written.reason} />
      <WrittenFields kind="feedback" value={body?.written.feedback} />
    </>
  );
}
