import { Avatar } from '../../components/avatar/avatar';
import { avatarSrc } from '../../assets';
import { competitorClass, type CompetitorSide } from './live-now-class';

export function Competitor({
  side,
  name,
  rating,
}: {
  readonly side: CompetitorSide;
  readonly name: string;
  readonly rating: number;
}) {
  const avatar = <Avatar name={name} src={avatarSrc(name)} size="md" />;
  const who = (
    <span className="flex min-w-0 flex-col gap-roster-inset">
      <span className="truncate text-sm leading-tight font-bold text-ink">
        {name}
      </span>
      <span className="text-xs leading-tight text-ink-muted tabular-nums">
        ({rating})
      </span>
    </span>
  );
  return (
    <span className={competitorClass(side)}>
      {side === 'home' ? avatar : who}
      {side === 'home' ? who : avatar}
    </span>
  );
}
