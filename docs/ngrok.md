# MiroTalk SFU - Ngrok

![ngrok](../public/images/ngrok.png)

If you want to expose MiroTalk SFU from your `Local PC` to outside in `HTTPS`, you need to do 2 things:

1. Add the [Ngrok](https://ngrok.com) `authToken` and change the `announcedIp` on `app/src/config.js`.

```js
    /*
    Ngrok
        1. Goto https://ngrok.com
        2. Get started for free
        3. Copy YourNgrokAuthToken: https://dashboard.ngrok.com/get-started/your-authtoken
    */
    ngrokAuthToken: 'YourNgrokAuthToken', <--- put it here

    announcedIp: 'Your-Public-Static-IP-here' <--- take it from https://api.ipify.org
```

---

2. You need to do a `port forwarding` on your router, something like this:

| Name          | Protocol  | Port Wan    | Port Lan    | IP Destination  |
| ------------- | --------- | ----------- | ----------- | --------------- |
| `MiroTalkSfu` | `TCP/UDP` | 40000:40100 | 40000:40100 | `Your Local IP` |
| `MiroTalkSfu` | `TCP`     | 3010        | 3010        | `Your Local IP` |

Make sure your firewall not blocking rtcPorts `range: 40000:40100`

Then, when you run it with `npm start`, you should see in the console log this line

```bash
server_tunnel: 'https://xxxxxxxxxxxxxxxxxx.ngrok.io'
```

So open it in your browser, join in the room, share it to whom you want and wait participants to join.

---

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/mirotalk/mirotalk-sfu-free-video-calls-messaging-screen-sharing-recording)
