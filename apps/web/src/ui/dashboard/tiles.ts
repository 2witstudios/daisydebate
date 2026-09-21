import type { ActionTileProps } from './action-tile/action-tile';

type TileConfig = ActionTileProps;

/** The eight destinations, in display order. */
export const tiles: readonly TileConfig[] = [
  {
    href: '/ranked',
    glyph: 'swords',
    title: 'Ranked',
    description: 'Climb the ladder. Prove yourself.',
    tint: 'accent',
    status: { tone: 'online', text: '1,248 online' },
  },
  {
    href: '/lobby',
    glyph: 'users',
    title: 'Lobby',
    description: 'Find a debate. Any topic. Any skill level.',
    status: { tone: 'online', text: '892 online' },
  },
  {
    href: '/watch',
    glyph: 'eye',
    title: 'Watch',
    description: 'Live debates and recordings, all in one place.',
    status: { tone: 'online', text: '634 watching' },
  },
  {
    href: '/judge',
    glyph: 'gavel',
    title: 'Judge',
    description: 'Help uphold fair play. Be a judge.',
    tint: 'gold',
    status: { tone: 'online', text: '312 online' },
  },
  {
    href: '/tournaments',
    glyph: 'trophy',
    title: 'Tournaments',
    description: 'Compete in events. Win recognition.',
    tint: 'gold',
    status: { tone: 'online', text: '5 active' },
  },
  {
    href: '/leaderboard',
    glyph: 'chart',
    title: 'Leaderboard',
    description: 'See the top debaters in the world.',
  },
  {
    href: '/train',
    glyph: 'bolt',
    title: 'Train',
    description: 'Practice arguments. Sharpen your mind.',
  },
  {
    href: '/prep',
    glyph: 'book',
    title: 'Prep',
    description: 'Briefs, cases, and evidence cards.',
  },
];
