import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ChangeEvent } from 'react';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { petalShape } from '../../../features/brand/brand-geometry';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { findElements } from '../../../ui/test-support/find-elements';
import { BrandSheet, BrandSheetView } from './brand-sheet';
import { shapeControls } from './shape-controls';

setupRitewayBun();

describe('BrandSheet', () => {
  test('previews the committed constants by default', () => {
    const view = renderAccessible(h(BrandSheet));
    assert({
      given: 'the sheet with no slider moved',
      should: 'set each slider to its value',
      actual: shapeControls.map(({ label }) =>
        view.attribute('slider', `${label}:`, 'value'),
      ),
      expected: shapeControls.map(({ key }) => String(petalShape[key])),
    });
  });
});

describe('BrandSheetView', () => {
  test('reports each slider move as a tuning of its parameter', () => {
    const tunes: string[] = [];
    const tree = BrandSheetView({
      shape: petalShape,
      onTune: (key, raw) => tunes.push(`${key}=${raw}`),
      onReset: () => {},
    });
    const sliders = findElements(
      tree,
      (element) => element.props.type === 'range',
    );
    for (const slider of sliders)
      (slider.props.onChange as (event: ChangeEvent<HTMLInputElement>) => void)(
        {
          currentTarget: { value: '0.5' },
        } as ChangeEvent<HTMLInputElement>,
      );
    assert({
      given: 'each of the four sliders moved',
      should: 'report the parameter it tunes with the raw value',
      actual: tunes,
      expected: ['length=0.5', 'width=0.5', 'bulb=0.5', 'tipSharpness=0.5'],
    });
  });
});

describe('preview-scheme utilities', () => {
  const sourceRoot = join(import.meta.dir, '../../..');
  const sources = (dir: string): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(join(dir, entry.name))
        : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
    );

  test('are used only by the brand sheet', () => {
    assert({
      given: 'every source file in the web app',
      should:
        'find the classes that pin a colour scheme only under /foundation (ADR 0045)',
      actual: sources(sourceRoot)
        .filter((file) =>
          readFileSync(file, 'utf8').includes('preview-scheme-'),
        )
        .map((file) => relative(sourceRoot, file)),
      expected: ['app/(bare)/foundation/brand-sheet.tsx'],
    });
  });
});
