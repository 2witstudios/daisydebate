# Staging LiveKit server (ISSUE-528, DEC-228): the pinned image infra/compose.yaml
# runs locally, plus an entrypoint that writes the config at boot. Fly
# delivers public UDP only to a socket bound to the fly-global-services
# address, which is only known on the machine, so the config cannot be baked. Built from the repository root (fly.livekit.toml).
FROM livekit/livekit-server:v1.13.7
COPY infra/livekit/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
