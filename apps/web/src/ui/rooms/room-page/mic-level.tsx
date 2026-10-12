'use client';

import { useEffect, useState } from 'react';

const BAR_COUNT = 5;
const BAR_STEP = 0.04;
const SILENCE = 0.005;
const heights = ['h-2', 'h-3', 'h-5', 'h-4', 'h-2'] as const;

/** Lit bars for a root-mean-square sample level. */
export function micBars(rms: number): number {
  if (rms <= SILENCE) return 0;
  return Math.min(BAR_COUNT, Math.ceil(rms / BAR_STEP));
}

/** Reads the checked microphone's local preview; never connects to speakers or a transport. */
export function MicLevel({ stream }: { readonly stream: MediaStream | null }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!stream) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      setLit(
        micBars(
          Math.sqrt(
            samples.reduce((sum, sample) => sum + sample * sample, 0) /
              samples.length,
          ),
        ),
      );
    }, 100);
    void context.resume().catch(() => {});
    return () => {
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => {});
      setLit(0);
    };
  }, [stream]);
  return (
    <span aria-hidden="true" className="flex h-6 items-end gap-1">
      {heights.map((height, index) => (
        <span
          key={index}
          className={`w-1 rounded-full ${height} ${index < lit ? 'bg-hue-teal' : 'bg-border-strong'}`}
        />
      ))}
    </span>
  );
}
