'use strict';

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.async = true;
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function googleTranslateElementInit() {
    new google.translate.TranslateElement(
        {
            pageLanguage: 'en',
            autoDisplay: false,
        },
        'google_translate_element',
    );

    const language = BRAND?.app?.language || 'en';

    console.log('Language', language);

    if (language === 'en') return; // No need to switch if default is 'en'

    const observer = new MutationObserver(() => {
        const select = document.querySelector('.goog-te-combo');
        if (select) {
            select.value = language;
            select.dispatchEvent(new Event('change'));
            observer.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

(async function initGoogleTranslate() {
    try {
        await loadScript('https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit');
    } catch (error) {
        console.error('Failed to load Google Translate script:', error);
    }
})();
