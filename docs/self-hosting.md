# MiroTalk SFU - Self Hosting

## Requirements

-   Recommended: [Hetzner](https://www.hetzner.com/cloud) (`CPX11` it's enough, OS: `Ubuntu 20.04`) use [this link](https://hetzner.cloud/?ref=XdRifCzCK3bn) to receive `€⁠20 in cloud credits`.
-   [Node.js](https://nodejs.org/en/) at least 16x, better `16.15.1 LTS` & npm
-   Your domain name, example: `your.domain.name`
    -   Set a DNS A record for that domain that point to Your Server public IPv4
        > DNS A Record: The Address Mapping record (or DNS host record) stores a hostname and its corresponding IPv4 address. When users search for your website, the A record redirects this traffic from the web address (xxxxx.com – human-readable domain) to the IPv4 address.

---

Install the requirements (Note: Many of the installation steps require `root` or `sudo` access)

```bash
# Gcc g++ make
$ apt-get update
$ apt-get install -y build-essential

# Python 3.8 and pip
$ DEBIAN_FRONTEND=noninteractive apt-get install -y tzdata
$ apt install -y software-properties-common
$ add-apt-repository ppa:deadsnakes/ppa
$ apt update
$ apt install -y python3.8 python3-pip

# NodeJS 16.X and npm
$ apt install -y curl dirmngr apt-transport-https lsb-release ca-certificates
$ curl -sL https://deb.nodesource.com/setup_16.x | bash -
$ apt-get install -y nodejs
$ npm install -g npm@latest
```

---

## Quick start

```bash
# Clone this repo
$ git clone https://github.com/miroslavpejic85/mirotalksfu.git
# Go to to dir mirotalksfu
$ cd mirotalksfu
# Copy app/src/config.template.js in app/src/config.js
$ cp app/src/config.template.js app/src/config.js
```

---

Change the `announcedIp` with your `Server public IPv4` on `app/src/config.js`

```js
{
    ip: '0.0.0.0',
    announcedIp: 'Server Public IPv4', // 'xx.xxx.xxx.xx'
}
```

Set the `inbound rules` if you have the Firewall enabled

| Port range  | Protocol | Source    | Description         |
| ----------- | -------- | --------- | ------------------- |
| 3010        | TCP      | 0.0.0.0/0 | App listen on tcp   |
| 40000-40100 | TCP      | 0.0.0.0/0 | RTC port ranges tcp |
| 40000-40100 | UDP      | 0.0.0.0/0 | RTC port ranges udp |

---

```bash
# Install dependencies - be patient, the first time will take a few minutes, in the meantime have a good coffee ;)
$ npm install
# Start the server
$ npm start
```

Check if is correctly installed: https://your.domain.name:3010

---

## PM2

![pm2](../public/images/pm2.png)

Using [PM2](https://pm2.keymetrics.io) to run it as daemon

```bash
$ npm install -g pm2
$ pm2 start app/src/Server.js
$ pm2 save
$ pm2 startup
```

---

## Docker

![docker](../public/images/docker.png)

If you want to use `Docker`

Repo: https://hub.docker.com/r/mirotalk/sfu

```bash
# Install docker and docker-compose
$ sudo apt install docker.io
$ sudo apt install docker-compose

# Copy app/src/config.template.js in app/src/config.js IMPORTANT (edit it according to your needs)
$ cp app/src/config.template.js app/src/config.js
# Copy docker-compose.template.yml in docker-compose.yml and edit it if needed
$ cp docker-compose.template.yml docker-compose.yml
# Get official image from Docker Hub
$ docker pull mirotalk/sfu:latest
# Create and start containers as deamon
$ docker-compose up -d
```

Check if is correctly installed: https://your.domain.name:3010

---

## Nginx & Certbot

![nginx](../public/images/nginx.png)

In order to use it without the port number at the end, and to have encrypted communications, we going to install [nginx](https://www.nginx.com) and [certbot](https://certbot.eff.org)

```bash
# Install Nginx
$ sudo apt-get install nginx

# Install Certbot (SSL certificates)
$ sudo apt install snapd
$ sudo snap install core; sudo snap refresh core
$ sudo snap install --classic certbot
$ sudo ln -s /snap/bin/certbot /usr/bin/certbot

# Setup Nginx sites
$ sudo vim /etc/nginx/sites-enabled/default
```

Paste this:

```bash
# HTTP — redirect all traffic to HTTPS
server {
    if ($host = your.domain.name) {
        return 301 https://$host$request_uri;
    }
        listen 80;
        listen [::]:80  ;
    server_name your.domain.name;
    return 404;
}
```

```bash
# Check if all configured correctly
$ sudo nginx -t

# Active https for your domain name (follow the instruction)
$ sudo certbot certonly --nginx

# Add let's encrypt part on nginx config
$ sudo vim /etc/nginx/sites-enabled/default
```

Paste this:

```bash
# MiroTalk SFU - HTTPS — proxy all requests to the Node app
server {
	# Enable HTTP/2
	listen 443 ssl http2;
	listen [::]:443 ssl http2;
	server_name your.domain.name;

	# Use the Let’s Encrypt certificates
	ssl_certificate /etc/letsencrypt/live/your.domain.name/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/your.domain.name/privkey.pem;

	location / {
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header Host $host;
		proxy_pass http://localhost:3010/;
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
	}
}
```

```bash
# Check if all configured correctly
$ sudo nginx -t

# Restart nginx
$ service nginx restart
$ service nginx status

# Auto renew SSL certificate
$ sudo certbot renew --dry-run

# Show certificates
$ sudo certbot certificates
```

Check Your MiroTalk SFU instance: https://your.domain.name/

---

## Update script

In order to have always Your MiroTalk SFU updated to latest, we going to create a script

```bash
cd
# Create a file sfuUpdate.sh
$ vim sfuUpdate.sh
```

---

If you use `PM2`, paste this:

```bash
#!/bin/bash

cd mirotalksfu
git pull
pm2 stop app/src/Server.js
sudo npm install
pm2 start app/src/Server.js
```

---

If you use `Docker`, paste this:

```bash
#!/bin/bash

cd mirotalksfu
git pull
docker pull mirotalk/sfu:latest
docker-compose up -d
docker images |grep '<none>' |awk '{print $3}' |xargs docker rmi
```

---

Make the script executable

```bash
$ chmod +x sfuUpdate.sh
```

Follow the commits of the MiroTalk SFU project [here](https://github.com/miroslavpejic85/mirotalksfu/commits/master)

To update your instance of MiroTalk SFU at latest commit, execute:

```bash
./sfuUpdate.sh
```

---

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/mirotalk/mirotalk-sfu-free-video-calls-messaging-screen-sharing-recording)
