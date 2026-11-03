import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLaunchCertificates } from './launch-certificates';

/**
 * A stand-in public bucket on its own origin, answering as staging's does: GET
 * and HEAD for any origin, media only under `live/<id>/`. The media is open-codec
 * fMP4 because Playwright's Chromium ships no H.264; real Chrome on staging is
 * what proved H.264 (BCAST-1), and this proves page, policy and lifecycle.
 */
const FIXTURE = join(import.meta.dirname, 'broadcast-feed-fixture');
const SEGMENTS = 4;
const TYPES = {
  m3u8: 'application/vnd.apple.mpegurl',
  mp4: 'video/mp4',
  m4s: 'video/iso.segment',
};

const master = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=120000,RESOLUTION=426x240,CODECS="vp09.00.10.08,opus"',
  '240/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=240000,RESOLUTION=854x480,CODECS="vp09.00.30.08,opus"',
  '480/index.m3u8',
  '',
].join('\n');

/** A live playlist cycling the fixture's seconds; once finished, it says so and stops. */
const mediaPlaylist = (uptimeMs: number, finished: boolean) => {
  // Counted from this server's start, as a real feed counts from its first segment.
  const newest = Math.floor(uptimeMs / 1000) + SEGMENTS;
  const sequence = Math.max(0, newest - 5);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:1',
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(sequence / SEGMENTS)}`,
    '#EXT-X-MAP:URI="init.mp4"',
  ];
  for (let at = sequence; at <= newest; at += 1) {
    if (at !== sequence && at % SEGMENTS === 0)
      lines.push('#EXT-X-DISCONTINUITY', '#EXT-X-MAP:URI="init.mp4"');
    lines.push('#EXTINF:1.000000,', `seg-${at % SEGMENTS}.m4s`);
  }
  if (finished) lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
};

const PATH =
  /^\/live\/([^/]+)\/(?:(master\.m3u8)|(240|480)\/(index\.m3u8|init\.mp4|seg-[0-3]\.m4s))$/;

/** A finished video, as the worker leaves it: a real VOD playlist that says it ended. */
const vodPlaylist = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-TARGETDURATION:1',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXT-X-MAP:URI="init.mp4"',
  ...Array.from({ length: SEGMENTS * 2 }, (_, at) => [
    ...(at === SEGMENTS
      ? ['#EXT-X-DISCONTINUITY', '#EXT-X-MAP:URI="init.mp4"']
      : []),
    '#EXTINF:1.000000,',
    `seg-${at % SEGMENTS}.m4s`,
  ]).flat(),
  '#EXT-X-ENDLIST',
  '',
].join('\n');

const RECORDING =
  /^\/recordings-e2e\/recordings\/[^/]+\/hls\/(?:(master\.m3u8)|(240|480)\/(index\.m3u8|init\.mp4|seg-[0-3]\.m4s))$/;

/** The private Recording bucket's stand-in, addressed path-style as a signed read is. */
const recordingObject = (pathname: string) => {
  const match = RECORDING.exec(pathname);
  if (!match) return null;
  const [, isMaster, rendition, file] = match;
  if (isMaster) return { body: master, type: TYPES.m3u8 };
  if (file === 'index.m3u8') return { body: vodPlaylist, type: TYPES.m3u8 };
  return {
    body: readFileSync(join(FIXTURE, rendition ?? '', file ?? '')),
    type: file?.endsWith('.mp4') ? TYPES.mp4 : TYPES.m4s,
  };
};

/**
 * Runs beside the suite's server, in its Bun process. `/__control` is the
 * spec's way to read what was asked for and to end a feed; a real bucket has
 * neither, and the page never calls them.
 */
export const startBroadcastFeedServer = (port: number) => {
  const certificates = createLaunchCertificates();
  const tls = {
    key: readFileSync(certificates.key),
    cert: readFileSync(certificates.cert),
  };
  certificates.close();
  const startedAt = performance.now();
  const finished = new Set<string>();
  const requested: string[] = [];
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    tls,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/__control/requested') return Response.json(requested);
      if (pathname.startsWith('/__control/finish/')) {
        finished.add(pathname.split('/')[3] ?? '');
        return new Response(null, { status: 204 });
      }
      requested.push(pathname);
      const cors = { 'Access-Control-Allow-Origin': '*' };
      const stored = recordingObject(pathname);
      if (stored)
        return new Response(stored.body, {
          headers: { ...cors, 'Content-Type': stored.type },
        });
      const match = PATH.exec(pathname);
      if (!match) return new Response(null, { status: 404, headers: cors });
      const [, id, isMaster, rendition, file] = match;
      if (isMaster)
        return new Response(master, {
          headers: { ...cors, 'Content-Type': TYPES.m3u8 },
        });
      if (file === 'index.m3u8')
        return new Response(
          mediaPlaylist(performance.now() - startedAt, finished.has(id ?? '')),
          {
            headers: {
              ...cors,
              'Content-Type': TYPES.m3u8,
              'Cache-Control': 'no-store',
            },
          },
        );
      return new Response(
        readFileSync(join(FIXTURE, rendition ?? '', file ?? '')),
        {
          headers: {
            ...cors,
            'Content-Type': file?.endsWith('.mp4') ? TYPES.mp4 : TYPES.m4s,
          },
        },
      );
    },
  });
};
