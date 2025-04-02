#!/bin/bash

# ============================================
# RUN sudo ./install.sh
# ============================================

set -e  # Exit immediately if a command exits with a non-zero status

# -------------------------------------------------------
# bash colors for log
# -------------------------------------------------------

black=`tput setaf 0`
red=`tput setaf 1`
green=`tput setaf 2`
yellow=`tput setaf 3`
blue=`tput setaf 4`
magenta=`tput setaf 5`
cyan=`tput setaf 6`
white=`tput setaf 7`
reset=`tput sgr0`

# -------------------------------------------------------
# print log level
# -------------------------------------------------------
function log() {
    date_now=`date '+%Y-%m-%d %H:%M:%S'`
    case $1 in
        debug)   echo -e "${date_now} :: ${2}" ;;
        warning) echo -e "${date_now} :: ${yellow}${2}${reset}" ;;
        error)   echo -e "${date_now} :: ${red}${2}${reset}" ;;
        *)       echo -e "${date_now} :: ${magenta}${1}${reset}" ;;
    esac
}

# -------------------------------------------------------
# Check if Linux OS
# -------------------------------------------------------
unamestr=$(uname)
if [[ "$unamestr" != 'Linux' ]]; then
    log warning "This install script is supported only on Linux OS"
    exit
fi

# -------------------------------------------------------
# Check if run as root
# -------------------------------------------------------
if [ "$EUID" -ne 0 ]; then 
    log warning "Please run as root: sudo ./install.sh"
    exit
fi

# ============================================
# Start the installation...
# ============================================

printf 'Install the dependences (y/n)? '
read answer

if [ "$answer" != "${answer#[Yy]}" ] ;then

    log "Update package lists"

    apt-get update

	log "Install essential build tools: gcc, g++, make"

    apt-get install -y build-essential


	log "Install Python 3.8 and pip"

    apt-get install -y software-properties-common

    add-apt-repository -y ppa:deadsnakes/ppa

    apt-get update

    apt-get install -y python3.8 python3-pip


    log "Install Node.js 18.x and npm"

    apt install -y curl dirmngr apt-transport-https lsb-release ca-certificates

    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -

    apt-get install -y nodejs

    npm install -g npm@latest


    log "Install FFmpeg"

    apt install -y ffmpeg
fi

CONFIG=app/src/config.js
ENV=.env

if ! [ -f "$CONFIG" ]; then

    log "Copy the configuration file"

    cp app/src/config.template.js $CONFIG

    cp .env.template $ENV
fi

printf 'Use docker (y/n)? '
read answer

if [ "$answer" != "${answer#[Yy]}" ] ;then

    log "Install Docker and Docker Compose"

    sudo apt install -y docker.io

    sudo apt install -y docker-compose 


    log "Add the current user to the docker group"

    usermod -aG docker $USER


    YAML=docker-compose.yml

    if ! [ -f "$YAML" ]; then

        log "Copy Docker compose yaml file"

        cp docker-compose.template.yml $YAML
    fi

    printf 'Use official docker image (y/n)? '
    read answer

    if [ "$answer" != "${answer#[Yy]}" ] ;then

        log "Get latest official image from Docker Hub"

        docker pull mirotalk/sfu:latest
    else
        log "Build image from source"

        docker-compose build


        log "Remove old and unused docker images"

        docker images |grep '<none>' |awk '{print $3}' |xargs docker rmi
    fi

    log "Start containers"

    docker-compose up #-d
else
    log "Install dependencies"

    npm install


    log "Start the server"

    npm start
fi