import type { ReactNode } from 'react';
import { cardClass, chipClass } from './choice-class';

type ChipOption = { readonly value: string; readonly label: string };

export type ChipsProps = {
  readonly name: string;
  readonly legend: string;
  readonly value: string;
  readonly options: readonly ChipOption[];
};

/** Radios as chips: real inputs, so the form carries the choice. */
export function Chips({ name, legend, value, options }: ChipsProps) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={chipClass}>
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={value === option.value}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

type CardOption = {
  readonly value: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
};

export type CardsProps = {
  readonly name: string;
  readonly legend: string;
  readonly value: string;
  readonly options: readonly CardOption[];
};

/** Radios as cards with a title and a line of words. */
export function Cards({ name, legend, value, options }: CardsProps) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={cardClass}>
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={value === option.value}
            className="sr-only"
          />
          {option.icon}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-strong">{option.title}</span>
            {option.description ? (
              <span className="text-sm text-ink-muted">
                {option.description}
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
