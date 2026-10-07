'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const start = serverSource.indexOf('    function isAllowedRoomAccess(');
const end = serverSource.indexOf('    async function roomExistsForUser(');
const source = serverSource.slice(start, end);

describe('Direct join authorization with OIDC', () => {
    function load(oidc, hostCfg = { protected: false, authenticated: true }) {
        const context = vm.createContext({
            OIDC: oidc,
            hostCfg,
            log: { debug() {} },
        });
        vm.runInContext(
            `${source}; this.isAllowedRoomAccess = isAllowedRoomAccess; this.isDirectJoinAllowed = isDirectJoinAllowed;`,
            context
        );
        return context;
    }

    const anonReq = { oidc: { isAuthenticated: () => false } };
    const authReq = { oidc: { isAuthenticated: () => true } };
    const oidc = { enabled: true, allow_rooms_creation_for_auth_users: true };

    it('denies an anonymous user creating a new room even when a name makes isRoomAllowedForUser true', () => {
        const ctx = load(oidc);
        const roomList = new Map([['existing', {}]]);
        const allowRoomAccess = ctx.isAllowedRoomAccess('test', anonReq, ctx.hostCfg, roomList, 'new-room');
        assert.equal(allowRoomAccess, false);
        assert.equal(ctx.isDirectJoinAllowed(allowRoomAccess, true), false);
    });

    it('allows an anonymous user joining an existing room', () => {
        const ctx = load(oidc);
        const roomList = new Map([['existing', {}]]);
        const allowRoomAccess = ctx.isAllowedRoomAccess('test', anonReq, ctx.hostCfg, roomList, 'existing');
        assert.equal(ctx.isDirectJoinAllowed(allowRoomAccess, false), true);
    });

    it('allows an authenticated OIDC user to create a new room', () => {
        const ctx = load(oidc);
        const allowRoomAccess = ctx.isAllowedRoomAccess('test', authReq, ctx.hostCfg, new Map(), 'new-room');
        assert.equal(ctx.isDirectJoinAllowed(allowRoomAccess, false), true);
    });

    it('keeps the user-based check when OIDC is disabled', () => {
        const ctx = load({ enabled: false }, { protected: true, authenticated: false });
        assert.equal(ctx.isDirectJoinAllowed(false, true), true);
        assert.equal(ctx.isDirectJoinAllowed(false, false), false);
    });
});
