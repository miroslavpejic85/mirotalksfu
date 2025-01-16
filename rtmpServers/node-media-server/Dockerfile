# Use a lightweight Node.js image
FROM node:lts-slim

# Set working directory
WORKDIR /app

# Copy package.json and install npm dependencies
COPY package.json .
RUN npm install

# Cleanup unnecessary packages and files
RUN npm cache clean --force \
&& rm -rf /tmp/* /var/tmp/* /usr/share/doc/*

# Copy the application code
COPY src src

# Rtmp port
EXPOSE 1935
# Http port
EXPOSE 8081
# Https port
EXPOSE 8043

# Set default command to start the application
CMD ["npm", "start"]