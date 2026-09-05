# syntax=docker/dockerfile:1.6

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
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (cache npm)
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Copy application code, already owned by the node user.
#
# `RUN chown -R node:node /src` at the end of the build walks every file under /src, including
# node_modules and the compiled mediasoup worker, and on overlayfs that duplicates the whole
# tree into a new layer. `--chown` on the COPY does the same job for free and adds no layer.
#
# node_modules stays owned by root and world-readable, which is the usual arrangement: the app
# only reads from it. The recordings directory is created by the app at runtime under its own
# uid, or bind-mounted by the operator.
COPY --chown=node:node app ./app
COPY --chown=node:node public ./public

# Copy config template → config
COPY --chown=node:node app/src/config.template.js app/src/config.js

# Run as the non-root "node" user (uid/gid 1000) shipped with the base image
USER node

# Default command
CMD ["npm", "start"]