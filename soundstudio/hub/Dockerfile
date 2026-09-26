# SoundStudio audio hub: open-source JackTrip hub server (MIT) built with
# browser transports (WebRTC data channels + WebTransport), a headless JACK
# server, and the SoundStudio room patcher.
#
# Build:  docker build -t soundstudio-hub soundstudio/hub   (first build ~10 min)
# Run:    see docker-compose.yml

# Ubuntu 26.04 LTS: its OpenSSL 3.5 is what the bundled msquic (WebTransport) build needs.
ARG UBUNTU_IMAGE=mirror.gcr.io/library/ubuntu:26.04

FROM ${UBUNTU_IMAGE} AS builder
ARG JACKTRIP_REF=v3.0.1
# BUILDTYPE=debugoptimized STRIP=0 gives a binary with symbols, for crash debugging.
ARG BUILDTYPE=release
ARG STRIP=1
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake git meson ninja-build pkg-config python3 python3-yaml python3-jinja2 \
      qt6-base-dev libjack-jackd2-dev libssl-dev libsamplerate0-dev \
    && rm -rf /var/lib/apt/lists/*
# Optional build secret "ca": an extra CA bundle, only for building behind a
# TLS-intercepting proxy (docker build --secret id=ca,src=/path/to/ca.pem).
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export GIT_SSL_CAINFO=/run/secrets/ca; fi; \
    git clone --depth 1 --branch ${JACKTRIP_REF} https://github.com/jacktrip/jacktrip.git /src
WORKDIR /src
# Small SoundStudio fixes to JackTrip, kept as reviewable patch files.
COPY patches /patches
RUN git apply /patches/*.patch
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export SSL_CERT_FILE=/run/secrets/ca; fi; \
    meson setup builddir --buildtype ${BUILDTYPE} \
      -Dnogui=true -Dnovs=true -Dnoclassic=true -Dnoupdater=true -Dnofeedback=true \
      -Drtaudio=disabled -Djack=enabled \
      -Dlibdatachannel=enabled -Dmsquic=enabled \
    && meson compile -C builddir \
    && if [ "$STRIP" = 1 ]; then strip builddir/jacktrip; fi \
    && ./builddir/jacktrip --version

FROM ${UBUNTU_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      jackd2 jack-example-tools libqt6core6t64 libqt6network6 libsamplerate0 libssl3t64 \
      python3 python3-jack-client tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 10001 -G audio -m -s /usr/sbin/nologin hub
COPY --from=builder /src/builddir/jacktrip /usr/local/bin/jacktrip
COPY --from=builder /src/LICENSE.md /usr/share/doc/jacktrip/LICENSE.md
COPY patcher/patcher.py /usr/local/bin/ss-patcher
COPY entrypoint.sh /usr/local/bin/ss-hub
RUN chmod 755 /usr/local/bin/ss-patcher /usr/local/bin/ss-hub
USER hub
ENV JACK_NO_AUDIO_RESERVATION=1 JACK_NO_START_SERVER=1 LC_ALL=C.UTF-8
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/ss-hub"]
