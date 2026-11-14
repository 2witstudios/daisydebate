import type {
  PairingPolicy,
  TournamentSetup,
} from '../../../features/tab/setup';
import type { TimelineRail } from '../../../features/tab/tournament';
import { Button } from '../../components/button/button';
import { PageHeader } from '../../components/page-header/page-header';
import { ChoiceField } from '../choice-field/choice-field';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { eyebrowClass, ListCard } from '../list-card/list-card';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';
import { SettingRow } from '../setting-row/setting-row';

/** How hard the engine tries, in the host's words. */
export const forceLabel = (policy: PairingPolicy): string => {
  switch (policy.force) {
    case 'rule':
      return 'Rule';
    case 'preference':
      return policy.rank === null ? 'Preference' : `Preference ${policy.rank}`;
    case 'warning':
      return 'Warning';
    case 'off':
      return 'Off';
  }
};

/**
 * Tournament setup: each setting once, from the one resolved-settings shape.
 * The pairing panel picks a preset; how strict each policy is comes with the
 * preset and is shown, not edited.
 */
export function Setup({
  rail,
  setup,
  panel,
  submit,
}: {
  readonly rail: TimelineRail;
  readonly setup: TournamentSetup;
  readonly panel: 'pairing' | null;
  readonly submit: SampleSubmit;
}) {
  const pairing = setup.pairing;
  return (
    <HostShell
      rail={rail}
      current="setup"
      {...(panel === null
        ? {}
        : {
            asideLabel: 'Pairing',
            aside: (
              <SampleForm
                action={submit(pairing.save.label)}
                label="Pairing"
                className="flex flex-col gap-4"
              >
                <h2 className="font-display text-xl font-bold">Pairing</h2>
                <ChoiceField id="pairing-preset" choice={pairing.preset} />
                <section
                  aria-label={`What ${pairing.preset.value} does`}
                  className="flex flex-col gap-2"
                >
                  <h3 className={eyebrowClass}>{pairing.preset.value}</h3>
                  <p className="text-sm">{pairing.summary}</p>
                  <dl className="flex flex-col gap-2">
                    {pairing.policies.map((policy) => (
                      <div
                        key={policy.key}
                        className="flex justify-between gap-3 text-sm"
                      >
                        <dt>{policy.label}</dt>
                        <dd className="font-strong">{forceLabel(policy)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <p className="text-sm text-ink-muted">
                  A rule is never broken by the draw. If the rules can&rsquo;t
                  all hold, you&rsquo;re told which ones clash. Preferences give
                  way in order. Warnings are only reported.
                </p>
                <p className="text-sm text-ink-muted">{pairing.forceNote}</p>
                <Button type="submit" className="self-start">
                  {pairing.save.label}
                </Button>
              </SampleForm>
            ),
          })}
    >
      <EventSwitcher event={setup.event} />
      <PageHeader title="Setup" lede={setup.lede} />
      <ListCard>
        <ul>
          {setup.settings.map((setting) => (
            <SettingRow
              key={setting.label}
              setting={setting}
              selected={
                panel === 'pairing' && setting.keys.includes('pairing.preset')
              }
            />
          ))}
        </ul>
      </ListCard>
    </HostShell>
  );
}
