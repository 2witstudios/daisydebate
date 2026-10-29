import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rootTokens, schemeValue } from '../test-support/globals-tokens';
import { rasterPalette } from './raster-palette';

setupRitewayBun();

test('raster colors stay pinned to the shipped theme', () => {
  const tokens = rootTokens();
  const mapping = {
    paper: '--surface-raised',
    ink: '--text',
    muted: '--text-muted',
    petal: '--sage',
    bloom: '--mark-cardinal',
    disc: '--yolk',
  } as const;
  for (const scheme of ['light', 'dark'] as const)
    assert({
      given: `the ${scheme} raster palette`,
      should: 'match the theme rather than introduce another color system',
      actual: Object.entries(mapping).map(
        ([key, token]) =>
          rasterPalette[scheme][key as keyof typeof mapping] ===
          schemeValue(tokens.get(token)!, scheme),
      ),
      expected: Object.keys(mapping).map(() => true),
    });
});
