FROM node:slim

WORKDIR /src

RUN \
    apt-get update && \
    apt-get install -y build-essential

RUN \
    apt update && \
    apt install -y python3-pip
