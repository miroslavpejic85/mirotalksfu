'use strict';

const poweredBy = document.getElementById('poweredBy');
const sponsors = document.getElementById('sponsors');
const advertisers = document.getElementById('advertisers');
const footer = document.getElementById('footer');
//...

const config = {
    html: {
        poweredBy: true,
        sponsors: true,
        advertisers: true,
        footer: true,
    },
    //...
};

!config.html.poweredBy && elementDisplay(poweredBy, false);
!config.html.sponsors && elementDisplay(sponsors, false);
!config.html.advertisers && elementDisplay(advertisers, false);
!config.html.footer && elementDisplay(footer, false);
//...

function elementDisplay(element, display, mode = 'block') {
    if (!element) return;
    element.style.display = display ? mode : 'none';
}
