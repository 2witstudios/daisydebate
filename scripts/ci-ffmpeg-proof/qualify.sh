#!/bin/sh
# Invoke from the repository root via bun scripts/heavy.ts.
set -eu
candidate=$(git rev-parse HEAD)
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo 'Commit the exact candidate before qualification' >&2
  exit 1
fi
proof_dir=${FFMPEG_PROOF_DIR:-/tmp/daisy-ffmpeg-proof-$candidate}
mkdir -p "$proof_dir/source"
git archive "$candidate" | tar -x -C "$proof_dir/source"
docker build --platform linux/amd64 -t daisy-ffmpeg-proof:issue1356 -f scripts/ci-ffmpeg-proof/Dockerfile scripts/ci-ffmpeg-proof > "$proof_dir/image-build.log" 2>&1
docker image inspect daisy-ffmpeg-proof:issue1356 > "$proof_dir/image.json"
git ls-files scripts/ci-ffmpeg.ts scripts/ci-ffmpeg.test.ts scripts/ci-ffmpeg-proof .github/workflows/ci.yml | while IFS= read -r file; do shasum -a 256 "$file"; done > "$proof_dir/source-manifest.sha256"
for scenario in cold slow-first slow-progress install-stall apt-error missing-archive signature ffmpeg-fail ffprobe-fail ffmpeg-hang ffprobe-hang leader-group cancel-term cancel-int cleanup-unproven launch-error negative-leader-only; do
  mkdir -p "$proof_dir/$scenario"
  echo "QUALIFY $candidate $scenario"
  status=0
  docker run --rm --platform linux/amd64 --init --cap-add SYS_PTRACE --security-opt seccomp=unconfined \
    -e CANDIDATE_SHA="$candidate" -v "$proof_dir/source:/candidate:ro" -v "$proof_dir/$scenario:/evidence" \
    daisy-ffmpeg-proof:issue1356 "$scenario" > "$proof_dir/$scenario.log" 2>&1 || status=$?
  echo "$scenario exit $status"
  if [ "$status" -ne 0 ]; then echo "Original failure: $proof_dir/$scenario.log" >&2; exit "$status"; fi
done
echo "Evidence: $proof_dir"
