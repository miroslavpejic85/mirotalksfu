'use strict';

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const https = require('httpolyglot');
const mediasoup = require('mediasoup');
const config = require('./config');
const path = require('path');
const ngrok = require('ngrok');
const fs = require('fs');
const Room = require('./Room');
const Peer = require('./Peer');
const ServerApi = require('./ServerApi');
const Logger = require('./Logger');
const log = new Logger('Server');

const app = express();

const options = {
    key: fs.readFileSync(path.join(__dirname, config.sslKey), 'utf-8'),
    cert: fs.readFileSync(path.join(__dirname, config.sslCrt), 'utf-8'),
};

const httpsServer = https.createServer(options, app);
const io = require('socket.io')(httpsServer);
const host = 'https://' + 'localhost' + ':' + config.listenPort; // config.listenIp

// all mediasoup workers
let workers = [];
let nextMediasoupWorkerIdx = 0;

// all Room lists
let roomList = new Map();

app.use(cors());
app.use(compression());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Remove trailing slashes in url handle bad requests
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        log.debug('Request Error', {
            header: req.headers,
            body: req.body,
            error: err.message,
        });
        return res.status(400).send({ status: 404, message: err.message }); // Bad request
    }
    if (req.path.substr(-1) === '/' && req.path.length > 1) {
        let query = req.url.slice(req.path.length);
        res.redirect(301, req.path.slice(0, -1) + query);
    } else {
        next();
    }
});

// all start from here
app.get(['/'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public/landing.html'));
});

// set new room name and join
app.get(['/newroom'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public/newroom.html'));
});

// if not allow video/audio
app.get(['/permission'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public/permission.html'));
});

// privacy policy
app.get(['/privacy'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public/privacy.html'));
});

// no room name specified to join
app.get('/join/', (req, res) => {
    res.redirect('/');
});

// join to room
app.get('/join/*', (req, res) => {
    if (Object.keys(req.query).length > 0) {
        log.debug('redirect:' + req.url + ' to ' + url.parse(req.url).pathname);
        res.redirect(url.parse(req.url).pathname);
    } else {
        res.sendFile(path.join(__dirname, '..', 'public/Room.html'));
    }
});

// ####################################################
// API
// ####################################################

// Api parse body data as json
app.use(express.json());

// request meeting room endpoint
app.post(['/api/v1/meeting'], (req, res) => {
    // check if user was authorized for the api call
    let host = req.headers.host;
    let authorization = req.headers.authorization;
    let api = new ServerApi(host, authorization);
    if (!api.isAuthorized()) {
        log.debug('MiroTalk get meeting - Unauthorized', {
            header: req.headers,
            body: req.body,
        });
        return res.status(403).json({ error: 'Unauthorized!' });
    }
    // setup meeting URL
    let meetingURL = api.getMeetingURL();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ meeting: meetingURL }));
    // log.debug the output if all done
    log.debug('MiroTalk get meeting - Authorized', {
        header: req.headers,
        body: req.body,
        meeting: meetingURL,
    });
});

// ####################################################
// NGROK
// ####################################################

async function ngrokStart() {
    try {
        await ngrok.authtoken(config.ngrokAuthToken);
        await ngrok.connect(config.listenPort);
        let api = ngrok.getApi();
        let data = await api.listTunnels();
        let pu0 = data.tunnels[0].public_url;
        let pu1 = data.tunnels[1].public_url;
        let tunnel = pu0.startsWith('https') ? pu0 : pu1;
        log.debug('Listening on', {
            server: host,
            tunnel: tunnel,
        });
    } catch (err) {
        console.error('Ngrok Start error: ', err);
        process.exit(1);
    }
}

// ####################################################
// START SERVER
// ####################################################

httpsServer.listen(config.listenPort, () => {
    log.debug(
        `%c

	███████╗██╗ ██████╗ ███╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ 
	██╔════╝██║██╔════╝ ████╗  ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
	███████╗██║██║  ███╗██╔██╗ ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
	╚════██║██║██║   ██║██║╚██╗██║╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
	███████║██║╚██████╔╝██║ ╚████║      ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
	╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝ started...

	`,
        'font-family:monospace',
    );

    if (config.ngrokAuthToken !== '') {
        ngrokStart();
        return;
    }
    log.debug('Listening on', {
        server: host,
    });
});

