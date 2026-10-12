# Pull the published image (linux/amd64 and linux/arm64):
#   docker pull ghcr.io/rinai-r/kivotos-relay:latest
# or build it from this directory:
#   docker build -t kivotos-relay --build-arg VERSION=$(git describe --tags --always) .
#
# Run, keeping the registry and the admin socket in a volume. The relay serves
# plain HTTP on 7443 (WebSocket at /v1/connect, health at /healthz); put a
# reverse proxy with TLS in front and set KIVOTOS_RELAY_BEHIND_PROXY=true.
#   docker run -d --name kivotos-relay -p 127.0.0.1:7443:7443 \
#     -e KIVOTOS_RELAY_BEHIND_PROXY=true -v kivotos-relay:/data \
#     ghcr.io/rinai-r/kivotos-relay:latest
#
# Register a network through the running container, with the registration
# Kivotos shows the computer that created the network:
#   docker exec kivotos-relay kivotos-relay network add <registration> --name home

# The compiler runs on the build machine and cross-compiles for the target
# platform, so a multi-platform build never emulates Go.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
WORKDIR /src
# Dependencies first, so editing sources does not download them again.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
      -ldflags "-s -w -X github.com/Rinai-R/kivotos/packages/relay/cmd.version=${VERSION}" \
      -o /out/kivotos-relay .

FROM alpine:3.22
# An unprivileged user owns /data; a new volume mounted there inherits that owner.
RUN adduser -D -H -u 10001 relay && mkdir /data && chown relay:relay /data
COPY --from=build /out/kivotos-relay /usr/local/bin/kivotos-relay
USER relay
ENV KIVOTOS_RELAY_DATA_DIR=/data
VOLUME /data
EXPOSE 7443
ENTRYPOINT ["kivotos-relay"]
CMD ["serve"]
