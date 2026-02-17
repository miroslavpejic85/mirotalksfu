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
    let Cameras = document.getElementsByClassName('Camera');
    let Width = videoMediaContainer.offsetWidth - Margin * 2;
    let Height = videoMediaContainer.offsetHeight - Margin * 2;
    let max = 0;
    let optional = isHideMeActive && videoMediaContainer.childElementCount <= 2 ? 1 : 0;
    let isOneVideoElement = videoMediaContainer.childElementCount - optional == 1 ? true : false;

    // console.log('videoMediaContainer.childElementCount', {
    //     isOneVideoElement: isOneVideoElement,
    //     children: videoMediaContainer.childElementCount,
    //     optional: optional,
    // });

    // full screen mode
    let bigWidth = Width * 4;
    if (isOneVideoElement) {
        Width = Width - bigWidth;
    }

    resetZoom();

    // Optimized: binary search for best tile size
    let low = 1;
    let high = Math.min(Width, Height);
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
    setWidth(Cameras, max, bigWidth, Margin, Height, isOneVideoElement);

    // When alone, use fixed avatar size; otherwise proportional to tile
    const avatarSize = isOneVideoElement ? Math.min(200, Math.max(120, Height * 0.25)) : max / 3;
    document.documentElement.style.setProperty('--vmi-wh', avatarSize + 'px');

    // Resize any active drawing overlays to match new tile dimensions
    if (typeof VideoDrawingOverlay !== 'undefined') {
        VideoDrawingOverlay.resizeAll();
    }
}

function resetZoom() {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach((video) => {
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
const DESKTOP_BREAKPOINT = 730;
const CUSTOM_BREAKPOINT = 680;

// ####################################################
// RESPONSIVE CHAT
// ####################################################

function resizeChatRoom() {
    if (!rc || rc.isMobileDevice || !rc.isChatOpen || rc.isChatPinned) return;

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    windowWidth <= DESKTOP_BREAKPOINT || windowHeight <= DESKTOP_BREAKPOINT ? rc.chatMaximize() : rc.chatMinimize();
}

// ####################################################
// RESPONSIVE TRANSCRIPTION
// ####################################################

function resizeTranscriptionRoom() {
    if (
        isMobileDevice ||
        !Boolean(transcription.speechTranscription) ||
        transcription.isHidden ||
        transcription.isPinned
    )
        return;

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    windowWidth <= CUSTOM_BREAKPOINT || windowHeight <= CUSTOM_BREAKPOINT
        ? transcription.maximize()
        : transcription.minimize();
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
