FROM ubuntu:20.04

WORKDIR /src

# gcc g++ make
RUN \
	apt-get update && \
	apt-get install -y build-essential

# Python 3.8 and pip
RUN \
	DEBIAN_FRONTEND=noninteractive apt-get install -y tzdata && \
	apt install -y software-properties-common && \
	add-apt-repository ppa:deadsnakes/ppa && \
	apt update && \
	apt install -y python3.8 python3-pip

# NodeJS 16.X and npm
RUN \
	apt install -y curl dirmngr apt-transport-https lsb-release ca-certificates && \
	curl -sL https://deb.nodesource.com/setup_16.x | bash - && \
	apt-get install -y nodejs && \
	npm install -g npm@latest

# Vim editor
RUN apt-get install -y vim

COPY package.json .

RUN npm install

COPY app app
COPY public public

EXPOSE 3010/tcp
EXPOSE 40000-40100/tcp
EXPOSE 40000-40100/udp

CMD npm start