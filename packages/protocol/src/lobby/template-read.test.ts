import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import { templateReadCatalogue, templateViewSchema } from './template-read';

setupRitewayBun();

const id = (name: string) => name.padEnd(24, '0');
const view = {
  templateId: id('template'),
  name: 'Varsity debate',
  organization: { organizationId: id('league'), name: 'Southeast League' },
  format: { formatId: id('format'), formatVersion: 3, name: 'One-on-one' },
  ballotDefinition: null,
  retiredAt: null,
  settings: [
    { key: 'recording.capture', value: { value: 'on' }, hold: 'enforced' },
    { key: 'pairing.preset', value: { value: 'swiss_power' }, hold: 'default' },
  ],
  capabilities: { manage: false },
} as const;
const outcome = (input: unknown) => {
  const parsed = parseOutcome(templateViewSchema, input);
  return 'data' in parsed ? 'ok' : parsed.issues;
};

describe('template read', async () => {
  test('a template view', () => {
    assert({
      given: 'a template with its pins and rows, and one with a pinned ballot retired',
      should: 'parse',
      actual: [
        outcome(view),
        outcome({
          ...view,
          ballotDefinition: {
            ballotDefinitionId: id('ballot'),
            ballotDefinitionVersion: 1,
            name: 'League ballot',
          },
          retiredAt: '2026-11-01T00:00:00.000Z',
        }),
      ],
      expected: ['ok', 'ok'],
    });
  });

  test('what it refuses', () => {
    assert({
      given: 'a value the key refuses, a key never set on a template, a key twice, an unknown field',
      should: 'refuse each where it is wrong',
      actual: [
        outcome({ ...view, settings: [{ key: 'recording.capture', value: { value: 'x' }, hold: 'default' }] }),
        outcome({ ...view, settings: [{ key: 'entry.registration', value: { state: 'open' }, hold: 'default' }] }),
        outcome({ ...view, settings: [view.settings[0], view.settings[0]] }),
        outcome({ ...view, owner: 'someone' }),
      ],
      expected: [
        ['settings.0.value.value'],
        ['settings.0.key'],
        ['settings'],
        ['(root)'],
      ],
    });
    assert({
      given: 'the catalogue',
      should: 'gate the view on template.read',
      actual: templateReadCatalogue.TemplateView.gate,
      expected: ['template.read'],
    });
  });
});
