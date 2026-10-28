'use client';
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';

const units = new Intl.NumberFormat('en-US');

/**
 * DEC-124: the server counts UTF-16 code units (a supplementary character is
 * two), so the field counts `string.length` too.
 */
export function characterCountText(count: number, maxUnits: number) {
  const over = count - maxUnits;
  return {
    count: `${units.format(count)} / ${units.format(maxUnits)} characters`,
    over:
      over > 0
        ? `${units.format(over)} ${over === 1 ? 'character' : 'characters'} over the limit. Shorten it to send.`
        : null,
  };
}

/**
 * A text field with a visible count instead of `maxLength`, which would
 * silently cut a paste. Over the limit, native validation blocks the submit
 * with the same words; without JavaScript the server refuses and keeps it.
 */
export function CountedTextarea({
  id,
  maxUnits,
  defaultValue,
  describedBy,
  onInput,
  ...field
}: Omit<
  ComponentPropsWithoutRef<'textarea'>,
  'id' | 'defaultValue' | 'maxLength' | 'aria-describedby'
> & {
  readonly id: string;
  readonly maxUnits: number;
  readonly defaultValue: string;
  readonly describedBy?: string | undefined;
}) {
  const [count, setCount] = useState(defaultValue.length);
  const text = characterCountText(count, maxUnits);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.setCustomValidity(text.over ?? '');
  }, [text.over]);
  return (
    <>
      <textarea
        {...field}
        ref={ref}
        id={id}
        defaultValue={defaultValue}
        aria-invalid={text.over ? true : undefined}
        aria-describedby={[
          describedBy,
          `${id}-count`,
          text.over ? `${id}-over` : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        onInput={(event) => {
          setCount(event.currentTarget.value.length);
          onInput?.(event);
        }}
      />
      <p className="flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
        <span
          id={`${id}-over`}
          aria-live="polite"
          className="font-semibold text-ink"
        >
          {text.over}
        </span>
        <span
          id={`${id}-count`}
          className={text.over ? 'font-semibold text-ink' : undefined}
        >
          {text.count}
        </span>
      </p>
    </>
  );
}
