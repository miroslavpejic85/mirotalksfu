# MiroTalk SFU - Self Hosting

### How can I self-host MiroTalk SFU on my own server?

[https://docs.mirotalk.com/mirotalk-sfu/self-hosting/](https://docs.mirotalk.com/mirotalk-sfu/self-hosting/)

### Automation scripts

[https://docs.mirotalk.com/scripts/about/](https://docs.mirotalk.com/scripts/about/)

### Participant views

The participant-view dropdown stays open while selecting layouts, including changes
that automatically pin or unpin a video. Click outside, click the toggle again, or
press Escape to close it. Desktop hover behavior remains unchanged.

### Dialog customization

SweetAlert dialogs share [button defaults and theme helpers](../public/js/Swal.js)
and [responsive action styles](../public/css/Swal.css) on the room, landing, new-room,
and login pages. Desktop actions place cancellation/alternatives before the primary
action; narrow screens stack them in the same order, with at least 44px touch targets.
Primary labels stay white; theme accents are darkened when needed to provide at least
6:1 text contrast. Secondary buttons select contrasting text automatically. Destructive confirmations
use `swalDestructiveOptions()` to focus cancellation and prevent Enter in a text input
from confirming. Keep genuine alternatives as deny actions and ordinary dismissal as
cancel actions. New labels use the existing translation hooks; regenerate the language
templates with `node app/src/scripts/extract-ui-lang.js` (missing translations fall back
to English).

---
