import type { Id } from '../shapes/competition';
import type { CostKey, FixtureRef } from '../shapes/draw';
import type { ForceKey } from '../shapes/settings';

/** Who holds a person in a slot: a fixture of a draw, or another event's commitment. */
export type Holder =
  | {
      readonly kind: 'fixture';
      readonly event: Id;
      readonly fixture: FixtureRef;
    }
  | { readonly kind: 'commitment'; readonly event: Id; readonly fixture: Id };

/**
 * One thing the checker found wrong. `kind` names the structural fact or the
 * family of rule broken; a rule break also names its key.
 */
export type Violation =
  // 1. One draw per event request.
  | { readonly kind: 'draw_missing'; readonly event: Id }
  | { readonly kind: 'draw_extra'; readonly event: Id }
  | {
      readonly kind: 'draw_tab_round';
      readonly event: Id;
      readonly expected: number;
      readonly actual: number;
    }
  // 2. Placement.
  | {
      readonly kind: 'entry_unknown';
      readonly event: Id;
      readonly entry: Id;
      readonly fixture: FixtureRef;
    }
  | {
      readonly kind: 'entry_placed_twice';
      readonly event: Id;
      readonly entry: Id;
      readonly fixture: FixtureRef;
    }
  | {
      readonly kind: 'entry_not_placed';
      readonly event: Id;
      readonly entry: Id;
    }
  | {
      readonly kind: 'withdrawn_entry_placed';
      readonly event: Id;
      readonly entry: Id;
      readonly fixture: FixtureRef;
    }
  | {
      readonly kind: 'entry_not_in_bracket';
      readonly event: Id;
      readonly entry: Id;
      readonly fixture: FixtureRef;
    }
  // 3. Existing fixtures.
  | {
      readonly kind: 'existing_unaccounted';
      readonly event: Id;
      readonly fixture: Id;
    }
  | {
      readonly kind: 'existing_twice';
      readonly event: Id;
      readonly fixture: Id;
    }
  | {
      readonly kind: 'existing_unknown';
      readonly event: Id;
      readonly fixture: Id;
    }
  | {
      readonly kind: 'fixed_fixture_withdrawn';
      readonly event: Id;
      readonly fixture: Id;
    }
  | {
      readonly kind: 'kept_fixture_changed';
      readonly event: Id;
      readonly fixture: Id;
    }
  | {
      readonly kind: 'seated_judge_removed';
      readonly event: Id;
      readonly fixture: Id;
      readonly seat: number;
      readonly judge: Id;
    }
  // 4. Kind fits format.
  | {
      readonly kind: 'fixture_kind';
      readonly event: Id;
      readonly fixture: FixtureRef;
    }
  | {
      readonly kind: 'prematched_repeat';
      readonly event: Id;
      readonly fixture: FixtureRef;
      readonly entries: readonly [Id, Id];
    }
  // 5. Panels.
  | {
      readonly kind: 'panel_size';
      readonly event: Id;
      readonly fixture: FixtureRef;
      readonly size: number;
      readonly expected: number;
    }
  | {
      readonly kind: 'judge_unknown';
      readonly event: Id;
      readonly fixture: FixtureRef;
      readonly judge: Id;
    }
  | {
      readonly kind: 'judge_twice';
      readonly judge: Id;
      readonly at: readonly Holder[];
    }
  | {
      readonly kind: 'judge_not_eligible';
      readonly event: Id;
      readonly fixture: FixtureRef;
      readonly judge: Id;
    }
  // 6. Slot.
  | {
      readonly kind: 'person_twice_in_slot';
      readonly person: Id;
      readonly holders: readonly Holder[];
    }
  | {
      readonly kind: 'judge_competing';
      readonly event: Id;
      readonly fixture: FixtureRef;
      readonly judge: Id;
      readonly person: Id;
    }
  // 7. Rules.
  | {
      readonly kind: 'rule_broken';
      readonly event: Id;
      readonly key: ForceKey;
      readonly fixture: FixtureRef;
      readonly cost: readonly number[];
    }
  // 8. Costs.
  | {
      readonly kind: 'cost_total';
      readonly event: Id;
      readonly key: CostKey;
      readonly expected: readonly number[];
      readonly actual: readonly number[];
    }
  | {
      readonly kind: 'cost_term';
      readonly event: Id;
      readonly key: CostKey;
      readonly fixture: FixtureRef;
      readonly expected: readonly number[];
      readonly actual: readonly number[] | null;
    }
  // 9. Inputs record.
  | {
      readonly kind: 'inputs_results';
      readonly event: Id;
      readonly missing: readonly Id[];
      readonly extra: readonly Id[];
    }
  | {
      readonly kind: 'inputs_slot';
      readonly event: Id;
      readonly expected: Id | null;
      readonly actual: Id | null;
    }
  | {
      readonly kind: 'inputs_existing';
      readonly event: Id;
      readonly missing: readonly string[];
      readonly extra: readonly string[];
    }
  | {
      readonly kind: 'inputs_commitments';
      readonly event: Id;
      readonly missing: readonly Id[];
      readonly extra: readonly Id[];
    }
  // 10. Optimality.
  | {
      readonly kind: 'not_optimal';
      readonly event: Id;
      readonly actual: readonly number[];
      readonly best: readonly number[];
    }
  // Infeasible answers.
  | {
      readonly kind: 'infeasible_rules_feasible';
      readonly event: Id;
      readonly rules: readonly ForceKey[];
    }
  | {
      readonly kind: 'infeasible_rules_not_minimal';
      readonly event: Id;
      readonly key: ForceKey;
    }
  | { readonly kind: 'infeasible_slot_unfounded'; readonly person: Id }
  // Standings.
  | { readonly kind: 'standings_entry_unknown'; readonly entry: Id }
  | { readonly kind: 'standings_entry_twice'; readonly entry: Id }
  | {
      readonly kind: 'standings_division';
      readonly entry: Id;
      readonly division: Id;
    }
  | {
      readonly kind: 'standings_rank_order';
      readonly entry: Id;
      readonly rank: number | null;
    }
  | {
      readonly kind: 'standings_results';
      readonly missing: readonly Id[];
      readonly extra: readonly Id[];
    }
  // Breaks.
  | { readonly kind: 'break_stage_unknown'; readonly stage: Id }
  | {
      readonly kind: 'break_entry_ineligible';
      readonly stage: Id;
      readonly entry: Id;
    }
  | {
      readonly kind: 'break_entry_twice';
      readonly entry: Id;
      readonly stages: readonly Id[];
    }
  | {
      readonly kind: 'break_against_choice';
      readonly stage: Id;
      readonly entry: Id;
      readonly choice: Id;
    }
  | {
      readonly kind: 'undecided_has_choice';
      readonly entry: Id;
      readonly choice: Id;
    };

export type Verdict = {
  readonly ok: boolean;
  readonly violations: readonly Violation[];
};

export const verdictOf = (violations: readonly Violation[]): Verdict => ({
  ok: violations.length === 0,
  violations,
});
