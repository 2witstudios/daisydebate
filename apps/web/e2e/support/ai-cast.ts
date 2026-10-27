import { roomCastChoiceSchema } from '@daisy/protocol';
import { expect } from './fixtures';

/**
 * The eligible bot debater and AI judge from a Room catalog body: a bot
 * debater takes a side and the AI judge the judge seat (ISSUE-750).
 */
export function aiCast(catalog: { readonly bots: readonly unknown[] }) {
  const bots = catalog.bots
    .map((bot) => roomCastChoiceSchema.parse(bot))
    .filter((bot) => bot.eligible);
  const debater = bots.find((bot) => bot.seatRole === 'debater');
  const aiJudge = bots.find((bot) => bot.seatRole === 'judge');
  expect([Boolean(debater), Boolean(aiJudge)]).toEqual([true, true]);
  return { debater: debater!, aiJudge: aiJudge! };
}
