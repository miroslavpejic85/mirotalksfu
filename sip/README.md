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

## MiroTalk SFU in-room SIP phone

The room **Settings → SIP phone** tab uses this demo server by default (`ws://<host>:5066`). Its dialer accepts:

| You type                                 | Detected as  | Called URI                                              |
| ---------------------------------------- | ------------ | ------------------------------------------------------- |
| `1001`, `alice`                          | Extension    | `sip:1001@<SIP domain>`                                 |
| `+1 (555) 123-4567`, `0039 06 1234 5678` | Phone number | `sip:+15551234567@<phone number gateway or SIP domain>` |
| `tel:+15551234567`                       | Phone number | same as above                                           |
| `bob@example.org`, `sip:bob@example.org` | SIP address  | used as-is                                              |

Phone-number formatting (spaces, dashes, dots, parentheses) is stripped. Values starting with `+` or with 7+ digits are treated as phone numbers; shorter ones as extensions.

Calling a real phone number requires a SIP provider or PBX with a PSTN trunk. Set **Advanced compatibility → Phone number gateway** to the provider's domain to send phone numbers there, while extensions keep using the SIP domain. With this Kamailio demo (no PSTN trunk), a phone number only rings if a user registered with that number, e.g. register as `5551234567` and dial `(555) 123-4567`.

Other dialer features: keypad (hold `0` for `+`), DTMF tones during a call (keypad or keyboard), mute, call timer, recent numbers, and incoming call accept/reject. Server settings are remembered in the browser (never the password); the SIP username is kept per tab so two tabs never register the same user.

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
- WebSocket contacts are aliased (`add_contact_alias` / `handle_ruri_alias`) so in-dialog ACK/BYE reach browser clients.
- No authentication challenge is enforced.
- Not intended for public internet use without TLS/WSS, authentication, ACLs, and anti-abuse controls.
- The web client allows enabling/disabling SIP.js `hackIpInContact` for better interoperability across SIP servers.

## Stop

```bash
docker compose -f docker-compose.yml down
```
