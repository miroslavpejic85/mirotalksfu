FROM node:14

WORKDIR /app

RUN apt-get update
RUN apt-get install vim -y

COPY package.json .

RUN npm install

COPY api api
COPY public public
COPY src src
COPY ssl ssl

EXPOSE 3010/tcp
EXPOSE 40000-40100/tcp
EXPOSE 40000-40100/udp

CMD npm start