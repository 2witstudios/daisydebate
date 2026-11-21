import type { ReactNode } from 'react';
import type { TabAction } from '../../../features/tab/action';
import { ActionButton } from '../action-control/action-control';
import type {
  PairingPolicy,
  TournamentSetup,
} from '../../../features/tab/setup';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { eyebrowClass, ListCard } from '../list-card/list-card';
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
type SetupProps = {
  readonly rail: TimelineRail;
  /** Video and judging under the settings: the hosting tier's switches (ADR 0149). */
  readonly hosted?: ReactNode;
} & (
  | {
      readonly empty: { readonly addEvent: TabAction | null };
      readonly setup?: never;
      readonly panel?: never;
      readonly pairingForm?: never;
    }
  | {
      readonly empty?: never;
      readonly setup: TournamentSetup;
      readonly panel: 'pairing' | null;
      readonly pairingForm: ReactNode;
    }
);
export function Setup(props: SetupProps) {
  if (props.empty !== undefined)
    return (
      <HostShell rail={props.rail} current="setup">
        <PageHeader title="Setup" lede={props.rail.title} />
        <ListCard>
          <section className="flex flex-col items-start gap-3 p-4">
            <p>No events yet.</p>
            {props.empty.addEvent === null ? null : (
              <ActionButton action={props.empty.addEvent} />
            )}
          </section>
        </ListCard>
      </HostShell>
    );
  const { rail, setup, panel } = props;
  return (
    <HostShell
      rail={rail}
      current="setup"
      {...(panel === null
        ? {}
        : {
            asideLabel: 'Pairing',
            aside: props.pairingForm,
          })}
    >
      <EventSwitcher event={setup.event} />
      <PageHeader title="Setup" lede={setup.lede} />
      <ListCard>
        <ul>
          {setup.settings.map((setting) => (
            <SettingRow
              key={setting.id ?? setting.keys.join('|')}
              setting={setting}
              selected={
                panel === 'pairing' && setting.keys.includes('pairing.preset')
              }
            />
          ))}
        </ul>
      </ListCard>
      {props.hosted}
    </HostShell>
  );
}

export function PairingPolicies({
  pairing,
}: {
  readonly pairing: TournamentSetup['pairing'];
}) {
  return (
    <>
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
        A rule is never broken by the draw. If the rules can&rsquo;t all hold,
        you&rsquo;re told which ones clash. Preferences give way in order.
        Warnings are only reported.
      </p>
      <p className="text-sm text-ink-muted">{pairing.forceNote}</p>
    </>
  );
}
