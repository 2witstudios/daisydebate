import { Brows, Eyes, Glasses, Mouth } from './face';
import { hairFront } from './hair';
import type { PortraitLook } from './look';

export type BotPortraitProps = {
  /** Kept so each bot's drawing can be told apart in the page. */
  readonly id: string;
  readonly look: PortraitLook;
  /** `bust` is head and shoulders; `face` crops to the head for small sizes. */
  readonly framing?: 'bust' | 'face';
  /** The mouth moves while true. Pointing at the portrait also does it. */
  readonly speaking?: boolean;
  /** What the portrait shows; omit when the name is already beside it. */
  readonly label?: string;
};

const viewBoxes = {
  bust: '0 0 200 240',
  face: '38 22 124 164',
} as const;

/** One straight-sided shape, head and body together, like a thumb: parallel
    sides, a rounded top, no neck and no taper. It runs down behind the
    shirt, so there is never a gap. */
const thumbPath =
  'M58 100C58 66 74 44 100 44C126 44 142 66 142 100L142 210L58 210Z';

/** Shoulders over the thumb, with the neckline cut between its two sides. */
const shouldersPath =
  'M12 240C14 186 40 160 58 156C72 176 128 176 142 156C160 160 186 186 188 240Z';

/** The accent trim follows the neckline. */
const trimPath = 'M58 156C72 176 128 176 142 156';

const beardPath =
  'M60 108C60 148 76 170 100 170C124 170 140 148 140 108C132 130 120 140 100 140C80 140 68 130 60 108Z';

/**
 * A bot as an abstract person: flat, bold shapes with a minimal face, so the
 * character comes from colour, hair and silhouette rather than from realism.
 * A small idle motion (breathing, blinking, a slow sway) keeps it present in
 * a call. It is drawn from a `PortraitLook`, never an image file.
 */
export function BotPortrait({
  id,
  look,
  framing = 'bust',
  speaking = false,
  label,
}: BotPortraitProps) {
  return (
    <svg
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox={viewBoxes[framing]}
      data-bot={id}
      data-speaking={speaking}
      className="block h-full w-full portrait"
    >
      <rect width="200" height="240" fill={look.backdrop} />
      <circle cx="100" cy="112" r="82" fill="#ffffff" opacity="0.4" />
      <g className="portrait-sway">
        <g className="portrait-breathe">
          <path d={thumbPath} fill={look.skin} />
          <path d={shouldersPath} fill={look.outfit} />
          <path
            d={trimPath}
            fill="none"
            stroke={look.accent}
            strokeWidth="5"
            strokeLinecap="round"
          />
          {look.beard ? (
            <path
              d={beardPath}
              fill={look.hair}
              transform="translate(15 0) scale(0.85 1)"
            />
          ) : null}
          <Mouth look={look} />
          <Eyes look={look} />
          <Brows look={look} />
          <Glasses look={look} />
          {hairFront(look.hairStyle, look.hair)}
        </g>
      </g>
    </svg>
  );
}
