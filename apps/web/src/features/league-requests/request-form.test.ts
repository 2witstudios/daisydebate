import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  blankRequest,
  honeypotField,
  leagueRequestOf,
  requestFields,
  requestIncomplete,
  requestUnacknowledged,
  requestValuesOf,
} from './request-form';
setupRitewayBun();

const requestId = 'k3v9q2w8e7r6t5y4u3i2o1pa';

const filled = {
  ...blankRequest(requestId),
  leagueName: '  Gulf Coast Speech League ',
  needs: 'We run 8 tournaments a season.',
  contactName: 'Dana Whitfield',
  contactRole: 'League director',
  contactEmail: 'dana@gulfcoastspeech.org',
};

test('leagueRequestOf', () => {
  assert({
    given: 'every required field filled, and no phone',
    should: 'accept the request with its text trimmed',
    actual: leagueRequestOf(filled),
    expected: {
      kind: 'accepted',
      request: {
        v: 1,
        requestId,
        leagueName: 'Gulf Coast Speech League',
        schools: '10-25',
        seasons: '2',
        style: 'freestyle',
        divisions: 'youth',
        needs: 'We run 8 tournaments a season.',
        contactName: 'Dana Whitfield',
        contactRole: 'League director',
        contactEmail: 'dana@gulfcoastspeech.org',
        contactPhone: '',
      },
    },
  });

  assert({
    given: 'a phone number with punctuation',
    should: 'accept it',
    actual: leagueRequestOf({ ...filled, contactPhone: '+1 (251) 555-0143' })
      .kind,
    expected: 'accepted',
  });

  assert({
    given: 'the blank form',
    should: 'name each required field it is missing, and nothing optional',
    actual: leagueRequestOf(blankRequest(requestId)),
    expected: {
      kind: 'incomplete',
      errors: {
        leagueName: "Enter your league's name, up to 120 characters.",
        contactName: 'Enter your name, up to 120 characters.',
        contactRole: 'Enter your role, up to 120 characters.',
        contactEmail: 'Enter an email address we can reply to.',
      },
    },
  });

  assert({
    given: 'a value outside a closed vocabulary, a bad email and a short phone',
    should: 'refuse each with its own message',
    actual: leagueRequestOf({
      ...filled,
      schools: 'hundreds',
      divisions: 'varsity',
      style: 'policy',
      contactEmail: 'dana at gulfcoast',
      contactPhone: '555',
    }),
    expected: {
      kind: 'incomplete',
      errors: {
        schools: 'Choose how many schools.',
        style: 'Choose a style.',
        divisions: 'Choose the divisions.',
        contactEmail: 'Enter an email address we can reply to.',
        contactPhone: 'Enter a phone number, or leave it empty.',
      },
    },
  });

  assert({
    given: 'a league name carrying a line break',
    should: 'refuse it, so it cannot reach the email subject',
    actual: leagueRequestOf({ ...filled, leagueName: 'Gulf\r\nBcc: x@y.z' }),
    expected: {
      kind: 'incomplete',
      errors: {
        leagueName: "Enter your league's name, up to 120 characters.",
      },
    },
  });

  assert({
    given: 'notes longer than the limit',
    should: 'refuse the notes',
    actual: leagueRequestOf({ ...filled, needs: 'x'.repeat(4001) }),
    expected: {
      kind: 'incomplete',
      errors: { needs: 'Keep this to 4,000 characters.' },
    },
  });

  assert({
    given: 'a form whose request id was tampered with',
    should: 'ask for a reload',
    actual: leagueRequestOf({ ...filled, requestId: 'not-an-id' }),
    expected: {
      kind: 'incomplete',
      errors: {
        requestId: 'This form has expired. Reload the page and send it again.',
      },
    },
  });

  assert({
    given: 'the hidden trap filled, even on an otherwise valid form',
    should: 'read as trapped',
    actual: leagueRequestOf({ ...filled, [honeypotField]: 'https://spam' }),
    expected: { kind: 'trapped' },
  });

  assert({
    given: 'the hidden trap filled with only spaces',
    should: 'read the form as usual',
    actual: leagueRequestOf({ ...filled, [honeypotField]: '   ' }).kind,
    expected: 'accepted',
  });
});

test('requestValuesOf', () => {
  assert({
    given: 'posted values with extra and missing keys',
    should: 'keep exactly the form fields, missing ones empty',
    actual: requestValuesOf({
      leagueName: 'X',
      [honeypotField]: 'y',
      other: 'z',
    }),
    expected: {
      requestId: '',
      leagueName: 'X',
      schools: '',
      seasons: '',
      style: '',
      divisions: '',
      needs: '',
      contactName: '',
      contactRole: '',
      contactEmail: '',
      contactPhone: '',
    },
  });
});

test('requestFields', () => {
  assert({
    given: 'an incomplete answer',
    should: 'render the typed values with each field message',
    actual: requestFields(
      requestIncomplete(filled, { contactEmail: 'Enter an email' }),
    ),
    expected: {
      values: filled,
      errors: { contactEmail: 'Enter an email' },
      notice: undefined,
    },
  });

  assert({
    given: 'a lost answer',
    should: 'keep the values and say it is safe to send again',
    actual: requestFields(requestUnacknowledged(filled)).notice,
    expected:
      'We may not have received your request. Send it again; it will only arrive once.',
  });
});
