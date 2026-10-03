import type { PortraitLook } from '../components/bot-portrait/look';

export type MockBot = {
  readonly id: string;
  readonly name: string;
  /** Who it is in a few words. */
  readonly tagline: string;
  /** Its character: temperament and manner, not how it debates. */
  readonly personality: string;
  /** How it sounds: the voice that goes with the personality. */
  readonly voice: string;
  readonly traits: readonly string[];
  /** What it looks like, as data a portrait is drawn from. */
  readonly look: PortraitLook;
};

/**
 * Sample opponents: a few personas, spread across temperament and energy so
 * the choice is easy and each gives different data. Each is a character with
 * a voice that suits it.
 * How a bot debates is not described here: that is emergent from its prompt,
 * and the bots adapt to the person they face, so none is rated. Every name,
 * trait and voice is a sample until the bots are specified; the opponent
 * read replaces this file's use in `bots.ts`.
 */
export const sampleBots: readonly MockBot[] = [
  {
    id: 'juno',
    name: 'Juno',
    tagline: 'Big-hearted and dramatic',
    personality:
      'Wears every feeling on its sleeve, tells long stories, and cannot help being enthusiastic about almost anything.',
    voice: 'Lively and fast, full of expression',
    traits: ['Warm', 'Dramatic', 'Enthusiastic'],
    look: {
      skin: '#8d5a3b',
      hair: '#2a1a14',
      hairStyle: 'curly',
      beard: false,
      glasses: 'none',
      lids: 0,
      browLift: [4, 4],
      browTilt: 0,
      smile: 1,
      outfit: '#e07a5f',
      accent: '#f8d9cd',
      backdrop: '#fbe9df',
    },
  },
  {
    id: 'wren',
    name: 'Wren',
    tagline: 'Quick-witted and dry',
    personality:
      'Sarcastic in a friendly way, always has a comeback, and is never quite as unimpressed as it sounds.',
    voice: 'Crisp and quick, with a dry edge',
    traits: ['Witty', 'Sardonic', 'Playful'],
    look: {
      skin: '#f5d6be',
      hair: '#9c3f2a',
      hairStyle: 'sweep',
      beard: false,
      glasses: 'none',
      lids: 0.1,
      browLift: [0, 7],
      browTilt: -2,
      smile: 0.4,
      outfit: '#2f4858',
      accent: '#f4a261',
      backdrop: '#e0eceb',
    },
  },
  {
    id: 'bram',
    name: 'Bram',
    tagline: 'The retired professor',
    personality:
      'Patient and fond of a tangent, like someone who has explained things for forty years and still enjoys it.',
    voice: 'Warm, unhurried baritone',
    traits: ['Patient', 'Wise', 'Wry'],
    look: {
      skin: '#e9bf9d',
      hair: '#cfcfd6',
      hairStyle: 'sides',
      beard: true,
      glasses: 'round',
      lids: 0.15,
      browLift: [1, 1],
      browTilt: 3,
      smile: 0.45,
      outfit: '#7a5c3e',
      accent: '#d4b985',
      backdrop: '#efe6d8',
    },
  },
];
