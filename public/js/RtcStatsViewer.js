'use strict';

// MiroTalk RTCStats viewer: lists the built-in collector dumps (API key protected) and explains any
// RTCStats / webrtc-internals dump. Parsing: rtcstats-shared (MIT), charts: uPlot (MIT),
// health rules: RtcStatsAnalyzer.js.

const API_KEY_STORAGE = 'rtcStatsViewerApiKey';
const CHART_HEIGHT = 220;
const COLORS = ['#3b82f6', '#22c55e', '#fbbf24', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#ec4899', '#84cc16'];

const STATUS_TEXT = { good: 'Good', fair: 'Fair', poor: 'Poor' };
const VERDICT = {
    good: {
        icon: 'fa-circle-check',
        title: 'Good call quality',
        sub: 'No problems were detected for this participant.',
    },
    fair: {
        icon: 'fa-triangle-exclamation',
        title: 'Some issues detected',
        sub: 'The call worked, but quality was affected.',
    },
    poor: { icon: 'fa-circle-xmark', title: 'Problems detected', sub: 'This participant likely had a bad experience.' },
};
const SEVERITY_ICON = {
    critical: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
    good: 'fa-circle-check',
};
const METRIC_HELP = {
    bitrate: 'Average media bitrate. It depends on resolution and content, so it is not good or bad by itself.',
    mos: 'Estimated voice quality (MOS, ITU-T E-model) from latency, jitter and packet loss. 4.0 or more is good, below 3.5 is poor.',
    rtt: 'Round trip time: how long a packet takes to reach the server and come back. Below 150 ms is good, above 300 ms feels delayed.',
    packetLoss: 'Share of packets lost on the network. Below 1% is good, above 5% is clearly noticeable.',
    jitter: 'Variation of the packet arrival time. Below 30 ms is good.',
    fps: 'Video frames per second. 15 or more looks smooth for meetings, below 10 looks choppy.',
    resolution: 'Video resolution at the end of the call.',
};
const $ = (id) => document.getElementById(id);

const state = {
    dumps: [],
    selectedDump: null, // server dump being viewed (for download)
    analysis: null,
    activeTab: 'overview',
    charts: [],
};

// ####################################################
// DOM HELPERS (dump data is untrusted: text nodes only)
// ####################################################

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child === undefined || child === null || child === false) continue;
        node.append(child instanceof Node ? child : String(child));
    }
    return node;
}

function icon(name, title) {
    return el('i', { className: `fa-solid ${name}`, title });
}

function showNotice(id, message, isError = false) {
    const node = $(id);
    node.textContent = message || '';
    node.classList.toggle('error', isError);
    node.hidden = !message;
}

function card(title, iconName, ...children) {
    return el('div', { className: 'card' }, el('h2', { className: 'card-title' }, icon(iconName), title), ...children);
}

function pill(status, text) {
    return el('span', { className: `pill ${status || 'none'}`, text: text || STATUS_TEXT[status] || 'N/A' });
}

// ####################################################
// FORMATTING
// ####################################################

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

