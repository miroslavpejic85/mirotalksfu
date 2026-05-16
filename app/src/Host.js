'use strict';

const config = require('./config');
const trustProxy = Boolean(config?.server?.trustProxy);

module.exports = class Host {
    constructor() {
        this.authorizedIPs = new Map();
    }

    /**
     * Get IP from req
     * @param {object} req
     * @returns string IP
     */
    getIP(req) {
        // Security: only trust X-Forwarded-For when behind a trusted reverse proxy.
        const forwarded = trustProxy ? req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] : null;
        return (forwarded && forwarded.split(',')[0].trim()) || req.socket.remoteAddress || req.ip;
    }

    /**
     * Get authorized IPs
     * @returns object
     */
    getAuthorizedIPs() {
        return Object.fromEntries(this.authorizedIPs);
    }

    /**
     * Set authorized IP
     * @param {string} ip
     * @param {boolean} authorized
     */
    setAuthorizedIP(ip, authorized) {
        this.authorizedIPs.set(ip, authorized);
    }

    /**
     * Check if IP is authorized
     * @param {string} ip
     * @returns boolean
     */
    isAuthorizedIP(ip) {
        return this.authorizedIPs.has(ip);
    }

    /**
     * Delete ip from authorized IPs
     * @param {string} ip
     * @returns boolean
     */
    deleteIP(ip) {
        return this.authorizedIPs.delete(ip);
    }
};
