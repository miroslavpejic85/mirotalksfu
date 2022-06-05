FROM node:latest

WORKDIR /src

# gcc g++ make
RUN \
	apt-get update && \
	apt-get install -y build-essential

# Python 3.8 and pip
RUN \
	apt update && \
	apt install -y python3-pip
