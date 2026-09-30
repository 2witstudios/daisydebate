import { cn } from '../../cn';
import { Icon, type IconName } from '../../components/icon/icon';
import { prepGlyphs, type PrepGlyphName } from './prep-glyphs';

export type PrepIconName = PrepGlyphName | IconName;

export type PrepIconProps = {
  readonly name: PrepIconName;
  readonly size?: number;
  readonly className?: string | undefined;
};

const isGlyph = (name: PrepIconName): name is PrepGlyphName =>
  name in prepGlyphs;

/** A decorative icon: Prep's own glyphs first, then the shared icon set. */
export function PrepIcon({ name, size = 20, className }: PrepIconProps) {
  if (!isGlyph(name))
    return <Icon name={name} size={size} className={className} />;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('block shrink-0', className)}
    >
      {prepGlyphs[name]}
    </svg>
  );
}
