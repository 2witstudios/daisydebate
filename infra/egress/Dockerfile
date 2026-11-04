# Staging Egress (ISSUE-1303): the pinned image, plus one throwaway Chrome launch at boot.
# Built from the repository root, like infra/livekit.
FROM livekit/egress:v1.15.0
COPY infra/egress/warm-entrypoint.sh /warm-entrypoint.sh
ENTRYPOINT ["/tini", "--", "/bin/bash", "/warm-entrypoint.sh"]
