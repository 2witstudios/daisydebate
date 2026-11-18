import { z } from 'zod';
import {
  releaseAudiences,
  releaseWhenSchema,
  type ReleaseWhen,
} from '../release-audience';

/** The whens that fall in a fixed order; `manual` opens by hand, at any time. */
const order: readonly ReleaseWhen[] = [
  'at_once',
  'round_close',
  'prelims_end',
  'break',
  'certified',
  'never',
];

/**
 * Whether a narrower audience's when lets a wider audience's stand: the
 * wider one never opens first. A narrower audience opened by hand needs
 * every wider one opened by hand or never; a wider one opened by hand needs
 * the narrower one to open at all.
 */
const opensNoLater = (narrower: ReleaseWhen, wider: ReleaseWhen): boolean => {
  if (narrower === 'manual') return wider === 'manual' || wider === 'never';
  if (wider === 'manual') return narrower !== 'never';
  return order.indexOf(narrower) <= order.indexOf(wider);
};

const whens = z.strictObject({
  responsible_adults: releaseWhenSchema,
  competitors: releaseWhenSchema,
  participants: releaseWhenSchema,
  link: releaseWhenSchema,
  public: releaseWhenSchema,
});
type AudienceWhens = z.infer<typeof whens>;
const narrowerOpensFirst = (map: AudienceWhens): boolean =>
  releaseAudiences.every((narrower, index) =>
    releaseAudiences
      .slice(index + 1)
      .every((wider) => opensNoLater(map[narrower], map[wider])),
  );

/**
 * An audience setting's value: for each audience, when the thing opens to
 * it. A map in which a wider audience opens before a narrower one is
 * refused.
 */
export const audienceMapSchema = whens.refine(
  narrowerOpensFirst,
  'A wider audience never opens before a narrower one.',
);
export type AudienceMap = z.infer<typeof audienceMapSchema>;

/** Scores, reasons and feedback never go wider than participants. */
export const participantAudienceMapSchema = audienceMapSchema.refine(
  (map) => map.link === 'never' && map.public === 'never',
  'Scores, reasons and feedback never go wider than participants.',
);
