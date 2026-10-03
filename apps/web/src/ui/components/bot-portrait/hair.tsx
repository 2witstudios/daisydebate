import type { ReactNode } from 'react';
import type { HairStyle } from './look';

type Fill = { readonly fill: string };

/** The head is slimmer than the hair shapes were drawn for. */
const narrow = 'translate(15 0) scale(0.85 1)';

/** Hair over the forehead and temples: bold flat shapes. */
const front: Readonly<Record<HairStyle, (c: Fill) => ReactNode>> = {
  sweep: (c) => (
    <path
      {...c}
      transform={narrow}
      d="M50 100C44 56 76 38 104 40C134 42 154 62 150 100C146 82 132 68 108 66C96 78 72 82 50 100Z"
    />
  ),
  curly: (c) => (
    <>
      {[
        [58, 68],
        [68, 50],
        [88, 40],
        [112, 40],
        [132, 50],
        [142, 68],
        [100, 48],
      ].map(([cx, cy]) => (
        <circle {...c} key={`${cx}-${cy}`} cx={cx} cy={cy} r="17" />
      ))}
    </>
  ),
  sides: (c) => (
    <g transform={narrow}>
      <path {...c} d="M54 112C48 92 52 70 66 60C60 80 62 96 68 116Z" />
      <path {...c} d="M146 112C152 92 148 70 134 60C140 80 138 96 132 116Z" />
    </g>
  ),
};

export const hairFront = (style: HairStyle, fill: string): ReactNode =>
  front[style]({ fill });
