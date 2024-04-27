'use strict';

module.exports = class Host {
    constructor() {
        this.authorizedIPs = new Map();
        this.roomActive = false;
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
        this.roomActive = true;
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
     * Host room active
     * @returns boolean
     */
    isRoomActive() {
        return this.roomActive;
    }

    /**
     * Delete ip from authorized IPs
     * @param {string} ip
     * @returns boolean
     */
    deleteIP(ip) {
        this.roomActive = false;
        return this.authorizedIPs.delete(ip);
    }
};
