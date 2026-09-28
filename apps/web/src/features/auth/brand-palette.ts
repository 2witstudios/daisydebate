/**
 * The Daisy green palette, copied as static values from `globals.css`'s
 * `light-dark()` tokens (`brand-palette.test.ts` keeps the two equal). No CSS
 * custom property can be read outside a browser stylesheet, so the emailed
 * link (`mail/layout.ts`) and the two confirm pages, which are never served
 * through the Next app's CSS pipeline, each need these as plain values.
 */
export type BrandPalette = {
  readonly background: string;
  readonly surfaceEmerald: string;
  readonly surfaceRaised: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly border: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly accentInk: string;
  readonly gold: string;
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
    background: '#f2f5f2',
    surfaceEmerald: '#e2f1e7',
    surfaceRaised: '#ffffff',
    ink: '#17211b',
    inkMuted: '#5b6d61',
    border: '#d8e2d9',
    accent: '#157c3e',
    accentStrong: '#116b36',
    accentInk: '#ffffff',
    gold: '#9a7a35',
    noticeBg: '#fdf3e2',
    noticeBorder: '#ecd19c',
    noticeInk: '#6b4a0a',
  },
  dark: {
    background: '#0a0e0c',
    surfaceEmerald: '#16281f',
    surfaceRaised: '#18211b',
    ink: '#f4f8f3',
    inkMuted: '#a3b3a6',
    border: '#26332b',
    accent: '#3ecf7a',
    accentStrong: '#2fb968',
    accentInk: '#052b16',
    gold: '#c9a35c',
    noticeBg: '#2a2110',
    noticeBorder: '#5a4516',
    noticeInk: '#f2d38c',
  },
};
