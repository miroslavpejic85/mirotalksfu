'use strict';

const features = document.getElementById('features');
const teams = document.getElementById('teams');
const tryEasier = document.getElementById('tryEasier');
const poweredBy = document.getElementById('poweredBy');
const sponsors = document.getElementById('sponsors');
const advertisers = document.getElementById('advertisers');
const footer = document.getElementById('footer');
//...

const config = {
    html: {
        features: true,
        teams: true, // please keep me always true ;)
        tryEasier: true,
        poweredBy: true,
        sponsors: true,
        advertisers: true,
        footer: true,
    },
    //...
};

!config.html.features && elementDisplay(features, false);
!config.html.teams && elementDisplay(teams, false);
!config.html.tryEasier && elementDisplay(tryEasier, false);
!config.html.poweredBy && elementDisplay(poweredBy, false);
!config.html.sponsors && elementDisplay(sponsors, false);
!config.html.advertisers && elementDisplay(advertisers, false);
!config.html.footer && elementDisplay(footer, false);
//...

function elementDisplay(element, display, mode = 'block') {
    if (!element) return;
    element.style.display = display ? mode : 'none';
}
