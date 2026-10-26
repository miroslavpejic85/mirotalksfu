# syntax=docker/dockerfile:1.6

# Pinned, statically-linked FFmpeg (multi-arch, no shared-lib deps).
# FFmpeg >= 9.0 contains the vobsub subtitle demuxer stream-count bounds fix
# (FFmpeg commit dbd495f066a85ba96b17433f4306582aa37c3951). Debian bookworm's apt
# ffmpeg (5.1.9) is still vulnerable to that heap buffer overflow and has no backport,
# so we ship a fixed static build instead of installing ffmpeg from apt.
FROM mwader/static-ffmpeg:9.0.2 AS ffmpeg

# Use Node.js 24 LTS slim image as base
FROM node:24-slim

# Set working directory
WORKDIR /src

# Environment
ENV NODE_ENV=production
ENV MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=true

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install the fixed, statically-linked FFmpeg/ffprobe over the paths the app resolves
# (config default /usr/bin/ffmpeg and bare `ffmpeg` on PATH).
COPY --from=ffmpeg /ffmpeg /usr/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/bin/ffprobe

# Install dependencies (cache npm)
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Avoid recursive chown, which duplicates /src into a costly overlayfs layer.
# Dependencies remain root-owned and readable; application files are owned by node.
COPY --chown=node:node app ./app
COPY --chown=node:node public ./public

# Copy config template → config
COPY --chown=node:node app/src/config.template.js app/src/config.js

# Run as the non-root "node" user (uid/gid 1000) shipped with the base image
USER node

# Default command
CMD ["npm", "start"]