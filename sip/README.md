# SIP Demo (Kamailio + Simple Node.js Web SIP Client)

This folder provides a **minimal SIP concept**:

- `kamailio` in Docker (registrar + call routing)
- a simple web SIP client (Node.js + SIP.js) to:
    - register users
    - call each other

> This is a lightweight demo for proof-of-concept and local testing.
> It is intentionally simple and not production hardened.
> Kamailio image is pinned to `kamailio/kamailio-ci:5.5.2` for broad pull availability and stable WS behavior.

## Contents

- [docker-compose.yml](./docker-compose.yml)
- [run.sh](./run.sh)
- [kamailio/kamailio.cfg](./kamailio/kamailio.cfg)
- [client/](./client)

## Quick start

From this folder:

```bash
chmod +x run.sh
./run.sh
```

Or directly:

```bash
docker compose -f docker-compose.yml up -d --build
```

Open:

- http://localhost:8088

## How to test

1. Open the SIP page in browser A.
2. Register as `1001` on `127.0.0.1`.
3. Open the SIP page in browser B (or another browser profile).
4. Register as `1002` on `127.0.0.1`.
5. From `1001`, call `1002`.
6. On `1002`, click **Accept incoming**.

Defaults on the page:

- WS server: `ws://127.0.0.1:5066`
- SIP domain: `127.0.0.1`
- Auth username: defaults to SIP username
- Contact IP compatibility hack: enabled by default (can be disabled for servers that don't need it)
- Advanced section:
    - Display name
    - Outbound proxy / route set
    - Register expires

Why `127.0.0.1` instead of `localhost`:

- Browsers may attach many `localhost` cookies to the WebSocket handshake.
- Large cookie headers can break the SIP WS upgrade and cause `code: 1006`.

## Notes / limitations

- No persistent subscriber database in this demo.
- Registration is stored in memory (inside Kamailio runtime).
- No authentication challenge is enforced.
- Not intended for public internet use without TLS/WSS, authentication, ACLs, and anti-abuse controls.
- The web client allows enabling/disabling SIP.js `hackIpInContact` for better interoperability across SIP servers.

## Stop

```bash
docker compose -f docker-compose.yml down
```
