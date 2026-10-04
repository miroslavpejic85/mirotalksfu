'use strict';

function popup(icon, text, position = 'top-end') {
    return showSwalToast({
        background: '#1D2026',
        toast: true,
        position,
        icon: icon,
        title: `${icon.charAt(0).toUpperCase()}${icon.slice(1)}`,
        text: text,
        color: '#FFFFFF',
        showCloseButton: true,
        showConfirmButton: false,
        timer: 5000,
        timerProgressBar: true,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });
}
//...
