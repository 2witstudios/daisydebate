'use client';
import { useId, useRef, useState } from 'react';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { Button } from '../../components/button/button';
import { FormField } from '../../components/form-field/form-field';
import { postedCount, usePostedValues } from '../../form-action/posted-values';
import type { FormValues } from '../../../features/forms/form-state';
import {
  TextField,
  authoringControlClass as control,
} from './ballot-authoring-fields';
type CriterionSeed = {
  readonly id: string;
  readonly name: string;
  readonly rewards: string;
  readonly anchors: string;
};
type CriterionRow = { readonly key: number; readonly seed: CriterionSeed };
type GroupRow = {
  readonly key: number;
  readonly seed: { readonly id: string; readonly name: string };
  readonly categories: readonly CriterionRow[];
};
const blankCriterion: CriterionSeed = {
  id: '',
  name: '',
  rewards: '',
  anchors: '',
};

/**
 * The rows to mount with: as posted (read by position once, here, while the
 * names still match), else the definition's. Each row then carries its own
 * values, so removing one never hands its values to the next.
 */
const seedGroups = (
  view: EventBallotAuthoringView,
  posted: FormValues | null,
): readonly GroupRow[] => {
  const body = view.definition?.ballot;
  const count = postedCount(posted, 'group-count');
  if (count !== null)
    return Array.from({ length: count }, (_, group) => ({
      key: group,
      seed: {
        id: posted?.[`group-${group}-id`] ?? '',
        name: posted?.[`group-${group}-name`] ?? '',
      },
      categories: Array.from(
        { length: postedCount(posted, `group-${group}-count`) ?? 0 },
        (_, category) => {
          const prefix = `group-${group}-criterion-${category}`;
          return {
            key: category,
            seed: {
              id: posted?.[`${prefix}-id`] ?? '',
              name: posted?.[`${prefix}-name`] ?? '',
              rewards: posted?.[`${prefix}-rewards`] ?? '',
              anchors: posted?.[`${prefix}-anchors`] ?? '',
            },
          };
        },
      ),
    }));
  const groups =
    body?.points?.criteria.kind === 'grid' ? body.points.criteria.groups : [];
  return groups.map((group, index) => ({
    key: index,
    seed: { id: group.id, name: group.name },
    categories: group.categories.map((category, key) => ({
      key,
      seed: {
        id: category.id,
        name: category.name,
        rewards: category.rewards,
        anchors: category.anchors.join('\n'),
      },
    })),
  }));
};

export function BallotCriteriaFields({
  view,
}: {
  readonly view: EventBallotAuthoringView;
}) {
  const body = view.definition?.ballot;
  const posted = usePostedValues();
  const [criteriaKind, setCriteriaKind] = useState(
    posted?.['criteria-kind'] ?? body?.points?.criteria.kind ?? '',
  );
  const [groups, setGroups] = useState(() => seedGroups(view, posted));
  const nextGroup = useRef(groups.length);
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
                value={group.seed.id}
                fromPost={false}
              />
              <TextField
                name={`group-${groupIndex}-name`}
                label="Group name"
                value={group.seed.name}
                fromPost={false}
              />
              <input
                type="hidden"
                name={`group-${groupIndex}-count`}
                value={group.categories.length}
              />
              {group.categories.map((category, categoryIndex) => {
                const prefix = `group-${groupIndex}-criterion-${categoryIndex}`;
                return (
                  <fieldset
                    key={category.key}
                    className="flex flex-col gap-3 border-t border-border pt-4"
                  >
                    <legend className="font-strong">
                      Criterion {categoryIndex + 1}
                    </legend>
                    <TextField
                      name={`${prefix}-id`}
                      label="Stable criterion key"
                      value={category.seed.id}
                      fromPost={false}
                    />
                    <TextField
                      name={`${prefix}-name`}
                      label="Criterion name"
                      value={category.seed.name}
                      fromPost={false}
                    />
                    <TextField
                      name={`${prefix}-rewards`}
                      label="What it rewards"
                      value={category.seed.rewards}
                      fromPost={false}
                    />
                    <TextField
                      name={`${prefix}-anchors`}
                      label="Score guidance, lowest to highest · one anchor per line"
                      multiline
                      value={category.seed.anchors}
                      fromPost={false}
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
                                    (row) => row.key !== category.key,
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
                              {
                                key: nextCategory.current++,
                                seed: blankCriterion,
                              },
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
                  seed: { id: '', name: '' },
                  categories: [{ key: 0, seed: blankCriterion }],
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
