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

## Embed a meeting

Embedding a meeting into a `service` or `app` requires using an `iframe` with the `src` attribute specified as the `meeting` from `HTTP response`.

```html
<iframe
    allow="camera; microphone; display-capture; fullscreen; clipboard-read; clipboard-write; web-share; autoplay"
    src="https://sfu.mirotalk.com/join/your_room_name"
    style="height: 100vh; width: 100vw; border: 0px;"
></iframe>
```

## Fast Integration

Develop your `website` or `application`, and bring `video meetings` in with a simple `iframe`.

```html
<iframe
    allow="camera; microphone; display-capture; fullscreen; clipboard-read; clipboard-write; web-share; autoplay"
    src="https://sfu.mirotalk.com/newroom"
    style="height: 100vh; width: 100vw; border: 0px;"
></iframe>
```
