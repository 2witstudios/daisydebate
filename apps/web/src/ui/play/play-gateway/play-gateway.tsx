import Link from 'next/link';
import type { PlayOption, PlayOptionId } from '../../../features/play/options';
import { Icon, type IconName } from '../../components/icon/icon';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { cn } from '../../cn';

const icons: Readonly<Record<PlayOptionId, IconName>> = {
  ranked: 'swords',
  'practice-room': 'play',
  'join-room': 'users',
  bot: 'bolt',
  tournament: 'trophy',
};

/**
 * Each way to play has its own colour (ADR 0051), so the cards tell
 * themselves apart: a solid icon chip, a faint wash of the hue behind the
 * card, and a hover border. The title still says what it is.
 */
const hues: Readonly<
  Record<
    PlayOptionId,
    { readonly chip: string; readonly hover: string; readonly tint: string }
  >
> = {
  ranked: {
    chip: 'bg-hue-clay text-background',
    hover: 'hover:border-hue-clay',
    tint: 'bg-hue-clay-soft',
  },
  'practice-room': {
    chip: 'bg-hue-sky text-background',
    hover: 'hover:border-hue-sky',
    tint: 'bg-hue-sky-soft',
  },
  'join-room': {
    chip: 'bg-hue-teal text-background',
    hover: 'hover:border-hue-teal',
    tint: 'bg-hue-teal-soft',
  },
  bot: {
    chip: 'bg-hue-plum text-background',
    hover: 'hover:border-hue-plum',
    tint: 'bg-hue-plum-soft',
  },
  tournament: {
    chip: 'bg-gold text-background',
    hover: 'hover:border-gold-border',
    tint: 'bg-gold-soft',
  },
};

function OptionCard({
  option,
  wide,
}: {
  readonly option: PlayOption;
  readonly wide: boolean;
}) {
  return (
    <li className={cn(wide && 'col-span-2 max-compact:col-span-1')}>
      <Link
        href={option.href}
        className={cn(
          'flex h-full flex-col gap-3 rounded-xl border border-border p-5 text-ink no-underline shadow-1 hover:no-underline',
          hues[option.id].tint,
          hues[option.id].hover,
        )}
      >
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-round',
            hues[option.id].chip,
          )}
        >
          <Icon name={icons[option.id]} size={20} />
        </span>
        <span className="font-display text-xl font-bold">{option.title}</span>
        <span className="text-base text-ink-muted">{option.blurb}</span>
      </Link>
    </li>
  );
}

/**
 * Play as a gateway: the different things playing can mean, each a link to
 * its own page. The first, ranked, is wide because it is the main way to play.
 */
export function PlayGateway({
  options,
}: {
  readonly options: readonly PlayOption[];
}) {
  return (
    <ReadingPage>
      <PageHeader title="Play" lede="Choose how you want to debate." />
      <ul className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        {options.map((option, index) => (
          <OptionCard key={option.id} option={option} wide={index === 0} />
        ))}
      </ul>
    </ReadingPage>
  );
}
