git pull
pm2 stop app/src/Server.js
sudo npm install
pm2 start app/src/Server.js --name 'video_call'