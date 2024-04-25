'use strict';

const config = require('../config');

const net = require('net');

/*
    Run: node bindable.js

    In networking, "bindable" refers to the ability to assign or allocate a specific IP address and port combination 
    to a network service or application. Binding an IP address and port allows the service or application to listen for 
    incoming network connections on that particular address and port.

    When we say an IP address and port are "bindable," it means that there are no conflicts or issues preventing the service 
    or application from using that specific combination. In other words, the IP address is available, and the port is not already 
    in use by another process or service on the same machine.

    If an IP address and port are bindable, it indicates that the network service or application can successfully bind to that 
    combination, allowing it to accept incoming connections and communicate over the network. On the other hand, if the IP address 
    and port are not bindable, it suggests that there may be conflicts or restrictions preventing the service or application 
    from using them, such as another process already listening on the same IP address and port.
*/

async function main() {
    // Server listen
    const serverListenIp = config.server.listen.ip;
    const serverListenPort = config.server.listen.port;

    // WebRtcServerActive
    const webRtcServerActive = config.mediasoup.webRtcServerActive;

    // WebRtcTransportOptions
    const webRtcTransportIpInfo = config.mediasoup.webRtcTransport.listenInfos[0];
    const webRtcTransportIpAddress =
        webRtcTransportIpInfo.ip !== '0.0.0.0' ? webRtcTransportIpInfo.ip : webRtcTransportIpInfo.announcedAddress;

    // WorkersOptions | webRtcTransportOptions
    const workers = config.mediasoup.numWorkers;
    const { min, max } = config.mediasoup.webRtcTransport.listenInfos[0].portRange;
    const rtcMinPort = config.mediasoup.worker.rtcMinPort || min || 40000;
    const rtcMaxPort = config.mediasoup.worker.rtcMaxPort || max || 40100;

    console.log('==================================');
    console.log('checkServerListenPorts');
    console.log('==================================');

    await checkServerListenPorts(serverListenIp, serverListenPort);

    console.log('==================================');
    console.log('checkWebRtcTransportPorts');
    console.log('==================================');

    await checkWebRtcTransportPorts(webRtcTransportIpAddress, rtcMinPort, rtcMaxPort);

    if (webRtcServerActive) {
        console.log('==================================');
        console.log('checkWebRtcServerPorts');
        console.log('==================================');

        // WebRtcServerOptions
        const webRtcServerIpInfo = config.mediasoup.webRtcServerOptions.listenInfos[0];
        const webRtcServerIpAddress =
            webRtcServerIpInfo.ip !== '0.0.0.0' ? webRtcServerIpInfo.ip : webRtcServerIpInfo.announcedAddress;
        const webRtcServerStartPort = webRtcServerIpInfo.port
            ? webRtcServerIpInfo.port
            : webRtcServerIpInfo.portRange.min;

        await checkWebRtcServerPorts(webRtcServerIpAddress, webRtcServerStartPort, workers);
    }
}

/**
 * Check if Server listen port is bindable
 * @param {string} ipAddress
 * @param {integer} port
 */
async function checkServerListenPorts(ipAddress, port) {
    const bindable = await isBindable(ipAddress, port);
    if (bindable) {
        console.log(`${ipAddress}:${port} is bindable 🟢`);
    } else {
        console.log(`${ipAddress}:${port} is not bindable 🔴`);
    }
}

/**
 * Check if WebRtcServer ports are bindable
 * @param {string} ipAddress
 * @param {integer} startPort
 * @param {integer} workers
 */
async function checkWebRtcServerPorts(ipAddress, startPort, workers) {
    let port = startPort;
    for (let i = 0; i < workers; i++) {
        try {
            const bindable = await isBindable(ipAddress, port);
            if (bindable) {
                console.log(`${ipAddress}:${port} is bindable 🟢`);
            } else {
                console.log(`${ipAddress}:${port} is not bindable 🔴`);
            }
            port++;
        } catch (err) {
            console.error('Error occurred:', err);
        }
    }
}

/**
 * Check if WebRtcTransport Worker ports are bindable
 * @param {string} ipAddress
 * @param {integer} minPort
 * @param {integer} maxPort
 */
async function checkWebRtcTransportPorts(ipAddress, minPort, maxPort) {
    let port = minPort;
    for (let i = 0; i <= maxPort - minPort; i++) {
        try {
            const bindable = await isBindable(ipAddress, port);
            if (bindable) {
                console.log(`${ipAddress}:${port} is bindable 🟢`);
            } else {
                console.log(`${ipAddress}:${port} is not bindable 🔴`);
            }
            port++;
        } catch (err) {
            console.error('Error occurred:', err);
        }
    }
}

/**
 * Check if ipAddress:port are bindable
 * @param {string} ipAddress
 * @param {integer} port
 * @returns {Promise<boolean>} A promise that resolves to true if the address is bindable, false otherwise.
 */
async function isBindable(ipAddress, port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false); // Address is already in use
            } else {
                reject(err); // Other error occurred
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(true); // Address is bindable
        });

        server.listen(port, ipAddress);
    });
}

main().catch((err) => {
    console.error('Error occurred in main function:', err.message);
});
