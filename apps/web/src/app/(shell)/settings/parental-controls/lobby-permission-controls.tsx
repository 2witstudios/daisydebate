import type { GuardiansStore } from '@daisy/db/stores/guardians';
import { contentWaiverDocument } from '../../../../features/legal/agreements';
import { controlClass } from '../../../../ui/components/form-field/form-field-class';
import { GuardianForm } from '../../../../ui/settings/parental-controls/guardian-form';
import { lobbyPermissionAction } from './lobby-permission-action';

type LobbyPermissions = Awaited<
  ReturnType<GuardiansStore['lobbyPermissions']['read']>
>;

export function LobbyPermissionControls({
  role,
  linkId,
  permissions,
}: {
  readonly role: 'adult' | 'child';
  readonly linkId: string;
  readonly permissions: LobbyPermissions;
}) {
  const { requests, choices } = permissions;
  const options = choices.filter(
    ({ id }) =>
      !requests.some(
        (request) => request.lobbyId === id && request.linkId === linkId,
      ),
  );
  const requestsForLink = requests.filter(
    (request) => request.linkId === linkId,
  );
  const waiver = contentWaiverDocument;
  return (
    <>
      {requestsForLink.map(
        ({ lobbyId, signedAt, hasActiveSeason, rankedWaiverSigned }) => {
          const lobby = choices.find(({ id }) => id === lobbyId);
          if (!lobby) return null;
          const needsRenewal = Boolean(
            signedAt && hasActiveSeason && !rankedWaiverSigned,
          );
          return (
            <div key={lobbyId} className="flex flex-col gap-2 text-sm text-ink">
              <p>
                {lobby.name} · {lobby.league} —{' '}
                {signedAt ? 'Allowed' : 'Waiting for approval'}
              </p>
              {needsRenewal ? (
                <p>
                  The guardian must sign the current ranked waiver before ranked
                  play.
                </p>
              ) : null}
              {role === 'adult' && (!signedAt || needsRenewal) ? (
                <GuardianForm
                  action={lobbyPermissionAction.bind(null, 'sign', linkId)}
                  label={
                    needsRenewal
                      ? `Sign current waiver for ${lobby.name}`
                      : `Sign waiver and allow ${lobby.name}`
                  }
                >
                  <input type="hidden" name="lobbyId" value={lobby.id} />
                  <input
                    type="hidden"
                    name="noticeVersion"
                    value={waiver.version}
                  />
                  <details className="text-sm text-ink">
                    <summary className="cursor-pointer font-semibold">
                      {waiver.title} ({waiver.version})
                    </summary>
                    <div className="flex flex-col gap-3 py-3">
                      <p>{waiver.lede}</p>
                      {waiver.sections.map((section) => (
                        <div key={section.id} className="flex flex-col gap-1">
                          <h4 className="font-semibold">{section.heading}</h4>
                          {section.paragraphs.map((paragraph) => (
                            <p key={paragraph}>{paragraph}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <input
                      name="agree"
                      type="checkbox"
                      value="yes"
                      required
                      className="mt-1 accent-accent"
                    />
                    I sign this waiver for my child and allow them to play in{' '}
                    {lobby.name}.
                  </label>
                </GuardianForm>
              ) : null}
            </div>
          );
        },
      )}
      {role === 'child' && options.length > 0 ? (
        <GuardianForm
          action={lobbyPermissionAction.bind(null, 'request', linkId)}
          label="Ask to play"
        >
          <label className="flex flex-col gap-1 text-sm text-ink">
            Adult lobby
            <select
              name="lobbyId"
              required
              className={controlClass}
              defaultValue=""
            >
              <option disabled value="">
                Choose a lobby
              </option>
              {options.map((lobby) => (
                <option key={lobby.id} value={lobby.id}>
                  {lobby.name} · {lobby.league}
                </option>
              ))}
            </select>
          </label>
        </GuardianForm>
      ) : null}
    </>
  );
}
