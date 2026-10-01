import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  entryEligibility,
  registrationState,
  type Entry,
  type Viewer,
} from './entry';
import { tournament } from './tournament.test-support';

setupRitewayBun();

const viewer: Viewer = { handle: 'debater-a', rating: 1620, established: true };
const registered: Entry = { kind: 'registered', note: '', firstOpponent: null };
const waitlisted: Entry = { kind: 'waitlisted', position: 2, note: '' };
const competing: Entry = { kind: 'competing', stage: 'semifinal', note: '' };

describe('registrationState', () => {
  test('registration states follow the lifecycle, viewer and entry', () => {
    const full = tournament({ entered: 16, waitlisted: 3 });
    assert({
      given: 'open, registered, waitlisted, full and signed-out views',
      should: 'name the panel state',
      actual: [
        registrationState(tournament(), viewer, null),
        registrationState(tournament(), viewer, registered),
        registrationState(full, viewer, null),
        registrationState(full, viewer, waitlisted),
        registrationState(tournament(), null, null),
      ],
      expected: ['open', 'registered', 'full', 'waitlisted', 'signed-out'],
    });
  });

  test('after registration the panel follows the event', () => {
    const at = (
      lifecycle:
        'announced' | 'registration-closed' | 'in-progress' | 'completed',
    ) => tournament({ lifecycle });
    assert({
      given: 'announced, closed, live (with and without an entry) and done',
      should: 'name not-open, closed, competing, in-progress and completed',
      actual: [
        registrationState(at('announced'), viewer, null),
        registrationState(at('registration-closed'), viewer, registered),
        registrationState(at('in-progress'), viewer, competing),
        registrationState(at('in-progress'), null, null),
        registrationState(at('completed'), viewer, null),
      ],
      expected: ['not-open', 'closed', 'competing', 'in-progress', 'completed'],
    });
  });
});

describe('entryEligibility', () => {
  test('rating band and closed registration refuse', () => {
    assert({
      given: 'an open tournament, a band excluding 1620 and a closed one',
      should:
        'allow, refuse by band, refuse as closed, and allow a full waitlist',
      actual: [
        entryEligibility(tournament(), viewer),
        entryEligibility(
          tournament({ band: { min: 1000, max: 1400 } }),
          viewer,
        ),
        entryEligibility(
          tournament({ lifecycle: 'registration-closed' }),
          viewer,
        ),
        entryEligibility(tournament({ entered: 16 }), viewer),
      ],
      expected: [
        { ok: true },
        { ok: false, reason: 'outside-band' },
        { ok: false, reason: 'closed' },
        { ok: true },
      ],
    });
  });
});
