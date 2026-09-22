import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  OUTBOX_ORIGIN,
  appendOutboxEvent,
  decodeOutboxCursor,
  drainOutbox,
  encodeOutboxCursor,
  purgeExpiredOutboxEvents,
} from './outbox';

setupRitewayBun();

describe('outbox cursor', () => {
  test('round-trips a position through the opaque string', () => {
    const position = { txid: '1042', seq: 7n };
    const decoded = decodeOutboxCursor(encodeOutboxCursor(position));
    assert({
      given: 'a position encoded to an opaque cursor',
      should: 'decode back to the same txid and seq',
      actual: decoded,
      expected: position,
    });
  });

  test('the origin cursor decodes from its own encoding', () => {
    const decoded = decodeOutboxCursor(encodeOutboxCursor(OUTBOX_ORIGIN));
    assert({
      given: 'the origin position',
      should: 'round-trip to txid "0" and seq 0n',
      actual: decoded,
      expected: OUTBOX_ORIGIN,
    });
  });

  test('refuses a cursor that is not shaped like an encoded position', () => {
    const attempts = ['', 'not-base64url-shaped!!', 'aGVsbG8', '1042.'].map(
      (value) => {
        try {
          decodeOutboxCursor(value);
          return 'accepted';
        } catch {
          return 'refused';
        }
      },
    );
    assert({
      given: 'empty text, garbage, and a malformed decoded body',
      should: 'refuse every one instead of returning a bogus position',
      actual: attempts,
      expected: attempts.map(() => 'refused'),
    });
  });

  test('refuses a non-string cursor', () => {
    const outcome = (() => {
      try {
        decodeOutboxCursor(42);
        return 'accepted';
      } catch {
        return 'refused';
      }
    })();
    assert({
      given: 'a cursor that is not a string',
      should: 'refuse it',
      actual: outcome,
      expected: 'refused',
    });
  });
});

describe('appendOutboxEvent input validation', () => {
  test('refuses a payload missing required shape before touching the database', async () => {
    let touched = false;
    const tx = {
      insert: () => {
        touched = true;
        throw new Error('should not be called');
      },
      execute: () => {
        touched = true;
        throw new Error('should not be called');
      },
    };
    const attempts = await Promise.all(
      [
        { topic: '', kind: 'k', version: 1, payload: {} },
        { topic: 't', kind: '', version: 1, payload: {} },
        { topic: 't', kind: 'k', version: 0, payload: {} },
        { topic: 't', kind: 'k', version: 1.5, payload: {} },
        { topic: 't', kind: 'k', version: 1, payload: {}, extra: 'nope' },
      ].map((input) =>
        // biome-ignore-next: exercising the runtime boundary with bad shapes
        appendOutboxEvent(tx as never, input as never)
          .then(() => 'accepted')
          .catch(() => 'refused'),
      ),
    );
    assert({
      given:
        'an empty topic/kind, a non-positive or fractional version, and an unknown field',
      should: 'refuse every one without inserting or notifying',
      actual: { attempts, touched },
      expected: {
        attempts: attempts.map(() => 'refused'),
        touched: false,
      },
    });
  });
});

describe('drainOutbox limit validation', () => {
  test('refuses a limit outside the bounded range', async () => {
    const db = { execute: () => Promise.reject(new Error('should not run')) };
    const attempts = await Promise.all(
      [0, -1, 1.5, 501].map((limit) =>
        drainOutbox(db as never, OUTBOX_ORIGIN, limit)
          .then(() => 'accepted')
          .catch(() => 'refused'),
      ),
    );
    assert({
      given: 'zero, negative, fractional and over-the-cap limits',
      should: 'refuse every one without querying',
      actual: attempts,
      expected: attempts.map(() => 'refused'),
    });
  });
});

describe('purgeExpiredOutboxEvents bounds validation', () => {
  test('refuses an invalid limit or cutoff instead of deleting unbounded', async () => {
    const db = { execute: () => Promise.reject(new Error('should not run')) };
    const results = await Promise.all(
      [
        { before: '2026-01-01T00:00:00.000Z', limit: 0 },
        { before: '2026-01-01T00:00:00.000Z', limit: 1.5 },
        { before: 'not a date', limit: 5 },
        { before: '2026-01-01T00:00:00.000Z', limit: 1001 },
      ].map((input) =>
        purgeExpiredOutboxEvents(db as never, input)
          .then(() => 'ran')
          .catch(() => 'refused'),
      ),
    );
    assert({
      given:
        'a zero limit, a fractional limit, an unparsable cutoff, and an over-the-cap limit',
      should: 'refuse each without touching the database',
      actual: results,
      expected: results.map(() => 'refused'),
    });
  });
});
