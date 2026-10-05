import type { BadgeTone } from '../components/badge/badge-class';

/** One line of a preview: every name, rating and date here is sample data. */
export type PreviewRowData = {
  readonly id: string;
  /** Shown as an avatar when present. */
  readonly who?: string;
  readonly title: string;
  readonly detail?: string;
  readonly tag?: { readonly tone: BadgeTone; readonly text: string };
  readonly trailing?: string;
};

export const rankedLadder: readonly PreviewRowData[] = [
  { id: 'r1', who: 'debater-a', title: '1 · @debater-a', trailing: '1712 +8' },
  { id: 'r2', who: 'debater-b', title: '2 · @debater-b', trailing: '1688 -4' },
  { id: 'r3', who: 'debater-c', title: '3 · @debater-c', trailing: '1651 +12' },
  { id: 'r4', who: 'debater-d', title: '4 · @debater-d', trailing: '1604 +2' },
  { id: 'me', who: 'You', title: '212 · You', trailing: '1412 +14' },
];

export const lobbyRooms: readonly PreviewRowData[] = [
  {
    id: 'l1',
    title: 'Tuesday night, no mercy',
    detail: '@host-one 1512 · open seat 1300–1700',
    tag: { tone: 'accent', text: 'Ranked' },
    trailing: 'Waiting 2 min',
  },
  {
    id: 'l2',
    title: 'Newcomers welcome',
    detail: '@host-two 1180 · open seat, any rating',
    tag: { tone: 'neutral', text: 'Casual' },
    trailing: 'Waiting 6 min',
  },
  {
    id: 'l3',
    title: 'Top of the ladder',
    detail: '@host-five 1710 · open seat 1600–1800',
    tag: { tone: 'accent', text: 'Ranked' },
    trailing: 'Waiting 4 min',
  },
  {
    id: 'l4',
    title: 'Quarterfinal practice',
    detail: '@debater-a 1620 vs @debater-b 1588',
    tag: { tone: 'live', text: 'Live' },
    trailing: '14 watching',
  },
];

export const watchRooms: readonly PreviewRowData[] = [
  {
    id: 'w1',
    title: 'Finals rehearsal',
    detail: '@debater-c vs @debater-d',
    tag: { tone: 'live', text: 'Live' },
    trailing: '31 watching',
  },
  {
    id: 'w2',
    title: 'Friendly spar',
    detail: '@debater-e vs @debater-f',
    tag: { tone: 'live', text: 'Live' },
    trailing: '3 watching',
  },
];

export const judgeBallot: readonly PreviewRowData[] = [
  { id: 'j1', title: 'Argumentation', trailing: 'Aff 4 · Neg 3' },
  { id: 'j2', title: 'Refutation', trailing: 'Aff 3 · Neg 4' },
  { id: 'j3', title: 'Evidence', trailing: 'Aff 4 · Neg 4' },
  { id: 'j4', title: 'Delivery', trailing: 'Aff 5 · Neg 3' },
];

export const tournamentList: readonly PreviewRowData[] = [
  {
    id: 't1',
    title: 'Spring Open',
    detail: 'Single elimination · 24 of 32 entered',
    tag: { tone: 'accent', text: 'Registration open' },
    trailing: 'Register',
  },
  {
    id: 't2',
    title: 'Club Championship',
    detail: 'Round robin · round 2 of 4',
    tag: { tone: 'live', text: 'In progress' },
    trailing: 'Follow',
  },
  {
    id: 't3',
    title: 'Novice Cup',
    detail: 'Single elimination · 16 of 16 entered',
    tag: { tone: 'neutral', text: 'Full' },
    trailing: 'Starts in 3 days',
  },
];

export const tournamentBracket: readonly PreviewRowData[] = [
  { id: 'b1', title: '@entrant-1 vs @entrant-2', detail: 'Quarterfinal' },
  { id: 'b2', title: '@entrant-3 vs @entrant-4', detail: 'Quarterfinal' },
  { id: 'b3', title: 'Winner QF1 vs Winner QF2', detail: 'Semifinal' },
];

export const leaderboardRows: readonly PreviewRowData[] = [
  {
    id: 'a1',
    who: 'debater-a',
    title: '1 · @debater-a',
    tag: { tone: 'gold', text: 'Established' },
    trailing: '1712 · 48–12',
  },
  {
    id: 'a2',
    who: 'debater-b',
    title: '2 · @debater-b',
    tag: { tone: 'gold', text: 'Established' },
    trailing: '1688 · 44–15',
  },
  {
    id: 'a3',
    who: 'debater-f',
    title: '6 · @debater-f',
    tag: { tone: 'neutral', text: 'Provisional' },
    trailing: '1577 · 9–4',
  },
  {
    id: 'a4',
    who: 'You',
    title: '212 · You',
    tag: { tone: 'neutral', text: 'Provisional' },
    trailing: '1412 · 7–3',
  },
];

export const trainModes: readonly PreviewRowData[] = [
  {
    id: 'm1',
    title: 'Guided practice',
    detail: 'Debate a paced prompt, turn by turn.',
  },
  {
    id: 'm2',
    title: 'Argument drills',
    detail: 'Write one argument and get instant structure feedback.',
  },
  {
    id: 'm3',
    title: 'Spaced review',
    detail: 'Saved arguments come back when you are about to forget them.',
    tag: { tone: 'accent', text: '6 due today' },
  },
];

export const trainFeedback: readonly PreviewRowData[] = [
  { id: 'f1', title: 'Claim', detail: 'Clear and arguable: transit first.' },
  { id: 'f2', title: 'Warrant', detail: 'You explain why access comes first.' },
  {
    id: 'f3',
    title: 'Impact',
    detail: 'Say who it matters to, in one sentence.',
  },
];

export const prepLibrary: readonly PreviewRowData[] = [
  {
    id: 'p1',
    title: '[Brief title]',
    detail: '4 contentions · updated 2 Oct',
    tag: { tone: 'accent', text: 'Brief' },
  },
  {
    id: 'p2',
    title: '[Evidence card tag line]',
    detail: '[Author], [Year]',
    tag: { tone: 'neutral', text: 'Card' },
  },
  {
    id: 'p3',
    title: '[Case title]',
    detail: '3 versions · shared with Riverside',
    tag: { tone: 'gold', text: 'Case' },
  },
];
