'use client';
import { useId, useRef, useState } from 'react';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { Button } from '../../components/button/button';
import { FormField } from '../../components/form-field/form-field';
import {
  NumberField,
  authoringControlClass as control,
} from './ballot-authoring-fields';
export function BallotSpeechWeights({
  view,
}: {
  readonly view: EventBallotAuthoringView;
}) {
  const body = view.definition?.ballot;
  const initialWeights = body?.points?.weights ?? {};
  const [weights, setWeights] = useState(
    Object.entries(initialWeights).map(([key, value], index) => ({
      id: index,
      key,
      value: String(value),
    })),
  );
  const nextWeight = useRef(Object.keys(initialWeights).length);
  const id = useId();
  return (
    <>
      <input type="hidden" name="weight-count" value={weights.length} />
      <h3 className="font-strong">Speech weights</h3>
      <p className="text-sm text-ink-muted">
        Unlisted speeches use the ordinary scale. A listed weight scales that
        speech’s bounds, step and starting score.
      </p>
      {weights.map((weight, index) => (
        <div key={weight.id} className="grid grid-cols-2 gap-3">
          <FormField id={`${id}-weight-${weight.id}`} label="Speech">
            <select
              id={`${id}-weight-${weight.id}`}
              name={`weight-${index}-key`}
              required
              className={control}
              value={weight.key}
              onChange={(event) =>
                setWeights((current) =>
                  current.map((row) =>
                    row.id === weight.id
                      ? { ...row, key: event.target.value }
                      : row,
                  ),
                )
              }
            >
              <option value="" disabled>
                Choose a speech
              </option>
              {view.segments
                .filter((segment) => segment.individual)
                .map((segment) => (
                  <option key={segment.key} value={segment.key}>
                    {segment.label}
                  </option>
                ))}
            </select>
          </FormField>
          <NumberField
            name={`weight-${index}-value`}
            label="Scale multiplier"
            value={weight.value === '' ? undefined : Number(weight.value)}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setWeights((current) =>
                current.filter((row) => row.id !== weight.id),
              )
            }
          >
            Remove weight
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={weights.length >= view.segments.length}
        onClick={() =>
          setWeights((current) => [
            ...current,
            {
              id: nextWeight.current++,
              key: '',
              value: '',
            },
          ])
        }
      >
        Add speech weight
      </Button>
    </>
  );
}
