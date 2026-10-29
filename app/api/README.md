![restAPI](restAPI.png)

## Create a meeting

Create a meeting with a `HTTP request` containing the `API_KEY` sent to MiroTalk’s server. The response contains a `meeting` URL that can be `embedded` in your client within an `iframe`.

The `API_KEY` is defined in the `app/src/config.js`, change it with your own.

```js
api: {
    // app/api
    keySecret: 'mirotalksfu_default_secret',
}
```

Some examples demonstrating how to call the API:

```bash
# js
node meetings.js
node meeting.js
node join.js

# php
php meetings.php
php meeting.php
php join.php

# python
python3 meetings.py
python3 meeting.py
python3 join.py

# bash
./meetings.sh
./meeting.sh
./join.sh
```

## Publish with WHIP (OBS, FFmpeg, GStreamer)

When `WHIP_ENABLED=true`, any [WHIP (RFC 9725)](https://www.rfc-editor.org/rfc/rfc9725.html) client can publish audio/video into an **active** room. Get the room endpoint and a Bearer token bound to it:

```bash
# js / php / python / bash
node whip.js
php whip.php
python3 whip.py
./whip.sh
# -> { "whip": "https://sfu.mirotalk.com/whip/test", "token": "eyJ..." }
```

- **OBS Studio 30+**: Settings → Stream → Service `WHIP`, Server = `whip` (append `?name=OBS` to set the display name), Bearer Token = `token`.
- **FFmpeg**: `ffmpeg -re -i input.mp4 -c:v libx264 -profile:v baseline -tune zerolatency -c:a libopus -f whip -authorization "<token>" "<whip>"`
- **GStreamer**: `whipclientsink signaller::whip-endpoint="<whip>" signaller::auth-token="<token>"`
- **From a room (no API key)**: presenters can create the token in **Settings → WHIP publish → Receive in this room**.
- **Another MiroTalk room**: in **Settings → WHIP publish**, a presenter enters the `whip` URL as **Endpoint URL** and the `token` with **Authentication → Bearer token** to publish their camera/screen and microphone into that room straight from the browser. **Test with this room** publishes into the current room to check the setup. A remote endpoint must allow your origin through CORS (`CORS_ORIGIN`).
- **Any other WHIP server** (MediaMTX, Cloudflare Stream, Dolby.io, LiveKit...): paste its WHIP URL and pick the **Authentication** method: **None**, **Bearer token** or **Username and password** (sent as Basic auth). A `https://user:pass@host/stream/whip` URL is also accepted: the credentials are moved to the username and password fields. Credentials are never saved in the browser. `?name=` is added only to MiroTalk endpoints (`/whip/{room}`) or when you fill in **Display name**.

A server-wide token (`WHIP_API_SECRET`) can be used instead of per-room tokens. Ending the stream in the client (HTTP `DELETE`, accepted only with the token that started the session or the server-wide token) or ejecting the WHIP participant from the room closes the session. Banning it also rejects its token in that room: a per-room token until it expires, the server-wide token until the room ends.

## Embed a meeting

Embedding a meeting into a `service` or `app` requires using an `iframe` with the `src` attribute specified as the `meeting` from `HTTP response`.

```html
<iframe
    allow="camera; microphone; speaker-selection; display-capture; fullscreen; clipboard-read; clipboard-write; web-share; autoplay; picture-in-picture"
    src="https://sfu.mirotalk.com/join/your_room_name"
    style="height: 100vh; width: 100vw; border: 0px;"
></iframe>
```

## Fast Integration

Develop your `website` or `application`, and bring `video meetings` in with a simple `iframe`.

```html
<iframe
    allow="camera; microphone; speaker-selection; display-capture; fullscreen; clipboard-read; clipboard-write; web-share; autoplay; picture-in-picture"
    src="https://sfu.mirotalk.com/newroom"
    style="height: 100vh; width: 100vw; border: 0px;"
></iframe>
```
