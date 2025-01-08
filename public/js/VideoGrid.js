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

    // loop (i recommend you optimize this)
    let i = 1;
    while (i < 5000) {
        let w = Area(i, Cameras.length, Width, Height, Margin);
        if (w === false) {
            max = i - 1;
            break;
        }
        i++;
    }

    max = max - Margin * 2;
    setWidth(Cameras, max, bigWidth, Margin, Height, isOneVideoElement);
    document.documentElement.style.setProperty('--vmi-wh', max / 3 + 'px');
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
// RESPONSIVE MAIN BUTTONS
// ####################################################

const mainButtonsBar = document.querySelectorAll('#control button');
const mainButtonsIcon = document.querySelectorAll('#control button i');

function resizeMainButtons() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const isButtonsBarVertical = BtnsBarPosition.selectedIndex === 0;
    //console.log('Window size', { width: windowWidth, height: windowWidth});
    if (isButtonsBarVertical) {
        // Main buttons vertical align
        if (windowHeight <= MOBILE_BREAKPOINT) {
            setStyles(mainButtonsBar, '0.7rem', '4px', mainButtonsIcon, '0.8rem', '40px');
        } else if (windowHeight <= TABLET_BREAKPOINT) {
            setStyles(mainButtonsBar, '0.9rem', '4px', mainButtonsIcon, '1rem', '45px');
        } else if (windowHeight <= DESKTOP_BREAKPOINT) {
            setStyles(mainButtonsBar, '1rem', '5px', mainButtonsIcon, '1.1rem', '50px');
        } else {
            // > DESKTOP_BREAKPOINT
            setStyles(mainButtonsBar, '1rem', '10px', mainButtonsIcon, '1.2rem', '60px');
        }
    } else {
        // Main buttons horizontal align
        if (windowWidth <= MOBILE_BREAKPOINT) {
            setStyles(mainButtonsBar, '0.7rem', '4px', mainButtonsIcon, '0.8rem');
        } else if (windowWidth <= TABLET_BREAKPOINT) {
            setStyles(mainButtonsBar, '0.9rem', '4px', mainButtonsIcon, '1rem');
        } else if (windowWidth <= DESKTOP_BREAKPOINT) {
            setStyles(mainButtonsBar, '1rem', '5px', mainButtonsIcon, '1.1rem');
        } else {
            // > DESKTOP_BREAKPOINT
            setStyles(mainButtonsBar, '1rem', '10px', mainButtonsIcon, '1.2rem');
        }
    }
    //
    function setStyles(elements, fontSize, padding, icons, fontSizeIcon, bWidth = null) {
        if (bWidth) document.documentElement.style.setProperty('--btns-width', bWidth);

        elements.forEach(function (element) {
            element.style.fontSize = fontSize;
            element.style.padding = padding;
        });
        icons.forEach(function (icon) {
            icon.style.fontSize = fontSizeIcon;
        });
    }
}

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
        resizeMainButtons();
        window.onresize = function () {
            resizeVideoMedia();
            resizeMainButtons();
            resizeChatRoom();
            resizeTranscriptionRoom();
        };
    },
    false,
);
