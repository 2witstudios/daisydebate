import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomConfig } from '@daisy/protocol';
import { format, schedule } from './catalog-formats.test-support';

setupRitewayBun();

describe('catalogFormats', () => {
  test('resolution strikes (FMT-2b)', () => {
    const strike = (id: string) => {
      const { preset } = format(id);
      return {
        draw: preset.resolutionDraw,
        preRoundPrep: preset.preRoundPrep,
        inRoundPrep: preset.inRoundPrep,
        capable: format(id).definition.configurable.resolutionDraw !== null,
      };
    };
    const bank: RoomConfig['resolutionDraw'] = {
      enabled: true,
      drawSize: 5,
      strikeWindowMs: 60_000,
      firstStriker: 'negative',
      source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
    };
    assert({
      given: 'Freestyle, IPDA and Team IPDA',
      should:
        'strike from 5 bank resolutions of any kind, Neg first, then prep: 20 min for Freestyle, the IPDA-recommended 30 for the leagues, none during the round',
      actual: ['freestyle', 'ipda', 'team-ipda'].map(strike),
      expected: [
        {
          draw: bank,
          preRoundPrep: { enabled: true, durationMs: 1_200_000 },
          inRoundPrep: { enabled: false },
          capable: true,
        },
        {
          draw: bank,
          preRoundPrep: { enabled: true, durationMs: 1_800_000 },
          inRoundPrep: { enabled: false },
          capable: true,
        },
        {
          draw: bank,
          preRoundPrep: { enabled: true, durationMs: 1_800_000 },
          inRoundPrep: { enabled: false },
          capable: true,
        },
      ],
    });
    assert({
      given: 'Policy and Value',
      should:
        'let a host turn on a strike, while their presets keep the resolution set in advance',
      actual: ['policy', 'value'].map((id) => [
        strike(id).capable,
        strike(id).draw.enabled,
      ]),
      expected: [
        [true, false],
        [true, false],
      ],
    });
    assert({
      given: 'Freestyle',
      should: 'run the shared standard 1v1 schedule',
      actual: schedule('freestyle'),
      expected: schedule('value'),
    });
    assert({
      given: 'IPDA',
      should: 'run the IPDA bylaws’ 5-2-6-2-3-5-3 with the opponent asking',
      actual: schedule('ipda'),
      expected: [
        'AC A0 5',
        'CX1 N0 2',
        'NC N0 6',
        'CX2 A0 2',
        'AR A0 3',
        'NR N0 5',
        'AS A0 3',
      ],
    });
    assert({
      given: 'Team IPDA',
      should:
        'run 4-2-5-2-5-2-4-2 then 3-4-4-3 rebuttals with 2N, 1A, 1N, 2A asking',
      actual: schedule('team-ipda'),
      expected: [
        '1AC A0 4',
        'CX1 N1 2',
        '1NC N0 5',
        'CX2 A0 2',
        '2AC A1 5',
        'CX3 N0 2',
        '2NC N1 4',
        'CX4 A1 2',
        '1NR N0 3',
        '1AR A0 4',
        '2NR N1 4',
        '2AR A1 3',
      ],
    });
  });
});
