import { assert, setupRitewayBun, test } from 'riteway/bun';
import { daisyWinnerBallot } from '../ballot-definition';
import { lobbySetupCommandSchema } from './lobby-setup-command';
setupRitewayBun();
test('ballot authoring accepts the canonical body and refuses incomplete competing settings', () => {
  const body = {
    decision: daisyWinnerBallot.decision,
    points: daisyWinnerBallot.points,
    speakerRanks: daisyWinnerBallot.speakerRanks,
    written: daisyWinnerBallot.written,
  };
  const command = {
    type: 'define-ballot',
    lobbyId: 'l'.repeat(24),
    ballotDefinition: { kind: 'new', name: 'Canonical authored ballot' },
    settings: body,
  };
  assert({
    given:
      'complete decision/subjects/defaults/criteria guidance and written bounds, versus old partial settings or private notes',
    should:
      'accept only the canonical authoring body without client identity/version',
    actual: [
      lobbySetupCommandSchema.safeParse(command).success,
      lobbySetupCommandSchema.safeParse({
        ...command,
        settings: { ...body, key: 'client-choice', revision: 9 },
      }).success,
      lobbySetupCommandSchema.safeParse({
        ...command,
        settings: {
          points: { min: 20, max: 30, step: 0.5, lowPointWin: false },
          ranks: false,
          criteria: [],
          outcomes: { winner: true, doubleLoss: false },
          written: {
            reason: 'required',
            feedback: 'optional',
            privateNote: 'off',
          },
        },
      }).success,
      lobbySetupCommandSchema.safeParse({
        ...command,
        settings: {
          ...body,
          written: { ...body.written, privateNote: 'optional' },
        },
      }).success,
    ],
    expected: [true, false, false, false],
  });
});
