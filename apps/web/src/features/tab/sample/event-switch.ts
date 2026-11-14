import { linkTo, sampleAction } from '../action';
import { hostRoutes } from '../routes';
import type { EventSwitch } from '../setup';
import { AUTUMN, IMPROMPTU, reached, VARSITY } from './moment';
import type { SampleScene } from './scene';

const events = [
  [VARSITY, 'Varsity debate'],
  ['novice-debate', 'Novice debate'],
  [IMPROMPTU, 'Impromptu'],
] as const;

/**
 * Autumn Open's event picker. Varsity debate is drawn in depth and Impromptu
 * has its running round, so each leads to the other once rounds are running;
 * Novice debate has no read yet.
 */
export function eventSwitch(
  scene: SampleScene,
  current: typeof VARSITY | typeof IMPROMPTU = VARSITY,
): EventSwitch {
  const index = events.findIndex(([slug]) => slug === current);
  return {
    current: events[index]?.[1] ?? '',
    position: `${index + 1} of ${events.length} events`,
    others: events
      .filter(([slug]) => slug !== current)
      .map(([slug, name]) =>
        slug !== 'novice-debate' && reached(scene, 'prelims')
          ? linkTo(name, hostRoutes.round(AUTUMN, slug, '3'))
          : sampleAction(name),
      ),
  };
}

export const varsitySwitch = (scene: SampleScene): EventSwitch =>
  eventSwitch(scene);
