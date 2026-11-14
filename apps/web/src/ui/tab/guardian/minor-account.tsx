import Link from 'next/link';
import type { MinorAccount as Read } from '../../../features/tab/guardian';
import { Button } from '../../components/button/button';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ActionLink } from '../action-control/action-control';
import { eyebrowClass, ListCard } from '../list-card/list-card';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';

const optionClass =
  'flex cursor-pointer items-start gap-3 border-b border-border px-4 py-3 last:border-b-0';

/**
 * A minor's account as their guardian manages it: the lobbies the minor may
 * see and join, which is the one fact everything else follows from.
 */
export function MinorAccount({
  account,
  submit,
}: {
  readonly account: Read;
  readonly submit: SampleSubmit;
}) {
  return (
    <ReadingPage>
      <Link
        href={account.back.href}
        className="self-start font-strong text-ink underline"
      >
        {account.back.label}
      </Link>
      <PageHeader title={account.name} lede={account.lede} />
      <SampleForm
        action={submit(account.save.label)}
        label={account.name}
        className="flex flex-col gap-5"
      >
        <ListCard>
          <fieldset>
            <legend
              className={`w-full border-b border-border bg-surface px-4 py-2 ${eyebrowClass}`}
            >
              {account.lobbiesLegend}
            </legend>
            {account.lobbies.map((lobby) => (
              <label key={lobby.name} className={optionClass}>
                <input
                  type="checkbox"
                  name="lobby"
                  value={lobby.name}
                  defaultChecked={lobby.allowed}
                  className="mt-1 accent-accent"
                />
                <span className="flex flex-col">
                  <strong className="font-strong">{lobby.name}</strong>
                  {lobby.detail === null ? null : (
                    <span className="text-sm text-ink-muted">
                      {lobby.detail}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        </ListCard>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-strong">
            {account.recordings.legend}
          </legend>
          {account.recordings.options.map((option, index) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-3"
            >
              <input
                type="radio"
                name="recordings"
                value={option}
                defaultChecked={index === account.recordings.chosen}
                className="accent-accent"
              />
              {option}
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-ink-muted">{account.boundary}</p>
        <Button type="submit">{account.save.label}</Button>
      </SampleForm>
      <ActionLink action={account.withdraw} className="self-center" />
    </ReadingPage>
  );
}