// ####################################################
// WORKERS
// ####################################################

(async () => {
    await createWorkers();
})();

async function createWorkers() {
    let { numWorkers } = config.mediasoup;

    for (let i = 0; i < numWorkers; i++) {
        let worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
        });
        worker.on('died', () => {
            console.error('Mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
            setTimeout(() => process.exit(1), 2000);
        });
        workers.push(worker);
    }
}

async function getMediasoupWorker() {
    const worker = workers[nextMediasoupWorkerIdx];
    if (++nextMediasoupWorkerIdx === workers.length) nextMediasoupWorkerIdx = 0;
    return worker;
}

// ####################################################
// SOCKET IO
// ####################################################

io.on('connection', (socket) => {
    socket.on('createRoom', async ({ room_id }, callback) => {
        socket.room_id = room_id;

        if (roomList.has(socket.room_id)) {
            callback('already exists');
        } else {
            log.debug('Created room', { room_id: socket.room_id });
            let worker = await getMediasoupWorker();
            roomList.set(socket.room_id, new Room(socket.room_id, worker, io));
            callback(socket.room_id);
        }
    });

    socket.on('roomAction', (action) => {
        switch (action) {
            case 'lock':
                roomList.get(socket.room_id).setLocked(true);
                break;
            case 'unlock':
                roomList.get(socket.room_id).setLocked(false);
                break;
        }
        log.debug('Room locked:', roomList.get(socket.room_id).isLocked());
        roomList.get(socket.room_id).broadCast(socket.id, 'roomAction', action);
    });

    socket.on('peerAction', (data) => {
        log.debug('Peer action:', data);
        if (data.broadcast) {
            roomList.get(socket.room_id).broadCast(data.peer_id, 'peerAction', data);
        } else {
            roomList.get(socket.room_id).sendTo(data.peer_id, 'peerAction', data);
        }
    });

    socket.on('updatePeerInfo', (data) => {
        log.debug('Peer info update:', data);
        // peer_info hand raise Or lower
        roomList.get(socket.room_id).getPeers().get(socket.id).updatePeerInfo(data);
        roomList.get(socket.room_id).broadCast(socket.id, 'updatePeerInfo', data);
    });

    socket.on('fileInfo', (data) => {
        log.debug('Send File Info', data);
        roomList.get(socket.room_id).broadCast(socket.id, 'fileInfo', data);
    });

    socket.on('file', (data) => {
        roomList.get(socket.room_id).broadCast(socket.id, 'file', data);
    });

    socket.on('fileAbort', (data) => {
        roomList.get(socket.room_id).broadCast(socket.id, 'fileAbort', data);
    });

    socket.on('wbCanvasToJson', (data) => {
        // let objLength = bytesToSize(Object.keys(data).length);
        // log.debug('Send Whiteboard canvas JSON', { length: objLength });
        roomList.get(socket.room_id).broadCast(socket.id, 'wbCanvasToJson', data);
    });

    socket.on('whiteboardAction', (data) => {
        log.debug('Whiteboard', data);
        roomList.get(socket.room_id).broadCast(socket.id, 'whiteboardAction', data);
    });

    socket.on('join', (data, cb) => {
        if (!roomList.has(socket.room_id)) {
            return cb({
                error: 'Room does not exist',
            });
        }

        log.debug('User joined', data);
        roomList.get(socket.room_id).addPeer(new Peer(socket.id, data));

        if (roomList.get(socket.room_id).isLocked()) {
            log.debug('User rejected because room is locked');
            cb('isLocked');
            return;
        }

        cb(roomList.get(socket.room_id).toJson());
    });

    socket.on('getRouterRtpCapabilities', (_, callback) => {
        log.debug('Get RouterRtpCapabilities', getPeerName());
        try {
            callback(roomList.get(socket.room_id).getRtpCapabilities());
        } catch (err) {
            callback({
                error: err.message,
            });
        }
    });

    socket.on('getProducers', () => {
        if (!roomList.has(socket.room_id)) return;

        log.debug('Get producers', getPeerName());

        // send all the current producer to newly joined member
        let producerList = roomList.get(socket.room_id).getProducerListForPeer();

        socket.emit('newProducers', producerList);
    });

    socket.on('createWebRtcTransport', async (_, callback) => {
        log.debug('Create webrtc transport', getPeerName());
        try {
            const { params } = await roomList.get(socket.room_id).createWebRtcTransport(socket.id);
            callback(params);
        } catch (err) {
            console.error('Create WebRtc Transport error: ', err);
            callback({
                error: err.message,
            });
        }
    });

    socket.on('connectTransport', async ({ transport_id, dtlsParameters }, callback) => {
        log.debug('Connect transport', getPeerName());

        if (!roomList.has(socket.room_id)) return;
        await roomList.get(socket.room_id).connectPeerTransport(socket.id, transport_id, dtlsParameters);

        callback('success');
    });

    socket.on('produce', async ({ kind, rtpParameters, producerTransportId }, callback) => {
        if (!roomList.has(socket.room_id)) {
            return callback({ error: 'Room not found' });
        }

        let peer_name = getPeerName(false);

        let producer_id = await roomList
            .get(socket.room_id)
            .produce(socket.id, producerTransportId, rtpParameters, kind);

        log.debug('Produce', {
            kind: kind,
            peer_name: peer_name,
            producer_id: producer_id,
        });

        // peer_info audio Or video ON
        let data = {
            peer_name: peer_name,
            type: kind,
            status: true,
        };
        roomList.get(socket.room_id).getPeers().get(socket.id).updatePeerInfo(data);

        callback({
            producer_id,
        });
    });

    socket.on('consume', async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
        if (!roomList.has(socket.room_id)) {
            return callback({ error: 'Room not found' });
        }

        let params = await roomList
            .get(socket.room_id)
            .consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

        log.debug('Consuming', {
            peer_name: getPeerName(false),
            producer_id: producerId,
            consumer_id: params.id,
        });

        callback(params);
    });

    socket.on('producerClosed', (data) => {
        log.debug('Producer close', data);

        // peer_info audio Or video OFF
        roomList.get(socket.room_id).getPeers().get(socket.id).updatePeerInfo(data);
        roomList.get(socket.room_id).closeProducer(socket.id, data.producer_id);
    });

    socket.on('resume', async (_, callback) => {
        await consumer.resume();
        callback();
    });

    socket.on('getRoomInfo', (_, cb) => {
        cb(roomList.get(socket.room_id).toJson());
        log.debug('Send Room Info');
    });

    socket.on('message', (data) => {
        log.debug('message', data);
        roomList.get(socket.room_id).broadCast(socket.id, 'message', {
            peer_name: data.peer_name,
            peer_msg: data.peer_msg,
        });
    });

    socket.on('disconnect', () => {
        if (!socket.room_id) return;

        log.debug('Disconnect', getPeerName());

        roomList.get(socket.room_id).removePeer(socket.id);

        if (roomList.get(socket.room_id).getPeers().size === 0 && roomList.get(socket.room_id).isLocked()) {
            roomList.get(socket.room_id).setLocked(false);
        }
    });

    socket.on('exitRoom', async (_, callback) => {
        if (!roomList.has(socket.room_id)) {
            callback({
                error: 'Not currently in a room',
            });
            return;
        }
        log.debug('Exit room', getPeerName());

        // close transports
        await roomList.get(socket.room_id).removePeer(socket.id);
        if (roomList.get(socket.room_id).getPeers().size === 0) {
            roomList.delete(socket.room_id);
        }

        socket.room_id = null;

        callback('Successfully exited room');
    });

    // common
    function getPeerName(json = true) {
        if (json) {
            return {
                peer_name:
                    roomList.get(socket.room_id) &&
                    roomList.get(socket.room_id).getPeers().get(socket.id).peer_info.peer_name,
            };
        }
        return (
            roomList.get(socket.room_id) && roomList.get(socket.room_id).getPeers().get(socket.id).peer_info.peer_name
        );
    }

    function bytesToSize(bytes) {
        let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes == 0) return '0 Byte';
        let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    }
});
