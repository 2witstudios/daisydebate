import { sampleDrawView } from './draw';
import type { SampleScene } from './scene';
import { type DrawBoard, drawBoardOf } from '../../draw';

export const readDrawBoard = (
  slug: string,
  event: string,
  round: string,
  fixture: string | null,
  scene: SampleScene,
): DrawBoard | null => {
  const sample = sampleDrawView(slug, event, round, scene);
  return sample === null
    ? null
    : drawBoardOf(sample.read, {
        ...sample.context,
        selectedFixtureId: sample.fixtureIdOf(fixture),
      });
};
