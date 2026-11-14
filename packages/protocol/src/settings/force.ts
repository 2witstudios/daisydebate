import { z } from 'zod';

/**
 * How hard the engine tries to keep a pairing or judging policy: a `rule`
 * is never broken, a `preference` is weighed, a `warning` is reported and
 * `off` is not applied. Force is not hold, which says who may change it.
 */
export const forces = ['rule', 'preference', 'warning', 'off'] as const;
export type Force = (typeof forces)[number];

/**
 * The keys whose value carries a force, each with the only forces it
 * accepts. The tab engine's registry uses the same ids.
 */
export const forceKeys = {
  'pairing.rematch': ['rule', 'preference', 'warning', 'off'],
  'pairing.same_school': ['rule', 'preference', 'warning', 'off'],
  'pairing.side_balance': ['rule', 'preference', 'warning', 'off'],
  'pairing.side_alternation': ['rule', 'preference', 'off'],
  'pairing.pull_up': ['preference', 'warning'],
  'pairing.position_balance': ['preference', 'warning', 'off'],
  'pairing.section_repeat': ['preference', 'warning', 'off'],
  'bye.repeat': ['rule', 'preference', 'warning', 'off'],
  'judging.availability': ['rule', 'warning'],
  'judging.strike': ['rule', 'preference', 'warning', 'off'],
  'judging.conflict': ['rule', 'warning'],
  'judging.same_school': ['rule', 'preference', 'warning', 'off'],
  'judging.repeat_judge': ['rule', 'preference', 'warning', 'off'],
  'judging.unsubmitted_ballot': ['rule', 'warning', 'off'],
  'judging.load_balance': ['preference', 'warning', 'off'],
  'judging.chair': ['rule', 'preference', 'warning', 'off'],
  'judging.panel_same_school': ['preference', 'warning', 'off'],
} as const satisfies Record<string, readonly Force[]>;
export type ForceKey = keyof typeof forceKeys;

const keysUnder = <Prefix extends string>(...prefixes: Prefix[]) =>
  (Object.keys(forceKeys) as ForceKey[]).filter(
    (key): key is Extract<ForceKey, `${Prefix}${string}`> =>
      prefixes.some((prefix) => key.startsWith(prefix)),
  );
/** The force keys a pairing weighs, and the ones a judge assignment weighs. */
export const pairingForceKeys = keysUnder('pairing.', 'bye.');
export const judgingForceKeys = keysUnder('judging.');

/** A value that is a force and nothing else, limited to the key's forces. */
export const forced = <Key extends ForceKey>(key: Key) =>
  z.strictObject({ force: z.enum(forceKeys[key]) });

/** An order naming each of the keys exactly once. */
export const orderOf = <Key extends string>(keys: readonly Key[]) =>
  z.strictObject({
    order: z
      .array(z.enum(keys))
      .refine(
        (order) =>
          order.length === keys.length && new Set(order).size === keys.length,
        'An order names each key exactly once.',
      ),
  });
