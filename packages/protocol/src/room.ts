import { z } from 'zod';
import { formatSettingsFields } from './format-settings';
import {
  freezeResolutionDraw,
  frozenResolutionDrawSchema,
  roomResolutionDrawSchema,
} from './resolution-draw';

/**
 * The Room's configuration (ADR 0058): the format settings it runs, extended
 * with what only a Room holds, a host-written resolution list. Broader than
 * what becomes a round rule: `preRoundPrep` is Room-executed and never
 * reaches ECS. A ranked room has no free-form config: its every value comes
 * from the sanctioned preset's format settings (ISSUE-775).
 */
export const roomConfigSchema = z.strictObject({
  ...formatSettingsFields,
  resolutionDraw: roomResolutionDrawSchema,
});
export type RoomConfig = z.infer<typeof roomConfigSchema>;

/**
 * The viewer-independent config every delivery and `rounds.room_config_snapshot`
 * use: a host-written resolution list appears only as its length.
 */
export const frozenRoomConfigSchema = z.strictObject({
  ...formatSettingsFields,
  resolutionDraw: frozenResolutionDrawSchema,
});
export type FrozenRoomConfig = z.infer<typeof frozenRoomConfigSchema>;

/**
 * What the Room executes before competition (ADR 0058): the resolution
 * draw and pre-round prep. Readiness flow and document access are real
 * settings, but their source fields are not declared yet, so they do not
 * ride here — adding them is a separate decision that adds their fields to
 * the definition, the config and this plan together.
 */
export const roomExecutionPlanSchema = z.strictObject({
  preRoundPrep: formatSettingsFields.preRoundPrep,
  resolutionDraw: roomResolutionDrawSchema,
});
export type RoomExecutionPlan = z.infer<typeof roomExecutionPlanSchema>;

export const frozenRoomExecutionPlanSchema = z.strictObject({
  preRoundPrep: formatSettingsFields.preRoundPrep,
  resolutionDraw: frozenResolutionDrawSchema,
});
export type FrozenRoomExecutionPlan = z.infer<
  typeof frozenRoomExecutionPlanSchema
>;

/** The one projection from the internal config to its public shape. */
export const freezeRoomConfig = (config: RoomConfig): FrozenRoomConfig => ({
  ...config,
  resolutionDraw: freezeResolutionDraw(config.resolutionDraw),
});
export const freezeRoomExecutionPlan = (
  plan: RoomExecutionPlan,
): FrozenRoomExecutionPlan => ({
  ...plan,
  resolutionDraw: freezeResolutionDraw(plan.resolutionDraw),
});
