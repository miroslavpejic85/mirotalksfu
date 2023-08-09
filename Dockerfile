FROM node:18-slim 

WORKDIR /src

# https://mediasoup.org/documentation/v3/mediasoup/installation/
ENV MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD="true"

COPY package.json .

RUN \
    DEBIAN_FRONTEND=noninteractive apt update && \
    apt install -y --no-install-recommends build-essential python3-pip && \
    npm install && \
    apt-get -y purge --auto-remove build-essential python3-pip && \
    apt-get install -y --no-install-recommends python3 && \
    npm cache clean --force && \
    rm -rf /tmp/* /var/lib/apt/lists/* /var/tmp/* /usr/share/doc/*

COPY app app
COPY public public

CMD npm start
