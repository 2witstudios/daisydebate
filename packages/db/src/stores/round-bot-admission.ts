import {
  roundBotAdmissionEntrypoints,
  type BotAdmissionOptions,
} from '../round-bot-admission-entrypoints';
import type { AiAllowanceOptions } from '../usage-ledger';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

export type RoundBotAdmissionOptions = {
  readonly nextId: () => string;
  /** No implicit bot capacity or quota: absence truthfully refuses bot-debater admission. */
  readonly botAdmission?: BotAdmissionOptions | undefined;
  /** Shared account allowance; bot, judge and analysis capacity stay feature-owned. */
  readonly aiAllowance?: AiAllowanceOptions | undefined;
};

/** Bot-debater admission and its allowance, on the competitive lane's bounded transaction. */
export const createRoundBotAdmissionStore = (
  resources: DatabaseResources,
  { nextId, botAdmission, aiAllowance }: RoundBotAdmissionOptions,
) =>
  namedLaneOperations(
    roundBotAdmissionEntrypoints({
      run: resourcesOf(resources).bounded('competitive'),
      nextId,
      botAdmission,
      aiAllowance,
    }).operations,
  );
export type RoundBotAdmissionStore = ReturnType<
  typeof createRoundBotAdmissionStore
>;
