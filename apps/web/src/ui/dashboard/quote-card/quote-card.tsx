import Image from 'next/image';
import { art } from '../../assets';

export function QuoteCard() {
  return (
    <figure className="relative isolate flex min-h-quote-card-min flex-col justify-end gap-1 overflow-hidden rounded-xl p-6">
      <Image
        src={art.quoteRidge.src}
        alt=""
        fill
        sizes="316px"
        className="-z-2 object-cover object-quote-photo brightness-50 saturate-80"
      />
      <span
        className="absolute inset-0 -z-1 bg-linear-to-t/srgb from-scrim/88 from-30% to-scrim/25 to-75%"
        aria-hidden="true"
      />
      <span
        className="block font-display text-quote-mark leading-quote-mark text-accent"
        aria-hidden="true"
      >
        &ldquo;
      </span>
      <blockquote className="font-display text-base leading-quote-body font-book text-ink-on-media/92 italic">
        Ideas move people.
        <br />
        Debate changes them.
      </blockquote>
    </figure>
  );
}
