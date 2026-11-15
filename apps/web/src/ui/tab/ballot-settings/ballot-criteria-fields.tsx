'use client';
import { useId, useRef, useState } from 'react';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { Button } from '../../components/button/button';
import { FormField } from '../../components/form-field/form-field';
import {
  TextField,
  authoringControlClass as control,
} from './ballot-authoring-fields';
export function BallotCriteriaFields({
  view,
}: {
  readonly view: EventBallotAuthoringView;
}) {
  const body = view.definition?.ballot;
  const [criteriaKind, setCriteriaKind] = useState(
    body?.points?.criteria.kind ?? '',
  );
  const initialGroups =
    body?.points?.criteria.kind === 'grid' ? body.points.criteria.groups : [];
  const [groups, setGroups] = useState(
    initialGroups.map((group, index) => ({
      key: index,
      categories: group.categories.map((_, category) => category),
    })),
  );
  const nextGroup = useRef(initialGroups.length);
  const nextCategory = useRef(20);
  const id = useId();
  return (
    <>
      <FormField id={`${id}-criteria`} label="Score structure">
        <select
          id={`${id}-criteria`}
          name="criteria-kind"
          required
          value={criteriaKind}
          onChange={(event) => setCriteriaKind(event.target.value)}
          className={control}
        >
          <option value="" disabled>
            Choose score structure
          </option>
          <option value="holistic">One score</option>
          <option value="grid">A score for each criterion</option>
        </select>
      </FormField>
      {criteriaKind === 'grid' ? (
        <>
          <input type="hidden" name="group-count" value={groups.length} />
          {groups.map((group, groupIndex) => (
            <fieldset
              key={group.key}
              className="flex flex-col gap-4 rounded-md border border-border p-4"
            >
              <legend className="px-2 font-strong">
                Group {groupIndex + 1}
              </legend>
              <TextField
                name={`group-${groupIndex}-id`}
                label="Stable group key"
                value={initialGroups[group.key]?.id}
              />
              <TextField
                name={`group-${groupIndex}-name`}
                label="Group name"
                value={initialGroups[group.key]?.name}
              />
              <input
                type="hidden"
                name={`group-${groupIndex}-count`}
                value={group.categories.length}
              />
              {group.categories.map((categoryKey, categoryIndex) => {
                const category =
                  initialGroups[groupIndex]?.categories[categoryIndex];
                const prefix = `group-${groupIndex}-criterion-${categoryIndex}`;
                return (
                  <fieldset
                    key={categoryKey}
                    className="flex flex-col gap-3 border-t border-border pt-4"
                  >
                    <legend className="font-strong">
                      Criterion {categoryIndex + 1}
                    </legend>
                    <TextField
                      name={`${prefix}-id`}
                      label="Stable criterion key"
                      value={category?.id}
                    />
                    <TextField
                      name={`${prefix}-name`}
                      label="Criterion name"
                      value={category?.name}
                    />
                    <TextField
                      name={`${prefix}-rewards`}
                      label="What it rewards"
                      value={category?.rewards}
                    />
                    <TextField
                      name={`${prefix}-anchors`}
                      label="Score guidance, lowest to highest · one anchor per line"
                      multiline
                      value={category?.anchors.join('\n')}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setGroups((current) =>
                          current.map((row) =>
                            row.key === group.key
                              ? {
                                  ...row,
                                  categories: row.categories.filter(
                                    (key) => key !== categoryKey,
                                  ),
                                }
                              : row,
                          ),
                        )
                      }
                    >
                      Remove criterion
                    </Button>
                  </fieldset>
                );
              })}
              <Button
                type="button"
                variant="secondary"
                disabled={group.categories.length >= 20}
                onClick={() =>
                  setGroups((current) =>
                    current.map((row) =>
                      row.key === group.key
                        ? {
                            ...row,
                            categories: [
                              ...row.categories,
                              nextCategory.current++,
                            ],
                          }
                        : row,
                    ),
                  )
                }
              >
                Add criterion
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setGroups((current) =>
                    current.filter((row) => row.key !== group.key),
                  )
                }
              >
                Remove group
              </Button>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={groups.length >= 10}
            onClick={() =>
              setGroups((current) => [
                ...current,
                {
                  key: nextGroup.current++,
                  categories: [0],
                },
              ])
            }
          >
            Add criterion group
          </Button>
          <p className="text-sm text-ink-muted">
            Keep stable keys when revising the same criteria. Supply the actual
            rewards and guidance; labels are never filled in for you.
          </p>
        </>
      ) : null}
    </>
  );
}
