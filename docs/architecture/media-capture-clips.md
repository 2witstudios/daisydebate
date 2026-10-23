# Bounded capture clips

`@daisy/media/clips` exports `cutCaptureClips`. VIDEO-3.7 and VIDEO-3.8 own
its worker reader. The function consumes a bounded batch of already calibrated
16 kHz mono signed PCM frames, committed actual segment/seat intervals and a
trusted database-clock horizon. It does not calibrate raw callbacks, infer floor
rights, discover a session, call STT or establish a complete capture stream.

Each frame contains exactly 160 samples, a track identifier, an integer
`nominalStartMs` observation offset and a full outward integer millisecond
`beforeMs`/`afterMs` uncertainty bracket. Nominal time labels sample offsets;
authorization always requires the entire bracket inside one actual nonempty
speaking grant and the segment's actual/scheduled end, exclusive. The upper bound
must not exceed `serverNowMs`. The producer must supply calibrated brackets and
fresh committed history; this function cannot make an unbounded raw receive
callback into an authoritative timestamp. Before STT dispatch, the worker must
refresh and revalidate admission/history and cancel on lost authority.

Rejected uncertain frames are dropped before WAV encoding and reported as gaps.
Different grants, segments, tracks, repeated/overlapping nominal samples and
noncontiguous sample positions split clips. A rejected frame never joins two
otherwise admitted spans. Empty or non-speaking history emits no clips. No
completeness flag or coverage observation is synthesized from the outer window.

Clips contain at most 60,000ms. At that limit, the latest low-energy frame ending
in the final 5,000ms is preferred; low energy is an observed PCM RMS at most
64 signed sample units. This cut heuristic neither grants eligibility nor proves
silence coverage. With no such frame, the hard sixty-second boundary is used.
Input is capped at 12,000 ten-millisecond frames (two minutes); the worker still
owns its independent queue, timeout and memory bounds. A WAV is at most
1,920,044 bytes before base64 encoding. PCM, WAV and transcription requests remain
in memory, never files or logs.

Each output carries actual Round/segment/seat/track labels, offset, duration and
full uncertainty bracket. Its SHA3-256 clip key uses the same five-element
Round/segment/seat/track/start-offset tuple as durable captured-transcript ingress.
The database still independently rechecks lease, history, cutoff, freeze and
conflicting retries. A valid local clip does not authorize a durable append.

WAV encoding follows Microsoft's
[RIFF specification](https://learn.microsoft.com/en-us/windows/win32/xaudio2/resource-interchange-file-format--riff-)
and [PCM writing example](https://learn.microsoft.com/en-us/windows/win32/medfound/tutorial--decoding-audio):
RIFF/WAVE, a sixteen-byte PCM format chunk, mono 16kHz, sixteen-bit little-endian
signed sample data, no metadata chunks. No additional dependency is introduced.
Unit fixtures prove boundaries and encoded bytes; actual native calibration,
configured provider STT and worker composition remain separate service obligations.

## Native observation cadence

`@daisy/media/observation` exports `createCaptureClock` for one native track. It
consumes the original sequence and copy brackets from
`createCaptureSubscription`; the caller retains their associated 160-sample
PCM. Gaps are decided by frame sequence, never by clock (DEC-215): contiguous
sequence numbers advance `nominalStartMs` exactly 10 ms whatever their arrival
timing (bursts, stalls and jitter included), and each missing sequence number
is exactly a 10 ms gap. Track closure destroys its clock.

The calibration only maps each contiguous run onto server time, once, at its
first frame, whose 10 ms period ends at its callback. The track's first run
takes its nominal start from that mapping; every later run continues the
track's sequence, so no calibration shift can shrink or close a gap
(ISSUE-466-r6). A counter that goes backwards on the same track is a new
native stream: its run is placed by the calibration, at least one frame after
the last, never contiguously (ISSUE-466-r7). A refresh never moves a running
run. The common bounds cover
both calibration endpoints, sample quantization and 100 ppm drift; a run maps
only under an RTT of at most 100 ms and a calibration at most 30 s old, and a
frame refused for an unusable calibration is a gap. Each frame's bracket is the
run's mapping advanced by its sequence and widened by drift, joined with its
nominal span, so it always contains that span and the server's frame-bracket
rule holds at any round trip (ISSUE-466-r5). A rejected callback is never
replayed. No raw sample total is coverage.
Outward integer rounding and full committed history containment remain mandatory
before clip encoding or durable append. The possible window is never itself a
guaranteed coverage observation. Acoustic time and network transit are not
claimed (ADR 0053 section 8).

The real Bun/LiveKit/PostgreSQL probe retains at least ten genuine nonzero 16 kHz
frames from the first callback on its sequence timeline, refreshes actual database calibration and checks every
full outward window against durable speaking history. Its source is synthetic
PCM; it proves observation cadence and the historical read seam, not human STT,
complete stream coverage or an accepted worker deployment. Unit negative controls
remove sequence and burst guards separately and must fail before restored GREEN.
