import Image from 'next/image';
import { art } from '../../assets';
import { cn } from '../../cn';

/**
 * The Home hero's photograph and scrim, shared by the visitor's waitlist hero
 * and the member's hero so signing in never swaps the picture out. Lays under
 * the hero's content, which must sit on `relative`.
 */
export function HeroPhoto({
  hiddenOnPhone = false,
}: {
  readonly hiddenOnPhone?: boolean;
}) {
  const phone = hiddenOnPhone ? 'max-narrow:hidden' : '';
  return (
    <>
      <Image
        src={art.heroAgon.src}
        alt={art.heroAgon.alt}
        width={art.heroAgon.width}
        height={art.heroAgon.height}
        priority
        sizes="(max-width: 1100px) 100vw, 1180px"
        className={cn(
          'absolute inset-0 -z-2 size-full object-cover object-hero-photo brightness-82 saturate-85',
          phone,
        )}
      />
      <div
        className={cn('absolute inset-0 -z-1 scrim-hero', phone)}
        aria-hidden="true"
      />
    </>
  );
}
