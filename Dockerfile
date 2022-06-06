FROM node:alpine

WORKDIR /src
RUN apk add --update linux-headers alpine-sdk

RUN apk add --update py-pip
