import type { ReactNode } from 'react';
import type { PortraitLook } from './look';

const ink = '#231f20';
const eyeY = 100;
const eyeXs = [83, 117] as const;

/** Both eyes in one group, so a blink closes them together. */
export const Eyes = ({ look }: { readonly look: PortraitLook }): ReactNode => (
  <g className="portrait-blink" fill={ink}>
    {eyeXs.map((cx) => (
      <ellipse
        key={cx}
        cx={cx}
        cy={eyeY + look.lids * 1.5}
        rx="5"
        ry={5.4 - look.lids * 3.2}
      />
    ))}
  </g>
);

/** Brows: short bold strokes; each can sit higher, and both tilt together. */
export function Brows({ look }: { readonly look: PortraitLook }): ReactNode {
  return (
    <g fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round">
      {eyeXs.map((cx, side) => {
        const outward = side === 0 ? 1 : -1;
        const lift = look.browLift[side] ?? 0;
        const tilt = outward * look.browTilt * 0.3;
        return (
          <path
            key={cx}
            d={`M${cx - 7} ${84 - lift + tilt}L${cx + 7} ${84 - lift - tilt}`}
          />
        );
      })}
    </g>
  );
}

const mouthY = 128;

/**
 * The mouth: a simple line that curves with the smile, and a dark shape that
 * opens and closes while the bot speaks. Only the open shape animates, and
 * only when its container says the bot is speaking.
 */
export function Mouth({ look }: { readonly look: PortraitLook }): ReactNode {
  const curve = mouthY + look.smile * 10;
  return (
    <g>
      <path
        className="portrait-mouth-closed"
        d={`M90 ${mouthY}Q100 ${curve} 110 ${mouthY}`}
        fill="none"
        stroke={ink}
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      <ellipse
        className="portrait-mouth-open"
        cx="100"
        cy={mouthY + 3}
        rx="8.5"
        ry="7"
        fill={ink}
      />
    </g>
  );
}

/** Glasses sit over the eyes, outside the blink. */
export function Glasses({ look }: { readonly look: PortraitLook }): ReactNode {
  if (look.glasses === 'none') return null;
  return (
    <g fill="none" stroke={ink} strokeWidth="3.6" strokeLinecap="round">
      {eyeXs.map((cx) => (
        <circle key={cx} cx={cx} cy={eyeY} r="13.5" />
      ))}
      <path d={`M${eyeXs[0] + 13.5} ${eyeY}L${eyeXs[1] - 13.5} ${eyeY}`} />
    </g>
  );
}
