# RTMP Streaming

![rtmpStreaming](../rtmpStreaming.jpeg)

For running an `RTMP` (Real-Time Messaging Protocol) server in Docker, **Nginx with the RTMP module** is one of the best options. It is widely used for streaming video content due to its high performance and flexibility.

## Setting up Nginx with RTMP in Docker

```sh
# Copy the docker.compose.yml
$ cp docker-compose.template.yml docker-compose.yml

# Pull the official mirotalk rtmp image
$ docker pull mirotalk/rtmp:latest

# Create and start containers
$ docker-compose up -d

# Check the logs
$ docker logs -f mirotalk-rtmp

# To stop and remove resources
$ docker-compose down
```

## Custom Configuration

Modify the `nginx.conf` to suit your specific needs, such as enabling recording, adding authentication, or configuring HLS (HTTP Live Streaming).

By using Nginx with the RTMP module in Docker, you can quickly and easily set up a robust RTMP server for live video streaming.
