'use strict';

// ####################################################
// RESPONSIVE PARTICIPANTS VIEW
// ####################################################

let customRatio = true;
let isHideALLVideosActive = false;

// aspect       0      1      2      3       4
let ratios = ['0:0', '4:3', '16:9', '1:1', '1:2'];
let aspect = 2;

let ratio = getAspectRatio();

function getAspectRatio() {
    customRatio = aspect == 0 ? true : false;
    var ratio = ratios[aspect].split(':');
    return ratio[1] / ratio[0];
}

function setAspectRatio(i) {
    aspect = i;
    ratio = getAspectRatio();
    resizeVideoMedia();
}

function Area(Increment, Count, Width, Height, Margin = 10) {
    ratio = customRatio ? 0.75 : ratio;
    let i = 0;
    let w = 0;
    let h = Increment * ratio + Margin * 2;
    while (i < Count) {
        if (w + Increment > Width) {
            w = 0;
            h = h + Increment * ratio + Margin * 2;
        }
        w = w + Increment + Margin * 2;
        i++;
    }
    if (h > Height) return false;
    else return Increment;
}

function resizeVideoMedia() {
    if (isHideALLVideosActive) return;

    let Margin = 5;
    let videoMediaContainer = document.getElementById('videoMediaContainer');
    let Cameras = getVisibleCameraElements();
    let Width = videoMediaContainer.offsetWidth - Margin * 2;
    // The bottom padding is the space reserved for the buttons bar (see syncButtonsBarReserve)
    let reservedHeight = parseFloat(getComputedStyle(videoMediaContainer).paddingBottom) || 0;
    let Height = videoMediaContainer.offsetHeight - reservedHeight - Margin * 2;
    let max = 0;
    let isOneVideoElement = Cameras.length === 1;
    let isPinnedSingleVideo = isOneVideoElement && typeof rc !== 'undefined' && rc.isVideoPinned;
    let expandSingleVideo = isOneVideoElement && !isPinnedSingleVideo;

    // console.log('videoMediaContainer.childElementCount', {
    //     isOneVideoElement: isOneVideoElement,
    //     children: videoMediaContainer.childElementCount,
    // });

    // full screen mode
    let bigWidth = Width * 4;
    if (expandSingleVideo) {
        Width = Width - bigWidth;
    }

    resetZoom();

    if (layoutScreenStage(videoMediaContainer, Cameras, Width, Height, Margin)) {
        if (typeof VideoDrawingOverlay !== 'undefined') VideoDrawingOverlay.resizeAll();
        return;
    }

    // Optimized: binary search for best tile size
    let low = 1;
    let high = Math.min(Width, Height);
    if (isPinnedSingleVideo) {
        const tileRatio = customRatio ? 0.75 : ratio;
        high = Math.min(Width, Math.floor((Height - Margin * 2) / tileRatio));
    }
    let best = 1;
    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        let w = Area(mid, Cameras.length, Width, Height, Margin);
        if (w !== false) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    max = best - Margin * 2;
    setWidth(Cameras, max, bigWidth, Margin, Height, expandSingleVideo);

    // When alone, use fixed avatar size; otherwise proportional to tile
    const avatarSize = expandSingleVideo ? Math.min(200, Math.max(120, Height * 0.25)) : max / 3;
    document.documentElement.style.setProperty('--vmi-wh', avatarSize + 'px');

    // Resize any active drawing overlays to match new tile dimensions
    if (typeof VideoDrawingOverlay !== 'undefined') {
        VideoDrawingOverlay.resizeAll();
    }
}

/**
 * Mobile viewers: a screen share fills the stage and the other tiles become a small strip below it
 * (hidden in landscape, so the presentation gets the whole screen).
 * @returns {boolean} true if the stage layout was applied
 */
function layoutScreenStage(container, Cameras, Width, Height, Margin) {
    const isMobile = typeof isMobileDevice !== 'undefined' && isMobileDevice;
    const stage = isMobile ? Cameras.find((c) => c.dataset.mediaType === mediaType.screen) : null;

    if (!stage) {
        if (container.classList.contains('screen-stage')) {
            container.classList.remove('screen-stage', 'screen-stage-landscape');
            Cameras.forEach((c) => c.removeAttribute('data-screen-stage'));
        }
        return false;
    }

    const others = Cameras.filter((c) => c !== stage);
    const landscape = Width > Height;
    const showStrip = !landscape && others.length > 0;

    container.classList.add('screen-stage');
    container.classList.toggle('screen-stage-landscape', landscape);
    Cameras.forEach((c) => c.removeAttribute('data-screen-stage'));
    stage.dataset.screenStage = 'main';

    let thumbW = 0;
    let stripHeight = 0;
    if (showStrip) {
        const perRow = Math.max(1, Math.floor(Width / (90 + Margin * 2)));
        const rows = Math.min(2, Math.ceil(others.length / perRow));
        thumbW = Math.min(120, Math.floor(Width / Math.min(perRow, others.length)) - Margin * 2);
        const thumbH = Math.round(thumbW * 0.75);
        stripHeight = rows * (thumbH + Margin * 2);
        others.forEach((c) => {
            c.style.width = thumbW + 'px';
            c.style.height = thumbH + 'px';
            c.style.margin = Margin + 'px';
        });
    }

    stage.style.width = Width + 'px';
    stage.style.height = Math.max(0, Height - stripHeight) + 'px';
    stage.style.margin = Margin + 'px';

    document.documentElement.style.setProperty('--vmi-wh', Math.max(32, thumbW / 3) + 'px');
    return true;
}

