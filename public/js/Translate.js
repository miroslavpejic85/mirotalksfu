'use strict';

const script = document.createElement('script');
script.setAttribute('async', '');
script.setAttribute('src', 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit');
document.head.appendChild(script);

function googleTranslateElementInit() {
    new google.translate.TranslateElement(
        {
            pageLanguage: 'en',
            autoDisplay: false,
        },
        'google_translate_element',
    );

    const interval = setInterval(() => {
        const language = BRAND.app.language ? BRAND.app.language : 'en';

        if (language === 'en') {
            clearInterval(interval);
        }

        const select = document.querySelector('.goog-te-combo');
        if (select) {
            select.value = language;
            select.dispatchEvent(new Event('change'));
            clearInterval(interval);
        }
    }, 500);
}
