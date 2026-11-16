import { varsitySwitch } from './event-switch';
import { sampleEventBallot, sampleJudgeBallot } from './ballot';
import type { SampleScene } from './scene';
import {
  type JudgeBallot,
  type BallotSettings,
  ballotSettingsOf,
  judgeBallotOf,
} from '../ballot-definition';

export const readBallotSettings = (
  slug: string,
  event: string,
  scene: SampleScene,
): BallotSettings | null => {
  const view = sampleEventBallot(slug, event, scene);
  return view === null
    ? null
    : ballotSettingsOf(view, varsitySwitch(scene), slug);
};

export const readJudgeBallot = (
  room: string,
  scene: SampleScene,
): JudgeBallot | null => {
  const view = sampleJudgeBallot(room, scene);
  return view === null ? null : judgeBallotOf(view);
};
