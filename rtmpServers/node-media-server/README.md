# RTMP Streaming

![rtmpStreaming](../rtmpStreaming.jpeg)

For running an `RTMP` (Real-Time Messaging Protocol) server in Node, **[Node-Media-Server](https://github.com/illuspas/Node-Media-Server)** is one of the best options.

## Quick Start

```sh
# Create the config file for the server
$ cp config.template.js config.js
# Install the dependencies
$ npm install
# Start the RTMP Server
$ npm start
```

## Using Docker

```sh
# Create the config file for the server
$ cp config.template.js config.js

# Copy the docker.compose.yml
$ cp docker-compose.template.yml docker-compose.yml

# Pull the official mirotalk rtmp image
$ docker pull mirotalk/nms:latest

# Create and start containers
$ docker-compose up -d

# Check the logs
$ docker logs -f mirotalk-nms

# To stop and remove resources
$ docker-compose down
```

## Dashboard & API

[http://localhost:8081/admin](http://localhost:8081/admin)
[http://localhost:8081/api/server](http://localhost:8081/api/server)

## Custom Configuration

Modify the `config.js` to suit your specific needs.
