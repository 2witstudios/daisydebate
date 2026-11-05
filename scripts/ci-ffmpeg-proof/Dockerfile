# Only the proof image installs observer tooling; candidate apt starts cold.
FROM oven/bun:1.4.2 AS bun
FROM ubuntu:24.04
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends python3 sudo procps strace ca-certificates \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb \
    && touch /disposable-ffmpeg-proof
WORKDIR /candidate
ENTRYPOINT ["python3", "/candidate/scripts/ci-ffmpeg-proof/run.py"]