let layoutAnimationRaf = null;

/**
 * Check if the user asked the system to reduce motion
 * @returns {boolean}
 */
function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Smoothly re-layout the video grid while a side panel (chat, transcription, ...) is pinned/unpinned.
 * The CSS transition (see .layout-animating) glides the containers, and the tiles
 * are recomputed every frame so they always follow the container's current size.
 * Call it right BEFORE changing the containers' size, so the transition kicks in.
 * @param {number} duration animation length in ms (keep in sync with .layout-animating in VideoGrid.css)
 */
function animateVideoLayout(duration = 240) {
    if (prefersReducedMotion()) return;
    const root = document.documentElement;
    root.classList.add('layout-animating');
    cancelAnimationFrame(layoutAnimationRaf);
    const end = performance.now() + duration + 60;
    const step = (now) => {
        resizeVideoMedia();
        if (now < end) {
            layoutAnimationRaf = requestAnimationFrame(step);
        } else {
            root.classList.remove('layout-animating');
            resizeVideoMedia();
        }
    };
    layoutAnimationRaf = requestAnimationFrame(step);
}

function getVisibleCameraElements() {
    return Array.from(document.getElementsByClassName('Camera')).filter((camera) => camera.style.display !== 'none');
}

function resetZoom() {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach((video) => {
        // Touch-zoomed screen share (ScreenTouchZoom.js) keeps its own transform
        if (video.dataset.touchZoomed) return;
        video.style.transform = '';
        video.style.transformOrigin = 'center';
    });
}

function setWidth(Cameras, width, bigWidth, margin, maxHeight, isOneVideoElement) {
    ratio = customRatio ? 0.68 : ratio;
    for (let s = 0; s < Cameras.length; s++) {
        Cameras[s].style.width = width + 'px';
        Cameras[s].style.margin = margin + 'px';
        Cameras[s].style.height = width * ratio + 'px';
        if (isOneVideoElement) {
            Cameras[s].style.width = bigWidth + 'px';
            Cameras[s].style.height = bigWidth * ratio + 'px';
            let camHeigh = Cameras[s].style.height.substring(0, Cameras[s].style.height.length - 2);
            if (camHeigh >= maxHeight) Cameras[s].style.height = maxHeight - 2 + 'px';
        }
    }
}

// ####################################################
// BREAKPOINTS
// ####################################################

const MOBILE_BREAKPOINT = 500;
const TABLET_BREAKPOINT = 580;
// Floating panel size (800x700 chat, 420x680 transcription) + ~30px margin
const CHAT_BREAKPOINT_WIDTH = 830;
const CHAT_BREAKPOINT_HEIGHT = 730;
const TRANSCRIPTION_BREAKPOINT_WIDTH = 680;
const TRANSCRIPTION_BREAKPOINT_HEIGHT = 710;

function isSmallScreen(maxWidth, maxHeight) {
    return window.innerWidth <= maxWidth || window.innerHeight <= maxHeight;
}

// ####################################################
// RESPONSIVE CHAT
// ####################################################

let isChatSmallScreen = null;

/**
 * Fit the floating chat to the window.
 * On window resize it only acts when a breakpoint is crossed, so the user's
 * position/maximize choice is kept and the animation is not restarted every frame.
 * @param {boolean} force apply even if no breakpoint was crossed (open/unpin)
 */
function resizeChatRoom(force = false) {
    if (!rc || rc.isMobileDevice || !rc.isChatOpen || rc.isChatPinned) return;

    const isSmall = isSmallScreen(CHAT_BREAKPOINT_WIDTH, CHAT_BREAKPOINT_HEIGHT);
    if (!force && isSmall === isChatSmallScreen) return;
    isChatSmallScreen = isSmall;

    isSmall ? rc.chatMaximize() : rc.chatMinimize();
}

// ####################################################
// RESPONSIVE TRANSCRIPTION
// ####################################################

let isTranscriptionSmallScreen = null;

/**
 * Fit the floating transcription panel to the window (see resizeChatRoom).
 * @param {boolean} force apply even if no breakpoint was crossed (open/unpin)
 */
function resizeTranscriptionRoom(force = false) {
    if (
        isMobileDevice ||
        !Boolean(transcription.speechTranscription) ||
        transcription.isHidden ||
        transcription.isPinned
    )
        return;

    const isSmall = isSmallScreen(TRANSCRIPTION_BREAKPOINT_WIDTH, TRANSCRIPTION_BREAKPOINT_HEIGHT);
    if (!force && isSmall === isTranscriptionSmallScreen) return;
    isTranscriptionSmallScreen = isSmall;

    isSmall ? transcription.maximize() : transcription.minimize();
}

// ####################################################
// WINDOW LOAD/RESIZE EVENT
// ####################################################

window.addEventListener(
    'load',
    function (event) {
        resizeVideoMedia();
        let resizeTimeout;
        window.addEventListener('resize', function () {
            if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
            resizeTimeout = requestAnimationFrame(function () {
                resizeVideoMedia();
                resizeChatRoom();
                resizeTranscriptionRoom();
            });
        });
    },
    false
);
