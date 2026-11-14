/**
 * `@daisy/tab-engine`: tournament tabulation as pure functions of plain
 * data. It knows resolved settings as a flat map, entries, results and the
 * fixtures already committed in a slot; nothing about scopes, templates,
 * accounts, Rooms or storage. `check` and `simulate` are their own subpaths.
 * The wiring (slice H) exports more of the shapes as its commands need them.
 */
export { assess, whyNot } from './assess';
export { breaks } from './breaks';
export { draw } from './draw';
export { ladderInput, seasonStandings } from './season';
export { entryRating, standings } from './standings';
export type { Entry } from './shapes/competition';
export type { DrawInput, Plan, SlotJudge } from './shapes/draw';
export type { BreaksInput, StandingsInput } from './shapes/folds';
export {
  forceKeys,
  type ForceKey,
  type ResolvedSettings,
} from './shapes/settings';
