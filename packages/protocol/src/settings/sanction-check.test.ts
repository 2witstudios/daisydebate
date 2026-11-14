import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { settingsCatalogue, type SettingRow } from './catalogue';
import { eventChain, resolveSettings } from './resolve-setting';
import { sanctionCheck } from './sanction-check';
import { settingKeySchema } from './setting-values';
import {
  formatDefaults,
  otherValues,
  row,
  scope,
} from './settings.test-support';

setupRitewayBun();

const pins = {
  formatVersionId: 'format-1',
  ballotDefinitionVersionId: 'ballot-1',
};
const template = scope('template');
const owner = scope('organization', 'league');
const following = eventChain({
  template: { id: 'template', organizationId: 'league' },
  leagueId: null,
  lobbyId: 'tournament',
  eventId: 'event',
});
const alone = eventChain({
  template: null,
  leagueId: null,
  lobbyId: 'tournament',
  eventId: 'event',
});
/** Every key the template or its organization may enforce, enforced. */
const enforceable = settingKeySchema.options.filter(
  (key) => settingsCatalogue[key].enforceable,
);
const enforced: SettingRow[] = enforceable.map((key) =>
  row(
    settingsCatalogue[key].scopes.includes('template') ? template : owner,
    key,
    otherValues[key],
    'enforced',
  ),
);
const check = (
  chain: typeof following,
  rows: readonly SettingRow[],
  eventPins = pins,
  templateEnforced = enforced,
) =>
  sanctionCheck(
    { ...pins, enforced: templateEnforced },
    { ...eventPins, resolved: resolveSettings(chain, rows, formatDefaults) },
  );
/** The host's own rows: every key at every scope below the template, at Daisy's value. */
const hostRows: SettingRow[] = settingKeySchema.options.flatMap((key) =>
  [scope('lobby', 'tournament'), scope('event')]
    .filter((at) => settingsCatalogue[key].scopes.includes(at.kind))
    .map((at) =>
      row(at, key, resolveSettings(alone, [], formatDefaults)[key].value),
    ),
);

describe('the sanction check', () => {
  test('always passes for an event that follows the template', () => {
    assert({
      given:
        'a template enforcing every key that can be, followed by an event whose host set every key otherwise',
      should: 'pass, with the same format and ballot definition',
      actual: [
        check(following, enforced),
        check(following, [...enforced, ...hostRows]),
      ],
      expected: [{ passes: true }, { passes: true }],
    });
  });
  test('fails for each enforced value the event does not resolve to', () => {
    /** A host's own copy of the template's values, minus one key. */
    const copiedWithout = (left: string | null) =>
      enforced
        .filter((kept) => kept.key !== left)
        .map((kept) =>
          row(
            settingsCatalogue[kept.key].scopes.includes('lobby')
              ? scope('lobby', 'tournament')
              : owner,
            kept.key,
            kept.value,
          ),
        );
    assert({
      given:
        'an event that copied every enforced value, whole and then with one key at a time left unset',
      should: 'pass whole, and name exactly the one key each time',
      actual: [
        check([owner, ...alone], copiedWithout(null)),
        enforceable.filter((left) => {
          const result = check([owner, ...alone], copiedWithout(left));
          return result.passes || result.mismatches.join() !== left;
        }),
      ],
      expected: [{ passes: true }, []],
    });
  });
  test('needs the same format and ballot definition', () => {
    assert({
      given:
        'an event that follows the template but pins another format, another ballot, or both',
      should: 'name each difference',
      actual: [
        check(following, enforced, { ...pins, formatVersionId: 'format-2' }),
        check(following, enforced, {
          ...pins,
          ballotDefinitionVersionId: 'ballot-2',
        }),
        check(
          alone,
          [],
          { formatVersionId: 'f', ballotDefinitionVersionId: 'b' },
          [row(template, 'entry.approval', { value: 'automatic' }, 'enforced')],
        ),
        check(alone, [], pins, []),
      ],
      expected: [
        { passes: false, mismatches: ['format'] },
        { passes: false, mismatches: ['ballot_definition'] },
        {
          passes: false,
          mismatches: ['format', 'ballot_definition', 'entry.approval'],
        },
        { passes: true },
      ],
    });
  });
});
