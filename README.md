# mirotalksfu

Powered by `WebRTC` with [SFU](https://mediasoup.org) integrated server.

![mirotalksfu](public/images/mirotalksfu.png)

## Features

-   Is `100% Free` - `Open Source` - `Self Hosted`
-   `No download`, `plug-in` or `login` required, entirely browser based
-   `Unlimited` number of `conference rooms` and `users`, `without` call `time limitation`
-   Desktop and Mobile compatible
-   Optimized Room URL Sharing (share it to your participants, wait them to join)
-   Webcam Streaming up to 4K quality (Front - Rear for mobile)
-   Echo cancellation and noise suppression that makes your audio crystal clear
-   Screen Sharing to present documents, slides, and more ...
-   Chat with Emoji Picker to show you feeling and possibility to Save the conversations
-   Select Microphone - Speaker and Video source
-   Recording your Screen, Audio or Video
-   Full Screen Mode on mouse click on the Video element
-   Supports [REST API](api/README.md) (Application Programming Interface)

## Quick Start

-   You will need to have `Node.js` installed, this project has been tested with Node version [12.X](https://nodejs.org/en/blog/release/v12.22.1/) and [14.X](https://nodejs.org/en/blog/release/v14.17.5/)

```bash
# Clone this repo
$ git clone https://github.com/miroslavpejic85/mirotalksfu.git
# Go to to dir mirotalksfu
$ cd mirotalksfu
# Copy src/config.template.js in src/config.js
$ cp src/config.template.js src/config.js
# Install dependencies
$ npm install
# Start the server
$ npm start
```

-   Open https://localhost:3010 in browser

## Docker

-   Install https://docs.docker.com/compose/install/

```bash
# Build or rebuild services
$ docker-compose build
# Create and start containers
$ docker-compose up # -d
# Stop and remove resources
$ docker-compose down
```

-   Open https://localhost:3010 in browser

## API

```bash
# The response will give you a entrypoint / Room URL for your meeting.
$ curl -X POST "http://localhost:3010/api/v1/meeting" -H "authorization: mirotalksfu_default_secret" -H "Content-Type: application/json"
```

## Notes

-   Run the project on a `Linux or Mac` system as the `mediasoup` installation could have issues on `Windows`. If you have a Windows system, consider to installing [WSL](https://docs.microsoft.com/en-us/windows/wsl/install-win10) to be able to run it.

## Credits

-   [Davide Pacilio](https://cruip.com/demos/solid/) (html template)
-   [Dirk Vanbeveren](https://github.com/Dirvann) (sfu logic)
-   [Mediasoup](https://mediasoup.org) (sfu server)

## Contributing

-   Contributions are welcome and greatly appreciated!
-   Just run before `npm run lint`

## License

-   [AGPLv3](LICENSE)
