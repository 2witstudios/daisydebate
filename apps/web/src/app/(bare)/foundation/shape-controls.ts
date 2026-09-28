import { markGeometry } from '../../../ui/brand/brand-geometry';
import type { PetalShape } from '../../../ui/brand/petal';

export type ShapeControl = {
  readonly key: keyof PetalShape;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
};

/**
 * The longest petal that stays inside the mark's drawing: a petal reaches
 * from its tip, `petalInset` from the centre, one length outward.
 */
const longestPetal = markGeometry.size / 2 - markGeometry.petalInset;

/** The brand sheet's tuning sliders, one per petal parameter. */
export const shapeControls: readonly ShapeControl[] = [
  {
    key: 'length',
    label: 'Petal length',
    min: 6,
    max: longestPetal,
    step: 0.1,
  },
  { key: 'width', label: 'Petal width', min: 3, max: 5.5, step: 0.1 },
  { key: 'bulb', label: 'Bulb position', min: 0.4, max: 0.85, step: 0.01 },
  { key: 'tipSharpness', label: 'Tip sharpness', min: 0, max: 1, step: 0.01 },
];

/**
 * The shape with one parameter set from a slider's raw value. A value that
 * is not a number or falls outside the control's range changes nothing.
 */
export const tuneShape = (
  shape: PetalShape,
  key: keyof PetalShape,
  raw: string,
): PetalShape => {
  const control = shapeControls.find((candidate) => candidate.key === key);
  const value = Number(raw);
  if (
    control === undefined ||
    raw.trim() === '' ||
    !Number.isFinite(value) ||
    value < control.min ||
    value > control.max
  )
    return shape;
  return { ...shape, [key]: value };
};
