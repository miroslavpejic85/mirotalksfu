'use strict';

let customRatio = true;

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
    let Margin = 3;
    let Scenary = document.getElementById('videoMediaContainer');
    let Width = Scenary.offsetWidth - Margin * 2;
    let bigWidth = Width*3/4;
    let Height = Scenary.offsetHeight - Margin * 2;
    let Cameras = document.getElementsByClassName('Camera');
    let Pins = document.getElementsByClassName('pinned');
    let StartScreenButton = document.getElementById('startScreenButton');
    let StopScreenButton = document.getElementById('stopScreenButton');
    let elem = null;
    var WeAreInScreenSharing = false;

    // determine if something is pinned
    if(Pins && Pins.length > 0)
    {
        elem = Pins[0];
        Width = Width - bigWidth;
    }

    let max = 0;

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
    setWidth(max, Margin, elem, bigWidth, Height);
}

function setWidth(width, margin, elem = null, bigWidth=null, maxHeigth=null) {
    ratio = customRatio ? 0.68 : ratio;
    let Cameras = document.getElementsByClassName('Camera');
    for (let s = 0; s < Cameras.length; s++) {

        //if(elem == null)
        //{
            Cameras[s].style.width = width + 'px';
            Cameras[s].style.margin = margin + 'px';
            Cameras[s].style.height = width * ratio + 'px';
        //}
        //else
        //{
          //  Cameras[s].style.width = width/2 + 'px';
          //  Cameras[s].style.margin = margin + 'px';
          //  Cameras[s].style.height = width/2 * ratio + 'px';
        //}

        if(elem && Cameras[s] == elem)
        {
            Cameras[s].style.width = bigWidth + 'px';
            Cameras[s].style.height = bigWidth * ratio + 'px';   
            var newStr = Cameras[s].style.height.substring(0, Cameras[s].style.height.length - 2); // get rid of px substring, last two characters...
            if(newStr >= maxHeigth)
                Cameras[s].style.height = maxHeigth - 2 + 'px';
        }
    }
}

window.addEventListener(
    'load',
    function (event) {
        resizeVideoMedia();
        window.onresize = resizeVideoMedia;
    },
    false,
);
