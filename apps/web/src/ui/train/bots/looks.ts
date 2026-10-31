import type { PortraitLook } from '../../components/bot-portrait/look';

/**
 * The shipped named portrait looks, reused where a real roster profile maps
 * to one stably by its durable name (DEC-269): the seeded bot debaters keep
 * their established characters, and any bot without a mapping here gets the
 * typographic card — never an invented identity.
 */
const namedLooks: Readonly<Record<string, PortraitLook>> = {
  Juno: {
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
  Wren: {
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
  Bram: {
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
};

/** The shipped look a roster name maps to, or null for the typographic card. */
export const portraitLook = (name: string): PortraitLook | null =>
  namedLooks[name] ?? null;
