/**
 * The Daisy board palette (ADR 0045), copied as static values from `globals.css`'s
 * `light-dark()` tokens (`brand-palette.test.ts` keeps the two equal). No CSS
 * custom property can be read outside a browser stylesheet, so the emailed
 * link (`mail/layout.ts`) and the two confirm pages, which are never served
 * through the Next app's CSS pipeline, each need these as plain values.
 */
export type BrandPalette = {
  readonly background: string;
  /** The forest stage panel, the same in both schemes, with its own ink. */
  readonly surfaceStage: string;
  readonly stageInk: string;
  readonly stageInkMuted: string;
  readonly surfaceRaised: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly border: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly accentInk: string;
  readonly gold: string;
  /** Brand primitives for the mark: reverse petals and the disc. */
  readonly cream: string;
  readonly butter: string;
  /** Amber notice surface: no equivalent token exists in globals.css yet. */
  readonly noticeBg: string;
  readonly noticeBorder: string;
  readonly noticeInk: string;
};

export const AUTH_BRAND_PALETTE: {
  readonly light: BrandPalette;
  readonly dark: BrandPalette;
} = {
  light: {
    background: '#f5f0e4',
    surfaceStage: '#173b2a',
    stageInk: '#f5f0e4',
    stageInkMuted: '#bccdb3',
    surfaceRaised: '#fffdf8',
    ink: '#173b2a',
    inkMuted: '#4a5f51',
    border: '#ddd6c4',
    accent: '#173b2a',
    accentStrong: '#0e2a1c',
    accentInk: '#f5f0e4',
    gold: '#7e5c12',
    cream: '#f5f0e4',
    butter: '#f7da8c',
    noticeBg: '#fdf3e2',
    noticeBorder: '#ecd19c',
    noticeInk: '#6b4a0a',
  },
  dark: {
    background: '#0d1812',
    surfaceStage: '#173b2a',
    stageInk: '#f5f0e4',
    stageInkMuted: '#bccdb3',
    surfaceRaised: '#182a20',
    ink: '#f5f0e4',
    inkMuted: '#b4c2ae',
    border: '#24382c',
    accent: '#a7c09c',
    accentStrong: '#bdd2b2',
    accentInk: '#173b2a',
    gold: '#f0cf7a',
    cream: '#f5f0e4',
    butter: '#f7da8c',
    noticeBg: '#2a2110',
    noticeBorder: '#5a4516',
    noticeInk: '#f2d38c',
  },
};
