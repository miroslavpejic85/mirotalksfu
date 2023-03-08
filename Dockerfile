FROM node:16-slim

WORKDIR /src

RUN \
    DEBIAN_FRONTEND=noninteractive apt update && \
    apt install -y --no-install-recommends build-essential python3-pip

COPY package.json .

RUN npm install

COPY app app
COPY public public

CMD npm start
