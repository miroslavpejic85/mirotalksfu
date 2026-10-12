'use strict';

const status = document.getElementById('copy-status');

async function copy(btn) {
    // Copy an explicit value (data-copy-text) or the content of another element (data-copy-target)
    const el = btn.dataset.copyTarget ? document.getElementById(btn.dataset.copyTarget) : null;
    const text = btn.dataset.copyText ?? el?.value ?? el?.textContent ?? '';

    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    // Fallback for non-secure contexts (plain http)
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('copy failed');
}

document.querySelectorAll('[data-copy-target], [data-copy-text]').forEach((btn) => {
    const label = btn.textContent;
    let timer;
    btn.addEventListener('click', async () => {
        clearTimeout(timer);
        try {
            await copy(btn);
            btn.textContent = '\u2713 Copied';
            btn.classList.add('copied');
            status.textContent = 'Copied to clipboard';
        } catch {
            btn.textContent = 'Press Ctrl+C';
            status.textContent = 'Copy failed, select the text and press Ctrl+C';
        }
        timer = setTimeout(() => {
            btn.textContent = label;
            btn.classList.remove('copied');
            status.textContent = '';
        }, 1800);
    });
});

// Show the macOS permissions note only to Mac users
const platform = navigator.userAgentData?.platform || navigator.platform || '';
if (/mac/i.test(platform) && !/iphone|ipad/i.test(navigator.userAgent)) {
    document.querySelectorAll('.mac-only').forEach((el) => (el.hidden = false));
}

// Tell visitors which RustDesk file to pick for their system
const ua = navigator.userAgent;
const hints = [
    [
        /android/i,
        'Android detected: install RustDesk from',
        'Google Play',
        'https://play.google.com/store/apps/details?id=com.carriez.flutter_hbb',
    ],
    [
        /iphone|ipad/i,
        'iPhone/iPad detected: install RustDesk from the',
        'App Store',
        'https://apps.apple.com/app/rustdesk-remote-desktop/id1581225015',
    ],
    [/windows/i, 'Windows detected: on the download page choose the installer ending in .exe (x86_64).'],
    [/mac/i, 'macOS detected: choose the file ending in .dmg (aarch64 for Apple Silicon, x86_64 for Intel).'],
    [/linux/i, 'Linux detected: choose the .deb (Debian/Ubuntu), .rpm (Fedora) or .AppImage file.'],
];
const hint = hints.find(([re]) => re.test(ua));
const hintEl = document.getElementById('os-hint');
if (hint && hintEl) {
    const [, text, linkText, href] = hint;
    hintEl.textContent = text;
    if (href) {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = linkText;
        hintEl.append(' ', a, '.');
    }
    hintEl.hidden = false;
}
