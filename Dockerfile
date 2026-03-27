# syntax=docker/dockerfile:1.6

# Use Node.js 22 LTS slim image as base
FROM node:22-slim

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

# Copy application code
COPY app ./app
COPY public ./public

# Copy config template → config
COPY app/src/config.template.js app/src/config.js

# Default command
CMD ["npm", "start"]