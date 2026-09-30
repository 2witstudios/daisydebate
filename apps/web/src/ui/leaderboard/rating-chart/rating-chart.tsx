'use client';

import { useState, useSyncExternalStore } from 'react';
import type {
  ChartGeometry,
  Readout,
} from '../../../features/leaderboard/history';
import { renderRatingChart } from './rating-chart.render';
import { stepFromPointer } from './step-from-pointer';

export type RatingChartProps = {
  readonly chart: ChartGeometry;
  readonly label: string;
  readonly initialStep: number;
  readonly readouts: readonly Readout[];
};

const VIEW_WIDTH = 420;

/** Nothing changes after hydration; the server snapshot is the static chart. */
const subscribe = (): (() => void) => () => undefined;

/**
 * The scrubbable chart. Served as a static chart at the URL's step; once a
 * script runs, the slider and the pointer move the readout. The table view
 * carries the same numbers for anyone without a script.
 */
export function RatingChart({
  chart,
  label,
  initialStep,
  readouts,
}: RatingChartProps) {
  const lastStep = readouts.length - 1;
  const [step, setStep] = useState(initialStep);
  const interactive = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return renderRatingChart({
    chart,
    label,
    step,
    lastStep,
    readout: readouts[step] ??
      readouts[lastStep] ?? { heading: '', value: '', detail: '' },
    interactive,
    onStep: setStep,
    onPointer: (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      setStep(
        stepFromPointer(event.clientX, box, chart.plot, VIEW_WIDTH, lastStep),
      );
    },
  });
}
