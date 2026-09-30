# Jenkins with a modern Docker CLI (+ buildx) so pipelines can build/push images
# using the host's Docker Engine via the mounted /var/run/docker.sock.
# Debian's docker.io package is too old for Docker Engine 25+ (API version error).
FROM jenkins/jenkins:lts-jdk17

USER root
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

# Practice setup: run as root so the mounted docker.sock is usable without group fiddling.
# Do NOT do this in production.
USER root
