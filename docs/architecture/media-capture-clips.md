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
