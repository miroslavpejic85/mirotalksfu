'use strict';

// ####################################################
// SCHEDULE MEETING (landing, newroom & login pages)
// ####################################################

let scheduleMeetingTemplateHtml = null;

function showScheduleSwal(options) {
    return Swal.fire({
        background: '#1D2026',
        color: '#FFFFFF',
        confirmButtonColor: '#0270D7',
        customClass: { popup: 'sch-popup', confirmButton: 'sch-btn', cancelButton: 'sch-btn' },
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        ...options,
    });
}

function loadScheduleMeetingAssets() {
    const assets = [
        { tag: 'link', rel: 'stylesheet', href: '../css/ScheduleMeeting.css' },
        { tag: 'link', rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css' },
        { tag: 'link', rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css' },
    ];
    assets.forEach(({ tag, rel, href }) => {
        const el = document.createElement(tag);
        el.rel = rel;
        el.href = href;
        document.head.appendChild(el);
    });
    if (typeof flatpickr === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/flatpickr';
        document.head.appendChild(script);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const scheduleBtn = document.getElementById('scheduleMeetingBtn');
    if (!scheduleBtn) return;

    fetch('/isScheduleMeetingEnabled')
        .then((res) => res.json())
        .then((data) => {
            if (data.enabled) {
                scheduleBtn.hidden = false;
                const divider = document.getElementById('scheduleMeetingDivider');
                if (divider) divider.hidden = false;
                // Load CSS/JS dependencies and pre-fetch template
                loadScheduleMeetingAssets();
                fetch('../views/scheduleMeeting.html')
                    .then((res) => res.text())
                    .then((html) => (scheduleMeetingTemplateHtml = html))
                    .catch((err) => console.error('Failed to load schedule meeting template', err));
            }
        })
        .catch((err) => console.error('Failed to load feature flags', err));

    scheduleBtn.addEventListener('click', () => {
        openScheduleModal();
    });
});

function openScheduleModal() {
    if (!scheduleMeetingTemplateHtml) {
        console.error('Schedule meeting template not loaded');
        return;
    }

    // Get room name from landing/newroom (#roomName) or login page (#customRoomInput / #selectRoom)
    const customRoomInput = document.getElementById('customRoomInput');
    const roomEl =
        document.getElementById('roomName') ||
        (customRoomInput && customRoomInput.offsetParent !== null ? customRoomInput : null) ||
        document.getElementById('selectRoom');
    const roomName = roomEl ? filterXSS(roomEl.value.trim()) : '';

    const container = document.createElement('div');
    container.innerHTML = scheduleMeetingTemplateHtml;

    if (roomName) {
        container.querySelector('#schRoomName').setAttribute('value', roomName);
    }

    showScheduleSwal({
        allowOutsideClick: false,
        allowEscapeKey: true,
        position: 'center',
        title: '<i class="fas fa-calendar-check" style="margin-right:8px;color:rgba(59,130,246,0.9)"></i> Schedule Meeting',
        html: container.innerHTML,
        confirmButtonText: '<i class="fas fa-paper-plane"></i> Send Invitations',
        showCancelButton: true,
        cancelButtonColor: '#dc3545',
        didOpen: () => {
            flatpickr('#schDateTime', {
                enableTime: true,
                dateFormat: 'Y-m-d H:i',
                time_24hr: true,
                minDate: 'today',
            });
        },
        preConfirm: () => {
            const title = document.getElementById('schTitle').value.trim();
            const description = document.getElementById('schDescription').value.trim();
            const schRoomName = document.getElementById('schRoomName').value.trim();
            const dateTime = document.getElementById('schDateTime').value.trim();
            const duration = document.getElementById('schDuration').value.trim();
            const recipients = document.getElementById('schRecipients').value.trim();

            if (!title) {
                Swal.showValidationMessage('Meeting title is required');
                return false;
            }
            if (!schRoomName) {
                Swal.showValidationMessage('Room name is required');
                return false;
            }
            if (!dateTime) {
                Swal.showValidationMessage('Date and time is required');
                return false;
            }
            if (!duration || parseInt(duration) < 5) {
                Swal.showValidationMessage('Duration must be at least 5 minutes');
                return false;
            }
            if (!recipients) {
                Swal.showValidationMessage('At least one recipient email is required');
                return false;
            }

            return { title, description, roomName: schRoomName, dateTime, duration, recipients };
        },
    }).then(async (result) => {
        if (result.isConfirmed && result.value) {
            await sendScheduleMeeting(result.value);
        }
    });
}

async function sendScheduleMeeting(data) {
    try {
        showScheduleSwal({
            title: 'Sending invitations...',
            allowOutsideClick: false,
            showClass: {},
            hideClass: {},
            didOpen: () => Swal.showLoading(),
        });

        const res = await fetch('/scheduleMeeting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        const result = await res.json();

        if (res.ok) {
            showScheduleSwal({
                icon: 'success',
                title: 'Invitations Sent!',
                text: result.message,
            });
        } else {
            showScheduleSwal({
                icon: 'error',
                title: 'Failed',
                text: result.message || 'Failed to send invitations',
            });
        }
    } catch (err) {
        console.error('Schedule meeting error', err);
        showScheduleSwal({
            icon: 'error',
            title: 'Error',
            text: 'Failed to send meeting invitations',
        });
    }
}
