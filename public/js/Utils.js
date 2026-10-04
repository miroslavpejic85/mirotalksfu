'use strict';

function popup(icon, text, position = 'top') {
    Swal.fire({
        background: '#1D2026',
        position: position,
        icon: icon,
        text: text,
        color: '#FFFFFF',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });
}
//...