function formatBytes(bytes) {
    if (!isNum(bytes)) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatDuration(ms) {
    if (!isNum(ms) || ms < 0) return '-';
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(ms) {
    return isNum(ms) ? new Date(ms).toLocaleString() : '-';
}

function formatTime(ms) {
    return isNum(ms) ? new Date(ms).toLocaleTimeString() : '-';
}

function formatOffset(ms) {
    if (!isNum(ms)) return '';
    const sign = ms < 0 ? '-' : '+';
    const abs = Math.abs(ms);
    const m = Math.floor(abs / 60000);
    const s = ((abs % 60000) / 1000).toFixed(3).padStart(6, '0');
    return `${sign}${String(m).padStart(2, '0')}:${s}`;
}

function formatNumber(value) {
    if (!isNum(value)) return '-';
    const abs = Math.abs(value);
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 1) return value.toFixed(2).replace(/\.?0+$/, '');
    return value.toFixed(4).replace(/\.?0+$/, '') || '0';
}

function formatBitrate(kbps) {
    if (!isNum(kbps)) return '-';
    return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbps` : `${kbps.toFixed(1)} kbps`;
}

function formatMetric(metric, value) {
    if (!isNum(value)) return '-';
    switch (metric) {
        case 'packetLoss':
            return `${value.toFixed(value < 10 ? 2 : 1)} %`;
        case 'rtt':
        case 'jitter':
            return `${Math.round(value)} ms`;
        case 'mos':
            return `${value.toFixed(1)} / 4.5`;
        case 'fps':
            return `${Math.round(value)} fps`;
        case 'bitrate':
            return formatBitrate(value);
        default:
            return formatNumber(value);
    }
}

function stringify(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch (err) {
        return String(value);
    }
}

function connectivityText(connectivity) {
    if (!connectivity) return '-';
    const path = connectivity.relayed ? 'Relay (TURN)' : 'Direct';
    return `${path} / ${(connectivity.protocol || '?').toUpperCase()}${connectivity.ipVersion ? ` · ${connectivity.ipVersion}` : ''}`;
}

// ####################################################
// SERVER DUMPS (API key protected)
// ####################################################

function getApiKey() {
    return sessionStorage.getItem(API_KEY_STORAGE) || '';
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        cache: 'no-store',
        headers: { authorization: getApiKey(), ...(options.headers || {}) },
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.error || body.message || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response;
}

const dumpUrl = (name) => `/rtcstats/dumps/${encodeURIComponent(name)}`;

const AUTO_REFRESH_MS = 10000;
const AUTO_REFRESH_STORAGE = 'rtcStatsViewerAutoRefresh';

function setSignedIn(signedIn) {
    $('authForm').hidden = signedIn;
    $('dumpsPanel').hidden = !signedIn;
    $('listActions').hidden = !signedIn;
    if (!signedIn) $('deleteAllBtn').hidden = true;
}

// silent: background refresh (keeps the current notice, redraws only when the list changed)
async function loadDumps({ silent = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    $('refreshBtn').classList.add('loading');
    if (!silent) showNotice('serverNotice', '');
    try {
        const { dumps, mode, enabled } = await (await api('/rtcstats/dumps')).json();
        const next = Array.isArray(dumps) ? dumps : [];
        const signature = JSON.stringify(next.map((d) => [d.name, d.size, d.modified, d.active]));
        const changed = signature !== state.dumpsSignature;
        state.dumps = next;
        state.dumpsSignature = signature;
        state.lastUpdated = Date.now();
        setSignedIn(true);
        $('deleteAllBtn').hidden = !state.dumps.some((dump) => !dump.active);
        $('lastUpdated').textContent = `Updated ${formatTime(state.lastUpdated)}`;
        if (changed || !silent) renderDumps();
        if (mode === 'external' && !state.dumps.length) {
            showNotice(
                'serverNotice',
                'RTCSTATS_URL is set: dumps appear here once a call ends, as long as the rtcstats-server writes to the same folder (mounted by docker-compose-rtcstats.yml). Otherwise open them with "Open file".'
            );
        } else if (!enabled && !state.dumps.length) {
            showNotice('serverNotice', 'RTCStats is disabled (RTCSTATS_ENABLED=false).');
        } else if (silent && $('serverNotice').classList.contains('error')) {
            // A previous background refresh failed (e.g. server restart): clear it once it works again
            showNotice('serverNotice', '');
        }
    } catch (err) {
        if (err.status === 401 || err.status === 403) {
            sessionStorage.removeItem(API_KEY_STORAGE);
            state.dumpsSignature = null;
            setSignedIn(false);
        }
        showNotice('serverNotice', err.message, true);
    } finally {
        state.loading = false;
        $('refreshBtn').classList.remove('loading');
    }
}

function canAutoRefresh() {
    return (
        $('autoRefresh').checked &&
        getApiKey() &&
        !$('libraryView').hidden &&
        !$('dumpsPanel').hidden &&
        !document.hidden &&
        !document.querySelector('.modal-backdrop')
    );
}

function initAutoRefresh() {
    const toggle = $('autoRefresh');
    toggle.checked = localStorage.getItem(AUTO_REFRESH_STORAGE) !== 'false';
    toggle.addEventListener('change', () => {
        localStorage.setItem(AUTO_REFRESH_STORAGE, String(toggle.checked));
        if (canAutoRefresh()) loadDumps({ silent: true });
    });
    setInterval(() => canAutoRefresh() && loadDumps({ silent: true }), AUTO_REFRESH_MS);
    // Catch up immediately when the tab becomes visible again
    document.addEventListener('visibilitychange', () => {
        if (canAutoRefresh() && Date.now() - (state.lastUpdated || 0) > AUTO_REFRESH_MS) loadDumps({ silent: true });
    });
}

function dumpMatches(dump, query) {
    if (!query) return true;
    return [dump.name, dump.conference, dump.user, dump.session, ...(dump.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
}

function renderDumps() {
    const query = $('dumpSearch').value.trim().toLowerCase();
    const visible = state.dumps
        .filter((dump) => dumpMatches(dump, query))
        .sort((a, b) => (b.startTime ?? b.modified) - (a.startTime ?? a.modified));
    $('dumpCount').textContent = `${visible.length} / ${state.dumps.length}`;

    const body = $('dumpsBody');
    body.replaceChildren();
    if (!visible.length) {
        body.append(el('tr', {}, el('td', { colspan: 7, className: 'muted', text: 'No dumps found.' })));
        return;
    }
    for (const dump of visible) {
        const started = isNum(dump.startTime) ? dump.startTime : null;
        const duration = dump.active ? null : started ? dump.modified - started : null;
        body.append(
            el(
                'tr',
                { className: dump.name === state.selectedDump?.name ? 'selected' : '' },
                el('td', { text: formatDate(started ?? dump.modified) }),
                el('td', { text: dump.conference || '-' }),
                el(
                    'td',
                    { title: dump.userAgent || '' },
                    el('div', { className: 'mono', text: dump.user || '-' }),
                    el('div', { className: 'muted mono', text: dump.session || '' })
                ),
                el(
                    'td',
                    {},
                    (dump.tags || []).map((tag) => el('span', { className: 'tag', text: tag }))
                ),
                el(
                    'td',
                    {},
                    dump.active ? el('span', { className: 'tag live', text: 'recording' }) : formatDuration(duration)
                ),
                el('td', { text: formatBytes(dump.size) }),
                el(
                    'td',
                    { className: 'actions' },
                    el(
                        'button',
                        { className: 'btn primary', title: 'Analyze', onclick: () => viewServerDump(dump) },
                        icon('fa-magnifying-glass-chart'),
                        ' Analyze'
                    ),
                    ' ',
                    el(
                        'button',
                        { className: 'btn', title: 'Download', onclick: () => downloadServerDump(dump) },
                        icon('fa-download')
                    ),
                    ' ',
                    el(
                        'button',
                        {
                            className: 'btn danger',
                            title: dump.active ? 'Still recording' : 'Delete',
                            disabled: dump.active,
                            onclick: () => deleteServerDump(dump),
                        },
                        icon('fa-trash')
                    )
                )
            )
        );
    }
}

async function fetchDumpBlob(dump) {
    return (await api(dumpUrl(dump.name))).blob();
}

async function viewServerDump(dump) {
    try {
        await openDump(await fetchDumpBlob(dump), dump.name, dump);
    } catch (err) {
        showNotice('viewerNotice', `Unable to open ${dump.name}: ${err.message}`, true);
    }
}

async function downloadServerDump(dump) {
    try {
        const url = URL.createObjectURL(await fetchDumpBlob(dump));
        const name = dump.name.endsWith('.rtcstats.txt') ? dump.name : `${dump.name}.rtcstats.txt`;
        const link = el('a', { href: url, download: name });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        showNotice('serverNotice', `Download failed: ${err.message}`, true);
    }
}

async function deleteServerDump(dump) {
    const confirmed = await confirmDialog({
        title: 'Delete this dump?',
        message: 'The dump will be permanently removed from the server.',
        details: [dump.name, `${dump.conference || '-'} · ${formatBytes(dump.size)}`],
        confirmText: 'Delete',
    });
    if (!confirmed) return;
    try {
        await api(dumpUrl(dump.name), { method: 'DELETE' });
        await loadDumps();
    } catch (err) {
        showNotice('serverNotice', `Delete failed: ${err.message}`, true);
    }
}

async function deleteAllServerDumps() {
    const finished = state.dumps.filter((dump) => !dump.active);
    const recording = state.dumps.length - finished.length;
    if (!finished.length) {
        showNotice('serverNotice', 'There are no finished dumps to delete.');
        return;
    }
    const size = finished.reduce((total, dump) => total + (dump.size || 0), 0);
    const confirmed = await confirmDialog({
        title: `Delete all ${finished.length} dump${finished.length > 1 ? 's' : ''}?`,
        message: 'Every finished dump will be permanently removed from the server. This cannot be undone.',
        details: [
            `${finished.length} dump${finished.length > 1 ? 's' : ''} · ${formatBytes(size)}`,
            recording ? `${recording} dump${recording > 1 ? 's' : ''} still recording will be kept.` : null,
        ],
        confirmText: 'Delete all',
        requireText: 'DELETE',
    });
    if (!confirmed) return;
    try {
        const result = await (await api('/rtcstats/dumps', { method: 'DELETE' })).json();
        await loadDumps();
        showNotice(
            'serverNotice',
            `Deleted ${result.deleted} dump${result.deleted === 1 ? '' : 's'}${result.skipped ? `, kept ${result.skipped} still recording` : ''}.`
        );
    } catch (err) {
        showNotice('serverNotice', `Delete failed: ${err.message}`, true);
    }
}

// Accessible confirmation modal. With requireText the user must type it to enable the action.
function confirmDialog({ title, message, details = [], confirmText = 'Confirm', requireText = null }) {
    return new Promise((resolve) => {
        const previousFocus = document.activeElement;
        const input = requireText
            ? el('input', {
                  type: 'text',
                  className: 'modal-input',
                  placeholder: requireText,
                  autocomplete: 'off',
                  spellcheck: 'false',
                  'aria-label': `Type ${requireText} to confirm`,
              })
            : null;
        const confirmBtn = el(
            'button',
            { className: 'btn danger-solid', disabled: Boolean(requireText) },
            icon('fa-trash-can'),
            ` ${confirmText}`
        );
        const cancelBtn = el('button', { className: 'btn' }, 'Cancel');
        const dialog = el(
            'div',
            {
                className: 'modal',
                role: 'alertdialog',
                'aria-modal': 'true',
                'aria-labelledby': 'modalTitle',
                'aria-describedby': 'modalMessage',
            },
            el('div', { className: 'modal-icon' }, icon('fa-triangle-exclamation')),
            el('h3', { id: 'modalTitle', text: title }),
            el('p', { id: 'modalMessage', className: 'modal-message', text: message }),
            details.filter(Boolean).length
                ? el(
                      'div',
                      { className: 'modal-details' },
                      details.filter(Boolean).map((line) => el('div', { text: line }))
                  )
                : null,
            input
                ? el('label', { className: 'modal-label' }, 'Type ', el('strong', { text: requireText }), ' to confirm')
                : null,
            input,
            el('div', { className: 'modal-actions' }, cancelBtn, confirmBtn)
        );
        const backdrop = el('div', { className: 'modal-backdrop' }, dialog);

        const close = (result) => {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            if (previousFocus?.focus) previousFocus.focus();
            resolve(result);
        };
        const canConfirm = () => !requireText || input.value.trim() === requireText;
        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(false);
            } else if (e.key === 'Enter' && canConfirm() && document.activeElement !== cancelBtn) {
                e.preventDefault();
                close(true);
            } else if (e.key === 'Tab') {
                // Keep the focus inside the dialog
                const focusable = [input, cancelBtn, confirmBtn].filter((node) => node && !node.disabled);
                const index = focusable.indexOf(document.activeElement);
                e.preventDefault();
                focusable[(index + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
            }
        }

        input?.addEventListener('input', () => (confirmBtn.disabled = !canConfirm()));
        cancelBtn.addEventListener('click', () => close(false));
        confirmBtn.addEventListener('click', () => canConfirm() && close(true));
        backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close(false));
        document.addEventListener('keydown', onKey, true);
        document.body.append(backdrop);
        (input || cancelBtn).focus();
    });
}

// ####################################################
// OPEN / NAVIGATION
// ####################################################

async function openDump(blob, name, serverDump = null) {
    showNotice('viewerNotice', '');
    if (!window.rtcstatsShared || !window.uPlot || !window.RtcStatsAnalyzer) {
        throw new Error('Viewer libraries not loaded');
    }
    let data;
    try {
        data = await rtcstatsShared.readDump(blob);
    } catch (err) {
        throw new Error('Unrecognized dump format');
    }
    if (!data || !data.peerConnections || !Object.keys(data.peerConnections).length) {
        throw new Error('Not a valid RTCStats or webrtc-internals dump');
    }
    state.analysis = RtcStatsAnalyzer.analyzeDump(data);
    state.selectedDump = serverDump;
    $('dumpName').textContent = name || 'Dump';
    $('downloadBtn').hidden = !serverDump;
    showAnalysis(true);
    renderTabs('overview');
}

async function openLocalFile(file) {
    if (!file) return;
    try {
        await openDump(file, file.name);
    } catch (err) {
        showNotice('viewerNotice', `Unable to open ${file.name}: ${err.message}`, true);
    }
}

function showAnalysis(visible) {
    $('libraryView').hidden = visible;
    $('analysisView').hidden = !visible;
    if (!visible) {
        destroyCharts();
        state.analysis = null;
        if (state.dumps.length) renderDumps();
    }
    window.scrollTo({ top: 0 });
}

const TABS = [
    { id: 'overview', label: 'Overview', icon: 'fa-gauge-high' },
    { id: 'network', label: 'Network', icon: 'fa-network-wired' },
    { id: 'media', label: 'Media', icon: 'fa-photo-film' },
    { id: 'client', label: 'Client', icon: 'fa-laptop' },
    { id: 'logs', label: 'Logs', icon: 'fa-list' },
    { id: 'advanced', label: 'Advanced', icon: 'fa-flask' },
];

function tabBadge(id, analysis) {
    const issues = analysis.observations.filter((o) => ['critical', 'warning'].includes(o.severity));
    switch (id) {
        case 'overview':
            if (!issues.length) return null;
            return {
                text: issues.length,
                className: issues.some((o) => o.severity === 'critical') ? 'critical' : 'warning',
            };
        case 'network':
            return { text: mediaConnections(analysis).length };
        case 'media':
            return { text: analysis.streams.length };
        case 'client':
            return { text: analysis.client.media.length };
        case 'logs':
            return { text: allEvents(analysis).length };
        default:
            return null;
    }
}

function renderTabs(activeTab) {
    state.activeTab = activeTab;
    const analysis = state.analysis;
    $('tabs').replaceChildren(
        ...TABS.map((tab) => {
            const badge = tabBadge(tab.id, analysis);
            return el(
                'button',
                {
                    className: `tab${tab.id === activeTab ? ' active' : ''}`,
                    role: 'tab',
                    'aria-selected': tab.id === activeTab ? 'true' : 'false',
                    onclick: () => renderTabs(tab.id),
                },
                icon(tab.icon),
                tab.label,
                badge ? el('span', { className: `badge ${badge.className || ''}`, text: String(badge.text) }) : null
            );
        })
    );
    destroyCharts();
    const content = $('tabContent');
    content.replaceChildren();
    const render = {
        overview: renderOverview,
        network: renderNetwork,
        media: renderMedia,
        client: renderClient,
        logs: renderLogs,
        advanced: renderAdvanced,
    }[activeTab];
    render(content, analysis);
}

// ####################################################
// OVERVIEW
// ####################################################

function renderOverview(content, analysis) {
    const { session, network, groups, observations } = analysis;
    const verdict = VERDICT[analysis.verdict];
    const issues = observations.filter((o) => ['critical', 'warning'].includes(o.severity)).length;
    const audioMos = RtcStatsAnalyzer.estimateMos({
        rtt: network.rtt,
        jitter: groups.audioIn?.metrics.jitter ?? groups.audioOut?.metrics.jitter,
        packetLoss: Math.max(groups.audioIn?.metrics.packetLoss ?? 0, groups.audioOut?.metrics.packetLoss ?? 0),
    });
    const worstLoss = Math.max(...Object.values(groups).map((g) => g?.metrics.packetLoss ?? -1));

    const kpi = (label, value, status, help) =>
        el(
            'div',
            { className: 'kpi', title: help },
            el('div', { className: 'kpi-label', text: label }),
            el('div', { className: `kpi-value ${status || ''}`, text: value })
        );

    content.append(
        el(
            'div',
            { className: `card verdict ${analysis.verdict}` },
            el('i', { className: `fa-solid ${verdict.icon} verdict-icon` }),
            el(
                'div',
                { className: 'verdict-text' },
                el('div', { className: 'verdict-title', text: verdict.title }),
                el('div', {
                    className: 'verdict-sub',
                    text: `${verdict.sub} ${issues ? `${issues} issue${issues > 1 ? 's' : ''} found.` : ''}`.trim(),
                })
            ),
            el(
                'div',
                { className: 'kpis' },
                kpi('Duration', formatDuration(session.duration)),
                kpi(
                    'Voice quality',
                    isNum(audioMos) ? `${audioMos.toFixed(1)} MOS` : '-',
                    RtcStatsAnalyzer.rateMetric('mos', audioMos),
                    METRIC_HELP.mos
                ),
                kpi(
                    'Round trip',
                    formatMetric('rtt', network.rtt),
                    RtcStatsAnalyzer.rateMetric('rtt', network.rtt),
                    METRIC_HELP.rtt
                ),
                kpi(
                    'Worst loss',
                    worstLoss >= 0 ? formatMetric('packetLoss', worstLoss) : '-',
                    RtcStatsAnalyzer.rateMetric('packetLoss', worstLoss >= 0 ? worstLoss : null),
                    METRIC_HELP.packetLoss
                ),
                kpi('Connectivity', connectivityText(network.connectivity))
            )
        )
    );

    content.append(
        card(
            'What we found',
            'fa-stethoscope',
            el(
                'div',
                { className: 'observations' },
                observations.map((item) =>
                    el(
                        'div',
                        { className: `observation ${item.severity}` },
                        icon(SEVERITY_ICON[item.severity]),
                        el(
                            'div',
                            { className: 'observation-body' },
                            el('div', { className: 'observation-title', text: item.title }),
                            item.detail ? el('div', { className: 'observation-detail', text: item.detail }) : null,
                            item.tip
                                ? el(
                                      'div',
                                      { className: 'observation-tip' },
                                      icon('fa-lightbulb'),
                                      el('strong', { text: 'How to fix: ' }),
                                      item.tip
                                  )
                                : null,
                            item.tab && item.tab !== 'overview'
                                ? el('button', {
                                      className: 'link-btn',
                                      text: `View ${item.tab} details →`,
                                      onclick: () => renderTabs(item.tab),
                                  })
                                : null
                        )
                    )
                )
            )
        )
    );

    content.append(card('Media quality', 'fa-signal', renderHealthCards(groups)));
    content.append(card('Summary', 'fa-clipboard-list', renderSummaryPanels(analysis)));
}

function gauge(metric, value) {
    const def = RtcStatsAnalyzer.METRICS[metric];
    if (!def || !isNum(value)) return null;
    const min = def.min || 0;
    const span = def.max - min;
    const pct = (v) => Math.max(0, Math.min(100, ((v - min) / span) * 100));
    const good = pct(def.good);
    const fair = pct(def.fair);
    const green = 'rgba(34,197,94,.75)';
    const amber = 'rgba(251,191,36,.75)';
    const red = 'rgba(239,68,68,.75)';
    const background = def.higherIsBetter
        ? `linear-gradient(90deg, ${red} 0 ${fair}%, ${amber} ${fair}% ${good}%, ${green} ${good}% 100%)`
        : `linear-gradient(90deg, ${green} 0 ${good}%, ${amber} ${good}% ${fair}%, ${red} ${fair}% 100%)`;
    return el(
        'div',
        { className: 'gauge', style: `background:${background}` },
        el('span', { className: 'marker', style: `left:${pct(value)}%` })
    );
}

function metricRow(name, metric, value, display) {
    return el(
        'div',
        { className: 'metric' },
        el(
            'div',
            { className: 'metric-top' },
            el('span', { className: 'metric-name', title: METRIC_HELP[metric] || '', text: name }),
            el('span', { className: 'metric-value', text: display ?? formatMetric(metric, value) })
        ),
        gauge(metric, value)
    );
}

function renderHealthCards(groups) {
    const cards = [
        ['audioOut', 'Audio', 'out'],
        ['audioIn', 'Audio', 'in'],
        ['videoOut', 'Video', 'out'],
        ['videoIn', 'Video', 'in'],
    ].map(([key, label, direction]) => {
        const group = groups[key];
        const head = (status) =>
            el(
                'div',
                { className: 'health-head' },
                el(
                    'span',
                    { className: 'dir', title: direction === 'out' ? 'Sent' : 'Received' },
                    icon(direction === 'out' ? 'fa-arrow-up' : 'fa-arrow-down')
                ),
                el(
                    'span',
                    { className: 'name' },
                    `${label} ${direction === 'out' ? 'sent' : 'received'}`,
                    group
                        ? el('span', {
                              className: 'muted',
                              title: `${group.count} stream${group.count > 1 ? 's' : ''}${label === 'Video' && direction === 'out' && group.count > 1 ? ' (simulcast layers)' : ''}`,
                              text: ` ×${group.count}`,
                          })
                        : null
                ),
                pill(status, group ? undefined : 'None')
            );
        if (!group) {
            return el(
                'div',
                { className: 'health-card empty' },
                head(null),
                el('div', {
                    className: 'muted',
                    text: direction === 'out' ? 'Nothing was sent.' : 'Nothing was received.',
                })
            );
        }
        const m = group.metrics;
        return el(
            'div',
            { className: 'health-card' },
            head(group.status),
            metricRow('Bitrate', 'bitrate', m.bitrate),
            label === 'Audio' ? metricRow('Voice quality (MOS)', 'mos', m.mos) : null,
            label === 'Video' ? metricRow('Frame rate', 'fps', m.fps) : null,
            label === 'Video' ? metricRow('Resolution', 'resolution', null, m.resolution || '-') : null,
            metricRow('Round trip time', 'rtt', m.rtt),
            metricRow('Packet loss', 'packetLoss', m.packetLoss),
            metricRow('Jitter', 'jitter', m.jitter)
        );
    });
    return el('div', { className: 'health' }, cards);
}

function infoRow(iconName, label, value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null;
    return el(
        'div',
        { className: 'row' },
        el('span', { className: 'row-label' }, icon(iconName), label),
        el('span', { className: 'row-value' }, value instanceof Node || Array.isArray(value) ? value : String(value))
    );
}

function renderSummaryPanels(analysis) {
    const { session, network, client } = analysis;
    const connectivity = network.connectivity;
    const panel = (title, ...rows) =>
        el('div', { className: 'panel' }, el('div', { className: 'panel-title', text: title }), ...rows);
    return el(
        'div',
        { className: 'panels' },
        panel(
            'Session',
            infoRow('fa-door-open', 'Room', session.room),
            infoRow(
                'fa-user',
                'Participant',
                session.user ? el('span', { className: 'mono', text: session.user }) : null
            ),
            infoRow(
                'fa-tags',
                'Role',
                session.tags.map((tag) =>
                    el('span', {
                        className: 'tag',
                        text: tag.startsWith('role:') ? tag.slice(5).replace(/^./, (c) => c.toUpperCase()) : tag,
                    })
                )
            ),
            infoRow('fa-clock', 'Started', formatDate(session.start)),
            infoRow('fa-hourglass-half', 'Duration', formatDuration(session.duration))
        ),
        panel(
            'Network',
            infoRow('fa-route', 'Connectivity', connectivityText(connectivity)),
            infoRow('fa-arrows-left-right', 'Round trip time', formatMetric('rtt', network.rtt)),
            infoRow('fa-wave-square', 'Jitter (worst received)', formatMetric('jitter', network.jitter)),
            infoRow(
                'fa-wifi',
                'Network type',
                connectivity?.networkType === 'unknown' ? null : connectivity?.networkType
            ),
            infoRow('fa-location-dot', 'Public address', session.remoteAddresses.join(', '))
        ),
        panel(
            'Client',
            infoRow('fa-globe', 'Browser', client.browser),
            infoRow('fa-desktop', 'Operating system', client.os),
            infoRow('fa-microchip', 'CPU cores', client.cores),
            infoRow('fa-memory', 'Memory', isNum(client.memory) ? `${client.memory} GB` : null),
            infoRow(
                'fa-video',
                'Devices',
                client.devices
                    ? `${client.devices.videoinput} cam · ${client.devices.audioinput} mic · ${client.devices.audiooutput} speaker`
                    : null
            )
        )
    );
}

// ####################################################
// NETWORK
// ####################################################

function mediaConnections(analysis) {
    return analysis.connections.filter((c) => c.role !== 'idle');
}

function connectionName(connection) {
    const names = {
        send: 'Sending connection',
        recv: 'Receiving connection',
        sendrecv: 'Send/receive connection',
        data: 'Data connection',
    };
    return `${names[connection.role] || 'Connection'} (${connection.id})`;
}

function stateChips(events, first) {
    if (!events.length) return el('span', { className: 'muted', text: '-' });
    return events.map((event) =>
        el('span', {
            className: `tag state-${event.value}`,
            text: `${event.value} ${formatOffset(event.timestamp - first)}`,
        })
    );
}

function renderNetwork(content, analysis) {
    const first = analysis.session.first;
    const connections = mediaConnections(analysis);
    const idle = analysis.connections.filter((c) => c.role === 'idle');
    if (!connections.length) {
        content.append(
            card(
                'Network',
                'fa-network-wired',
                el('div', { className: 'muted', text: 'No media connection was established.' })
            )
        );
    }
    for (const connection of connections) {
        const c = connection.connectivity;
        const status = connection.failed
            ? 'poor'
            : connection.disconnects
              ? 'fair'
              : connection.connected
                ? 'good'
                : 'fair';
        const statusText = connection.failed
            ? 'Failed'
            : connection.disconnects
              ? `${connection.disconnects} interruption(s)`
              : connection.connected
                ? 'Connected'
                : 'Not connected';
        const charts = el('div', { className: 'charts' });
        content.append(
            el(
                'div',
                { className: 'card' },
                el(
                    'h2',
                    { className: 'card-title' },
                    icon('fa-plug'),
                    connectionName(connection),
                    ' ',
                    pill(status, statusText)
                ),
                el(
                    'div',
                    { className: 'panels' },
                    el(
                        'div',
                        { className: 'panel' },
                        el('div', { className: 'panel-title', text: 'Path' }),
                        infoRow('fa-route', 'Connectivity', connectivityText(c)),
                        infoRow('fa-house', 'Local candidate', c?.local),
                        infoRow('fa-server', 'Remote candidate', c?.remote),
                        infoRow('fa-arrows-left-right', 'Average round trip', formatMetric('rtt', connection.rtt))
                    ),
                    el(
                        'div',
                        { className: 'panel' },
                        el('div', { className: 'panel-title', text: 'State timeline' }),
                        infoRow('fa-link', 'Connection', stateChips(connection.states.connection, first)),
                        infoRow('fa-snowflake', 'ICE', stateChips(connection.states.ice, first)),
                        infoRow('fa-clock', 'Created', formatTime(connection.created)),
                        infoRow('fa-chart-simple', 'Stats samples', connection.statsSamples)
                    )
                ),
                charts
            )
        );
        const pair = selectedPairSeries(connection.trace);
        const pairCharts = [
            { title: 'Round trip time', unit: 'ms', series: [{ label: 'ICE candidate pair', points: pair.rtt }] },
            {
                title: 'Available bandwidth',
                unit: 'kbps',
                series: [
                    { label: 'outgoing', points: pair.outgoing },
                    { label: 'incoming', points: pair.incoming },
                ],
            },
        ]
            .map((chart) => ({ ...chart, series: chart.series.filter((s) => s.points.length) }))
            .filter((chart) => chart.series.length);
        renderCharts(charts, pairCharts);
    }
    if (idle.length) {
        content.append(
            card(
                `Other connections (${idle.length})`,
                'fa-circle-nodes',
                el('p', {
                    className: 'hint',
                    text: 'Short-lived connections without media, e.g. the capability probe created by mediasoup-client when joining. They are expected.',
                }),
                el(
                    'div',
                    {},
                    idle.map((c) => el('span', { className: 'tag', text: c.id }))
                )
            )
        );
    }
}

// ####################################################
// MEDIA
// ####################################################

function streamLabel(stream) {
    const layer = stream.rid ? ` ${stream.rid}` : '';
    return `${stream.kind} ${stream.direction === 'out' ? 'sent' : 'received'}${layer} · ${stream.ssrc ?? stream.id}`;
}

function renderMedia(content, analysis) {
    for (const direction of ['out', 'in']) {
        const streams = analysis.streams.filter((s) => s.direction === direction);
        const title = direction === 'out' ? 'Sending' : 'Receiving';
        if (!streams.length) {
            content.append(
                card(
                    title,
                    direction === 'out' ? 'fa-arrow-up' : 'fa-arrow-down',
                    el('div', {
                        className: 'muted',
                        text: `No media was ${direction === 'out' ? 'sent' : 'received'}.`,
                    })
                )
            );
            continue;
        }
        const table = el(
            'div',
            { className: 'table-wrap' },
            el(
                'table',
                {},
                el(
                    'thead',
                    {},
                    el(
                        'tr',
                        {},
                        [
                            'Stream',
                            'Codec',
                            'Resolution',
                            'Frame rate',
                            'Bitrate',
                            'Packet loss',
                            'Jitter',
                            'Status',
                        ].map((h) => el('th', { text: h }))
                    )
                ),
                el(
                    'tbody',
                    {},
                    streams.map((s) =>
                        el(
                            'tr',
                            {},
                            el('td', { className: 'mono', text: streamLabel(s) }),
                            el('td', { text: s.codec || '-' }),
                            el('td', { text: s.height ? `${s.width}x${s.height}` : '-' }),
                            el('td', { text: formatMetric('fps', s.fps) }),
                            el('td', { text: formatBitrate(s.bitrate) }),
                            el('td', { text: formatMetric('packetLoss', s.packetLoss) }),
                            el('td', { text: formatMetric('jitter', s.jitter) }),
                            el('td', {}, pill(s.status))
                        )
                    )
                )
            )
        );
        const charts = el('div', { className: 'charts', style: 'margin-top:16px' });
        content.append(card(title, direction === 'out' ? 'fa-arrow-up' : 'fa-arrow-down', table, charts));
        renderCharts(charts, buildMediaCharts(streams, direction));
    }
}

function buildMediaCharts(streams, direction) {
    const video = streams.filter((s) => s.kind === 'video');
    const series = (list, fn) =>
        list.map((s) => ({ label: streamLabel(s), points: fn(s.entry) })).filter((s) => s.points.length);
    const charts = [
        {
            title: 'Bitrate',
            unit: 'kbps',
            series: series(streams, (e) =>
                rateSeries(e, direction === 'out' ? 'bytesSent' : 'bytesReceived', 8 / 1000)
            ),
        },
        { title: 'Frame rate', unit: 'fps', series: series(video, (e) => valueSeries(e, 'framesPerSecond')) },
        { title: 'Resolution (height)', unit: 'px', series: series(video, (e) => valueSeries(e, 'frameHeight')) },
    ];
    if (direction === 'in') {
        charts.push(
            { title: 'Packets lost', unit: 'pkt/s', series: series(streams, (e) => rateSeries(e, 'packetsLost')) },
            { title: 'Jitter', unit: 'ms', series: series(streams, (e) => valueSeries(e, 'jitter', 1000)) },
            {
                title: 'Jitter buffer delay',
                unit: 'ms',
                series: series(streams, (e) =>
                    ratioRateSeries(e, 'jitterBufferDelay', 'jitterBufferEmittedCount', 1000)
                ),
            },
            { title: 'NACKs sent', unit: '/s', series: series(streams, (e) => rateSeries(e, 'nackCount')) }
        );
    } else {
        charts.push({
            title: 'Retransmitted packets',
            unit: '/s',
            series: series(streams, (e) => rateSeries(e, 'retransmittedPacketsSent')),
        });
    }
    return charts.filter((chart) => chart.series.length);
}

// ####################################################
// CLIENT
// ####################################################

function describeConstraints(constraints) {
    if (!constraints || typeof constraints !== 'object') return '-';
    const part = (kind) => {
        const value = constraints[kind];
        if (!value) return null;
        if (value === true) return kind;
        const width = value.width?.ideal ?? value.width?.exact ?? value.width;
        const height = value.height?.ideal ?? value.height?.exact ?? value.height;
        const fps = value.frameRate?.ideal ?? value.frameRate?.exact ?? value.frameRate;
        const extras = [width && height ? `${width}x${height}` : null, isNum(fps) ? `${fps}fps` : null].filter(Boolean);
        return extras.length ? `${kind} (${extras.join(', ')})` : kind;
    };
    return [part('audio'), part('video')].filter(Boolean).join(' + ') || '-';
}

function renderClient(content, analysis) {
    const { client, session } = analysis;
    content.append(
        card(
            'Device & browser',
            'fa-laptop',
            el(
                'div',
                { className: 'panels' },
                el(
                    'div',
                    { className: 'panel' },
                    infoRow('fa-globe', 'Browser', client.browser),
                    infoRow('fa-desktop', 'Operating system', client.os),
                    infoRow('fa-mobile-screen', 'Mobile', client.mobile ? 'Yes' : 'No'),
                    infoRow('fa-rotate-right', 'Page reloads', client.reloads)
                ),
                el(
                    'div',
                    { className: 'panel' },
                    infoRow('fa-microchip', 'CPU cores', client.cores),
                    infoRow('fa-memory', 'Memory', isNum(client.memory) ? `${client.memory} GB` : null),
                    infoRow(
                        'fa-display',
                        'Screen',
                        client.screen
                            ? `${client.screen.width}x${client.screen.height} @${client.screen.devicePixelRatio}x`
                            : null
                    ),
                    infoRow(
                        'fa-window-maximize',
                        'Window',
                        client.window ? `${client.window.width}x${client.window.height}` : null
                    )
                ),
                el(
                    'div',
                    { className: 'panel' },
                    infoRow('fa-video', 'Cameras', client.devices?.videoinput),
                    infoRow('fa-microphone', 'Microphones', client.devices?.audioinput),
                    infoRow('fa-volume-high', 'Speakers', client.devices?.audiooutput),
                    infoRow('fa-link', 'Origin', session.origin)
                )
            ),
            el(
                'details',
                { style: 'margin-top:12px' },
                el('summary', { text: 'User agent' }),
                el('pre', { text: client.userAgent || '-' })
            )
        )
    );

    const rows = client.media.map((request) =>
        el(
            'tr',
            { className: request.result === 'failure' ? 'problem' : '' },
            el('td', { className: 'mono', text: formatOffset(request.time - session.first) }),
            el('td', { text: request.api === 'getDisplayMedia' ? 'Screen share' : 'Camera / microphone' }),
            el('td', { text: describeConstraints(request.constraints) }),
            el(
                'td',
                {},
                request.result === 'success'
                    ? pill('good', 'Success')
                    : request.result === 'failure'
                      ? pill('poor', 'Failed')
                      : pill(null, 'No answer')
            ),
            el('td', {
                text: request.error
                    ? `${request.error.name}${request.error.message ? `: ${request.error.message}` : ''}`
                    : isNum(request.duration)
                      ? `${Math.round(request.duration)} ms`
                      : '-',
            })
        )
    );
    content.append(
        card(
            'Camera, microphone & screen requests',
            'fa-camera',
            rows.length
                ? el(
                      'div',
                      { className: 'table-wrap' },
                      el(
                          'table',
                          {},
                          el(
                              'thead',
                              {},
                              el(
                                  'tr',
                                  {},
                                  ['Time', 'Request', 'Asked for', 'Result', 'Details'].map((h) =>
                                      el('th', { text: h })
                                  )
                              )
                          ),
                          el('tbody', {}, rows)
                      )
                  )
                : el('div', { className: 'muted', text: 'No device requests were recorded.' })
        )
    );
}

// ####################################################
// LOGS
// ####################################################

function allEvents(analysis) {
    if (analysis._events) return analysis._events;
    const events = [];
    for (const event of analysis.client.trace) events.push({ ...event, source: 'Client' });
    for (const connection of analysis.connections) {
        for (const event of connection.trace) {
            if (event.type !== 'getStats') events.push({ ...event, source: connection.id });
        }
    }
    events.sort((a, b) => a.timestamp - b.timestamp);
    analysis._events = events;
    return events;
}

function isProblemEvent(event) {
    // RTCPeerConnection.close() is normal; only an abnormal end of the dump stream is a problem
    if (event.type === 'close') return event.source === 'Client' && [1006, 1009, 1011].includes(event.value);
    return (
        /OnFailure$/.test(event.type) ||
        (/statechange$/.test(event.type) && ['failed', 'disconnected'].includes(event.value))
    );
}

function renderLogs(content, analysis) {
    const events = allEvents(analysis);
    const first = analysis.session.first;
    const sources = ['All', 'Client', ...analysis.connections.map((c) => c.id)];
    const sourceSelect = el(
        'select',
        {},
        sources.map((s) => el('option', { value: s, text: s === 'All' ? 'All sources' : s }))
    );
    const filter = el('input', { type: 'search', className: 'grow', placeholder: 'Search events...' });
    const problemsOnly = el('input', { type: 'checkbox' });
    const body = el('tbody');
    const count = el('span', { className: 'muted' });

    const draw = () => {
        const query = filter.value.trim().toLowerCase();
        body.replaceChildren();
        let shown = 0;
        for (const event of events) {
            if (sourceSelect.value !== 'All' && event.source !== sourceSelect.value) continue;
            const problem = isProblemEvent(event);
            if (problemsOnly.checked && !problem) continue;
            const text = stringify(event.value);
            if (query && !`${event.type} ${event.source} ${text}`.toLowerCase().includes(query)) continue;
            shown++;
            const sdp = event.value && typeof event.value === 'object' && typeof event.value.sdp === 'string';
            body.append(
                el(
                    'tr',
                    { className: problem ? 'problem' : '' },
                    el(
                        'td',
                        { className: 'time mono', title: formatDate(event.timestamp) },
                        formatOffset(event.timestamp - first)
                    ),
                    el('td', { className: 'mono', text: event.source }),
                    el('td', { className: 'mono', text: event.type }),
                    el(
                        'td',
                        { className: 'value' },
                        text && text !== 'null' && text !== '""'
                            ? el(
                                  'details',
                                  {},
                                  el('summary', { className: 'mono', text: text.replace(/\s+/g, ' ').slice(0, 240) }),
                                  el('pre', { text: sdp ? `${event.value.type}\n\n${event.value.sdp}` : text })
                              )
                            : el('span', { className: 'muted', text: '-' })
                    )
                )
            );
        }
        count.textContent = `${shown} / ${events.length}`;
    };

    [filter, sourceSelect, problemsOnly].forEach((input) =>
        input.addEventListener(input === filter ? 'input' : 'change', draw)
    );
    draw();

    content.append(
        card(
            'Event log',
            'fa-list',
            el('p', {
                className: 'hint',
                text: 'Every WebRTC API call and event recorded in the browser (stats samples are shown as charts). Failures and dropped connections are highlighted.',
            }),
            el(
                'div',
                { className: 'toolbar' },
                filter,
                sourceSelect,
                el('label', {}, problemsOnly, ' Problems only'),
                count
            ),
            el(
                'div',
                { className: 'table-wrap', style: 'max-height:640px' },
                el(
                    'table',
                    { className: 'events-table' },
                    el(
                        'thead',
                        {},
                        el(
                            'tr',
                            {},
                            ['Time', 'Source', 'Event', 'Value'].map((h) => el('th', { text: h }))
                        )
                    ),
                    body
                )
            )
        )
    );
}

// ####################################################
// ADVANCED (stats explorer)
// ####################################################

// Report types in a meaningful order (media first), unknown types at the end
const REPORT_TYPE_ORDER = [
    'outbound-rtp',
    'inbound-rtp',
    'remote-inbound-rtp',
    'remote-outbound-rtp',
    'media-source',
    'media-playout',
    'candidate-pair',
    'local-candidate',
    'remote-candidate',
    'transport',
    'codec',
    'data-channel',
    'peer-connection',
    'certificate',
    'compute-pressure',
];

// Preselected so a useful chart appears right away
const DEFAULT_PROPERTIES = {
    'outbound-rtp': ['bytesSent', 'framesPerSecond'],
    'inbound-rtp': ['bytesReceived', 'packetsLost', 'jitter'],
    'remote-inbound-rtp': ['roundTripTime', 'fractionLost'],
    'remote-outbound-rtp': ['bytesSent', 'packetsSent'],
    'media-source': ['framesPerSecond', 'audioLevel'],
    'candidate-pair': ['currentRoundTripTime', 'availableOutgoingBitrate'],
    transport: ['bytesSent', 'bytesReceived'],
    'data-channel': ['messagesSent', 'messagesReceived'],
};

// Cumulative counters (plotted per second); combined with a "never decreases" check on the data
const COUNTER_NAME =
    /^(bytes|packets|header|total|nack|pli|fir|retransmitted|concealed|silentConcealed|inserted|removed|requests|responses|consentRequests|keyFrames|hugeFrames|fec|qpSum|messages|concealmentEvents|frames(Sent|Received|Decoded|Encoded|Dropped|Rendered|Assembled))|Count$|Measurements$|^jitterBuffer(Delay|EmittedCount|TargetDelay|MinimumDelay)$/;
const TIMESTAMP_NAME = /Timestamp$|^estimatedPlayoutTimestamp$/;

function reportTypeRank(type) {
    const index = REPORT_TYPE_ORDER.indexOf(type);
    return index === -1 ? REPORT_TYPE_ORDER.length : index;
}

function describeReport(entry, connection) {
    const report = lastReport(entry) || {};
    const parts = [];
    if (report.kind) parts.push(report.kind);
    if (report.rid) parts.push(report.rid);
    if (report.frameWidth && report.frameHeight) parts.push(`${report.frameWidth}x${report.frameHeight}`);
    if (report.mimeType) parts.push(report.mimeType.replace(/^(audio|video)\//, ''));
    if (report.candidateType) parts.push(`${report.candidateType} ${report.protocol || ''}`.trim());
    if (entry.type === 'candidate-pair') {
        const transport = Object.values(connection.lastStats || {}).find((r) => r?.type === 'transport');
        if (transport?.selectedCandidatePairId === entry.id) parts.push('selected');
        else if (report.state) parts.push(report.state);
    }
    if (report.mid === 'probator') parts.push('bandwidth probe');
    if (report.ssrc !== undefined) parts.push(`ssrc ${report.ssrc}`);
    if (!parts.length || !report.ssrc) parts.push(`id ${entry.id}`);
    return parts.join(' · ');
}

// Splits the numeric properties of a report into counters, values and timestamps
function classifyProperties(entry) {
    const info = new Map();
    for (const { report } of entry.samples) {
        for (const [key, value] of Object.entries(report)) {
            if (key === 'timestamp' || !isNum(value)) continue;
            const item = info.get(key);
            if (!item) {
                info.set(key, { monotonic: true, constant: true, last: value });
                continue;
            }
            if (value < item.last) item.monotonic = false;
            if (value !== item.last) item.constant = false;
            item.last = value;
        }
    }
    const groups = { counters: [], values: [], constants: [], timestamps: [], constantValues: {} };
    for (const [key, item] of info) {
        if (TIMESTAMP_NAME.test(key)) groups.timestamps.push(key);
        else if (item.constant && entry.samples.length > 1) {
            groups.constants.push(key);
            groups.constantValues[key] = item.last;
        } else if (item.monotonic && COUNTER_NAME.test(key)) groups.counters.push(key);
        else groups.values.push(key);
    }
    [groups.counters, groups.values, groups.constants, groups.timestamps].forEach((list) =>
        list.sort((a, b) => a.localeCompare(b))
    );
    return groups;
}

function renderAdvanced(content, analysis) {
    const connections = analysis.connections.filter((c) => c.reports.size);
    if (!connections.length) {
        content.append(
            card(
                'Stats explorer',
                'fa-flask',
                el('div', { className: 'muted', text: 'This dump contains no getStats samples.' })
            )
        );
        return;
    }

    const connectionSelect = el(
        'select',
        { 'aria-label': 'Connection' },
        connections.map((c) => el('option', { value: c.id, text: connectionName(c) }))
    );
    const reportSelect = el('select', { className: 'grow', 'aria-label': 'Stats report' });
    const filter = el('input', { type: 'search', className: 'grow', placeholder: 'Filter properties...' });
    const rateToggle = el('input', { type: 'checkbox', checked: true });
    const selectedCount = el('span', { className: 'muted small' });
    const clearBtn = el('button', { className: 'btn', title: 'Unselect all properties' }, icon('fa-eraser'), ' Clear');
    const groupsBox = el('div', { className: 'prop-groups' });
    const chartBox = el('div', { className: 'charts' });
    const config = el('div');
    let charts = [];
    let kinds = { counters: [], values: [], constants: [], timestamps: [], constantValues: {} };

    const current = () => connections.find((c) => c.id === connectionSelect.value);
    const currentEntry = () => current()?.reports.get(reportSelect.value);
    const checkedProperties = () => [...groupsBox.querySelectorAll('input:checked')].map((input) => input.value);

    // One chart per property: values of very different scales stay readable
    const draw = () => {
        charts.forEach((c) => c.destroy());
        state.charts = state.charts.filter((c) => !charts.includes(c));
        charts = [];
        chartBox.replaceChildren();
        const checked = checkedProperties();
        selectedCount.textContent = checked.length ? `${checked.length} selected` : '';
        groupsBox
            .querySelectorAll('label')
            .forEach((label) => label.classList.toggle('checked', Boolean(label.querySelector('input')?.checked)));
        const entry = currentEntry();
        if (!entry || !checked.length) {
            chartBox.append(el('div', { className: 'muted', text: 'Select one or more properties to plot them.' }));
            return;
        }
        for (const property of checked) {
            const asRate = rateToggle.checked && kinds.counters.includes(property);
            const points = asRate ? rateSeries(entry, property) : valueSeries(entry, property);
            if (!points.length) continue;
            charts.push(
                renderChart(chartBox, {
                    title: asRate ? `${property} per second` : property,
                    unit: '',
                    series: [{ label: property, unit: asRate ? '/s' : '', points }],
                })
            );
        }
    };

    const group = (title, hint, keys, { collapsed = false, constants = false } = {}) => {
        if (!keys.length) return null;
        const grid = el(
            'div',
            { className: 'prop-grid' },
            keys.map((key) =>
                constants
                    ? el(
                          'label',
                          {
                              className: 'constant',
                              title: `${key} = ${kinds.constantValues[key]}`,
                              'data-key': key.toLowerCase(),
                          },
                          el('span', { text: key }),
                          el('span', { className: 'const-value', text: String(kinds.constantValues[key]) })
                      )
                    : el(
                          'label',
                          { title: key, 'data-key': key.toLowerCase() },
                          el('input', { type: 'checkbox', value: key, onchange: draw }),
                          el('span', { text: key })
                      )
            )
        );
        const head = [
            el('span', { text: title }),
            el('span', { className: 'muted', text: ` (${keys.length}) · ${hint}` }),
        ];
        return collapsed
            ? el('details', { className: 'prop-group' }, el('summary', { className: 'prop-group-title' }, head), grid)
            : el('div', { className: 'prop-group' }, el('div', { className: 'prop-group-title' }, head), grid);
    };

    const applyFilter = () => {
        const query = filter.value.trim().toLowerCase();
        groupsBox.querySelectorAll('.prop-group').forEach((box) => {
            let visible = 0;
            box.querySelectorAll('label').forEach((label) => {
                const match = !query || label.dataset.key.includes(query);
                label.hidden = !match;
                if (match) visible++;
            });
            box.hidden = !visible;
            if (query && visible && box.tagName === 'DETAILS') box.open = true;
        });
    };

    const listProperties = () => {
        const entry = currentEntry();
        kinds = entry
            ? classifyProperties(entry)
            : { counters: [], values: [], constants: [], timestamps: [], constantValues: {} };
        const all = [...kinds.counters, ...kinds.values, ...kinds.constants, ...kinds.timestamps];
        groupsBox.replaceChildren(
            ...(all.length
                ? [
                      group('Counters', 'cumulative, plotted per second', kinds.counters),
                      group('Values', 'instant measurements', kinds.values),
                      group('Constant', 'same value for the whole call', kinds.constants, {
                          collapsed: true,
                          constants: true,
                      }),
                      group('Timestamps', 'rarely useful to plot', kinds.timestamps, { collapsed: true }),
                  ].filter(Boolean)
                : [el('span', { className: 'muted', text: 'This report has no numeric properties.' })])
        );
        const plottable = [...kinds.counters, ...kinds.values, ...kinds.timestamps];
        const defaults = (DEFAULT_PROPERTIES[entry?.type] || []).filter((key) => plottable.includes(key));
        const preselect = defaults.length ? defaults : [kinds.counters[0] || kinds.values[0]].filter(Boolean);
        groupsBox.querySelectorAll('input').forEach((input) => (input.checked = preselect.includes(input.value)));
        applyFilter();
        draw();
    };

    const listReports = () => {
        const connection = current();
        const entries = [...connection.reports.values()].sort(
            (a, b) =>
                reportTypeRank(a.type) - reportTypeRank(b.type) ||
                String(a.type).localeCompare(String(b.type)) ||
                describeReport(a, connection).localeCompare(describeReport(b, connection))
        );
        const byType = new Map();
        for (const entry of entries) {
            if (!byType.has(entry.type)) byType.set(entry.type, []);
            byType.get(entry.type).push(entry);
        }
        reportSelect.replaceChildren(
            ...[...byType].map(([type, list]) =>
                el(
                    'optgroup',
                    { label: type },
                    list.map((entry) =>
                        el('option', { value: entry.id, text: `${type} · ${describeReport(entry, connection)}` })
                    )
                )
            )
        );
        // Start on the (highest resolution) video stream: usually the most interesting one
        const video = entries
            .filter((e) => ['outbound-rtp', 'inbound-rtp'].includes(e.type) && lastReport(e)?.kind === 'video')
            .filter((e) => lastReport(e)?.mid !== 'probator')
            .sort((a, b) => (lastReport(b)?.frameHeight || 0) - (lastReport(a)?.frameHeight || 0))[0];
        if (video) reportSelect.value = video.id;
        config.replaceChildren(
            connection.configuration
                ? el(
                      'details',
                      { style: 'margin-top:12px' },
                      el('summary', { text: 'RTCPeerConnection configuration' }),
                      el('pre', { text: stringify(connection.configuration) })
                  )
                : ''
        );
        listProperties();
    };

    connectionSelect.addEventListener('change', listReports);
    reportSelect.addEventListener('change', listProperties);
    rateToggle.addEventListener('change', draw);
    filter.addEventListener('input', applyFilter);
    clearBtn.addEventListener('click', () => {
        groupsBox.querySelectorAll('input:checked').forEach((input) => (input.checked = false));
        draw();
    });

    content.append(
        card(
            'Stats explorer',
            'fa-flask',
            el('p', {
                className: 'hint',
                text: 'Plot any raw getStats() property: pick a connection and a report, then tick properties (each gets its own chart). Counters are shown per second, constant values are listed with their value.',
            }),
            el('div', { className: 'toolbar' }, connectionSelect, reportSelect),
            el(
                'div',
                { className: 'toolbar' },
                filter,
                el(
                    'label',
                    {
                        className: 'switch',
                        title: 'Counters such as bytesSent grow forever: show them as a per-second rate',
                    },
                    rateToggle,
                    el('span', { className: 'slider' }),
                    'Counters per second'
                ),
                selectedCount,
                clearBtn
            ),
            groupsBox,
            chartBox,
            config
        )
    );
    listReports();
}

// ####################################################
// TIME SERIES
// ####################################################

function lastReport(entry) {
    return entry?.samples[entry.samples.length - 1]?.report;
}

function reportTime(sample) {
    return isNum(sample.report.timestamp) ? sample.report.timestamp : sample.t;
}

function valueSeries(entry, property, scale = 1) {
    const points = [];
    for (const sample of entry.samples) {
        const value = sample.report[property];
        if (isNum(value)) points.push([sample.t, value * scale]);
    }
    return points;
}

// Per-second rate of a cumulative counter; counter resets produce a gap.
function rateSeries(entry, property, scale = 1) {
    const points = [];
    let previous = null;
    for (const sample of entry.samples) {
        const value = sample.report[property];
        if (!isNum(value)) continue;
        const time = reportTime(sample);
        if (previous) {
            const seconds = (time - previous.time) / 1000;
            const delta = value - previous.value;
            if (seconds > 0) points.push([sample.t, delta >= 0 ? (delta / seconds) * scale : null]);
        }
        previous = { time, value };
    }
    return points;
}

function ratioRateSeries(entry, numerator, denominator, scale = 1) {
    const points = [];
    let previous = null;
    for (const sample of entry.samples) {
        const num = sample.report[numerator];
        const den = sample.report[denominator];
        if (!isNum(num) || !isNum(den)) continue;
        if (previous) {
            const deltaDen = den - previous.den;
            points.push([sample.t, deltaDen > 0 ? ((num - previous.num) / deltaDen) * scale : null]);
        }
        previous = { num, den };
    }
    return points;
}

function selectedPairSeries(trace) {
    const rtt = [];
    const outgoing = [];
    const incoming = [];
    for (const event of trace) {
        if (event.type !== 'getStats' || !event.value || typeof event.value !== 'object') continue;
        const reports = Object.values(event.value);
        const transport = reports.find((report) => report?.type === 'transport' && report.selectedCandidatePairId);
        const pair = transport
            ? event.value[transport.selectedCandidatePairId]
            : reports.find(
                  (report) => report?.type === 'candidate-pair' && report.nominated && report.state === 'succeeded'
              );
        if (!pair) continue;
        if (isNum(pair.currentRoundTripTime)) rtt.push([event.timestamp, pair.currentRoundTripTime * 1000]);
        if (isNum(pair.availableOutgoingBitrate))
            outgoing.push([event.timestamp, pair.availableOutgoingBitrate / 1000]);
        if (isNum(pair.availableIncomingBitrate))
            incoming.push([event.timestamp, pair.availableIncomingBitrate / 1000]);
    }
    return { rtt, outgoing, incoming };
}

// ####################################################
// CHARTS (uPlot)
// ####################################################

function destroyCharts() {
    state.charts.forEach((chart) => chart.destroy());
    state.charts = [];
}

function renderChart(container, { title, unit, series }) {
    const box = el(
        'div',
        { className: 'chart' },
        el('div', { className: 'chart-title', text: unit ? `${title} (${unit})` : title })
    );
    container.append(box);

    const times = [...new Set(series.flatMap((s) => s.points.map(([t]) => t)))].sort((a, b) => a - b);
    const index = new Map(times.map((t, i) => [t, i]));
    const columns = series.map((s) => {
        const column = new Array(times.length).fill(null);
        for (const [t, v] of s.points) column[index.get(t)] = v;
        return column;
    });

    const axis = { stroke: '#8b95a5', grid: { stroke: '#2a2d35', width: 1 }, ticks: { stroke: '#2a2d35' } };
    const chart = new uPlot(
        {
            width: Math.max(box.clientWidth - 20, 280),
            height: CHART_HEIGHT,
            scales: { x: { time: true } },
            cursor: { drag: { x: true, y: false } },
            series: [
                {},
                ...series.map((s, i) => ({
                    label: s.label,
                    stroke: COLORS[i % COLORS.length],
                    width: 1.5,
                    points: { show: times.length < 60 },
                    value: (u, v) =>
                        v === null || v === undefined ? '-' : `${formatNumber(v)} ${s.unit ?? unit}`.trim(),
                })),
            ],
            axes: [axis, { ...axis, size: 60, values: (u, values) => values.map(formatNumber) }],
        },
        [times.map((t) => t / 1000), ...columns],
        box
    );
    state.charts.push(chart);
    return chart;
}

// Charts that stayed at 0 for the whole call are summarized in one line instead of an empty plot
function renderCharts(container, charts) {
    const flat = [];
    for (const chart of charts) {
        if (chart.series.every((s) => s.points.every(([, value]) => !value))) flat.push(chart.title);
        else renderChart(container, chart);
    }
    if (flat.length) {
        container.after(
            el('p', {
                className: 'hint',
                style: 'margin:12px 0 0',
                text: `Always 0 during the call: ${flat.join(', ')}.`,
            })
        );
    }
}

function resizeCharts() {
    for (const chart of state.charts) {
        const box = chart.root.parentElement;
        if (box && box.clientWidth) chart.setSize({ width: Math.max(box.clientWidth - 20, 280), height: CHART_HEIGHT });
    }
}

// ####################################################
// INIT
// ####################################################

function initDropZone() {
    const zone = $('dropZone');
    let depth = 0;
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        depth++;
        zone.classList.add('dragover');
    });
    document.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (!depth) zone.classList.remove('dragover');
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        depth = 0;
        zone.classList.remove('dragover');
        openLocalFile(e.dataTransfer?.files?.[0]);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    $('authForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const key = $('apiKeyInput').value.trim();
        if (!key) return;
        sessionStorage.setItem(API_KEY_STORAGE, key);
        $('apiKeyInput').value = '';
        loadDumps();
    });
    $('refreshBtn').addEventListener('click', () => loadDumps());
    $('deleteAllBtn').addEventListener('click', deleteAllServerDumps);
    $('logoutBtn').addEventListener('click', () => {
        sessionStorage.removeItem(API_KEY_STORAGE);
        state.dumps = [];
        state.dumpsSignature = null;
        setSignedIn(false);
        showNotice('serverNotice', '');
    });
    $('dumpSearch').addEventListener('input', renderDumps);
    $('fileInput').addEventListener('change', (e) => {
        openLocalFile(e.target.files[0]);
        e.target.value = '';
    });
    $('backBtn').addEventListener('click', () => {
        showAnalysis(false);
        // New dumps may have arrived while analyzing
        if (getApiKey()) loadDumps({ silent: true });
    });
    $('downloadBtn').addEventListener('click', () => state.selectedDump && downloadServerDump(state.selectedDump));
    initDropZone();
    initAutoRefresh();

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resizeCharts, 150);
    });

    if (getApiKey()) loadDumps();
});
