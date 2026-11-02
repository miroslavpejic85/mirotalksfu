# MiroTalk SFU - Self Hosting

### How can I self-host MiroTalk SFU on my own server?

[https://docs.mirotalk.com/mirotalk-sfu/self-hosting/](https://docs.mirotalk.com/mirotalk-sfu/self-hosting/)

### Automation scripts

[https://docs.mirotalk.com/scripts/about/](https://docs.mirotalk.com/scripts/about/)

### Landing page sections

The About and FAQ sections are visible by default. Configure them in `.env`:

```dotenv
SHOW_LANDING_ABOUT=true # true or false
SHOW_FAQ=true           # true or false
```

These map to `ui.brand.html.landingAbout` and `ui.brand.html.faq` in
[app/src/config.js](../app/src/config.js). Setting either to `false` hides the
section and its navigation link; hiding FAQ also removes its structured metadata.
Restart the server after changing these settings. They use the existing branding
system, which requires `ui.brand.htmlInjection` to be enabled.

---
