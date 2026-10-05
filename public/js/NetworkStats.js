'use strict';

class NetworkStats {
    constructor({ getId, isActive, getTransports }) {
        this.getId = typeof getId === 'function' ? getId : (id) => document.getElementById(id);
        this.isActive = typeof isActive === 'function' ? isActive : () => false;
        this.getTransports = typeof getTransports === 'function' ? getTransports : () => ({});

        this.monitorInterval = null;
        this.lastSnapshot = null;
        this.chartMaxPoints = 60;
        this.chartHistory = {
            sent: [],
            received: [],
            latency: [],
            jitter: [],
        };
        this.qualitySmoothingWindow = 8;
        this.qualityHistory = {
            packetLoss: [],
            jitter: [],
            rtt: [],
        };
        this.qualityState = 'checking';
        this.qualityCandidate = null;
        this.qualityCandidateStreak = 0;
        this.qualityClasses = [
            'network-quality--excellent',
            'network-quality--good',
            'network-quality--fair',
            'network-quality--poor',
        ];
    }

    start() {
        if (this.monitorInterval) return;
        this.lastSnapshot = null;
        this.resetGraph();
        this.update().catch((error) => {
            console.error('Network monitor update failed', error);
        });
        this.monitorInterval = setInterval(() => {
            this.update().catch((error) => {
                console.error('Network monitor update failed', error);
            });
        }, 1000);
    }

    stop(resetValues = false) {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        this.lastSnapshot = null;
        if (resetValues) {
            this.renderStats();
            this.resetGraph();
            this.resetQuality();
        }
    }

    async update() {
        if (!this.isActive()) {
            this.stop();
            return;
        }

        const { producerTransport, consumerTransport } = this.getTransports();

        const [producerStats, consumerStats] = await Promise.all([
            this.getTransportStats(producerTransport, 'producer'),
            this.getTransportStats(consumerTransport, 'consumer'),
        ]);

        const bytesSent = producerStats.bytesSent + consumerStats.bytesSent;
        const bytesReceived = producerStats.bytesReceived + consumerStats.bytesReceived;
        const packetsLost = producerStats.packetsLost + consumerStats.packetsLost;
        const packetsReceived = producerStats.packetsReceived + consumerStats.packetsReceived;
        const jitterSeconds = this.averageNumbers([...producerStats.jitterSamples, ...consumerStats.jitterSamples]);
        const rttSeconds = this.averageNumbers([...producerStats.rttSamples, ...consumerStats.rttSamples]);
        const packetLossPercentage = this.calculatePacketLossPercentage(packetsLost, packetsReceived);
        const jitterMilliseconds = jitterSeconds * 1000;
        const rttMilliseconds = rttSeconds * 1000;

        const now = performance.now();
        let sentBitrate = 0;
        let receivedBitrate = 0;

        if (this.lastSnapshot) {
            const elapsedMs = now - this.lastSnapshot.timestamp;
            if (elapsedMs > 0) {
                const sentBytesDelta = Math.max(0, bytesSent - this.lastSnapshot.bytesSent);
                const receivedBytesDelta = Math.max(0, bytesReceived - this.lastSnapshot.bytesReceived);
                const seconds = elapsedMs / 1000;
                sentBitrate = (sentBytesDelta * 8) / seconds;
                receivedBitrate = (receivedBytesDelta * 8) / seconds;
            }
        }

        this.lastSnapshot = { timestamp: now, bytesSent, bytesReceived };

        this.pushGraphPoint(sentBitrate, receivedBitrate, rttMilliseconds, jitterMilliseconds);
        this.updateQualityBadge(packetLossPercentage, jitterMilliseconds, rttMilliseconds);

        this.renderStats({
            sentBitrate,
            receivedBitrate,
            packetLossPercentage,
            jitterSeconds,
            rttSeconds,
        });
    }

    async getTransportStats(transport, transportType) {
        const stats = {
            bytesSent: 0,
            bytesReceived: 0,
            packetsLost: 0,
            packetsReceived: 0,
            jitterSamples: [],
            rttSamples: [],
        };

        if (!transport || transport.closed || typeof transport.getStats !== 'function') return stats;

        try {
            const report = await transport.getStats();
            if (!report) return stats;

            const reportStats = Array.isArray(report)
                ? report
                : typeof report.values === 'function'
                  ? Array.from(report.values())
                  : typeof report[Symbol.iterator] === 'function'
                    ? Array.from(report)
                    : Object.values(report);

            for (const stat of reportStats) {
                if (!stat || !stat.type) continue;

                if (stat.type === 'outbound-rtp' && !stat.isRemote) {
                    if (typeof stat.bytesSent === 'number') stats.bytesSent += stat.bytesSent;
                }

                if (stat.type === 'inbound-rtp' && !stat.isRemote) {
                    if (typeof stat.bytesReceived === 'number') stats.bytesReceived += stat.bytesReceived;
                    if (typeof stat.packetsLost === 'number') stats.packetsLost += stat.packetsLost;
                    if (typeof stat.packetsReceived === 'number') stats.packetsReceived += stat.packetsReceived;
                    if (typeof stat.jitter === 'number') stats.jitterSamples.push(stat.jitter);
                }

                if (stat.type === 'remote-inbound-rtp' && typeof stat.roundTripTime === 'number') {
                    stats.rttSamples.push(stat.roundTripTime);
                }

                if (stat.type === 'candidate-pair' && typeof stat.currentRoundTripTime === 'number') {
                    stats.rttSamples.push(stat.currentRoundTripTime);
                }
            }
        } catch (error) {
            console.error(`Failed to read ${transportType} transport stats`, {
                transportId: transport.id,
                error,
            });
        }

        return stats;
    }

    averageNumbers(values) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        const sum = values.reduce((total, value) => total + value, 0);
        return sum / values.length;
    }

    calculatePacketLossPercentage(packetsLost, packetsReceived) {
        if (!Number.isFinite(packetsLost) || !Number.isFinite(packetsReceived)) return 0;
        const totalPackets = Math.max(0, packetsLost) + Math.max(0, packetsReceived);
        if (totalPackets <= 0) return 0;
        return (Math.max(0, packetsLost) / totalPackets) * 100;
    }

    formatBitrate(bitsPerSecond) {
        if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '0 b';
        const units = ['b', 'kb', 'mb', 'gb'];
        let value = bitsPerSecond;
        let unitIndex = 0;

        while (value >= 1000 && unitIndex < units.length - 1) {
            value /= 1000;
            unitIndex++;
        }

        const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
        return `${value.toFixed(decimals)} ${units[unitIndex]}`;
    }

    formatSecondsToMilliseconds(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '0.00 ms';
        const milliseconds = seconds * 1000;
        return `${milliseconds.toFixed(2)} ms`;
    }

    resetGraph() {
        this.chartHistory.sent = [];
        this.chartHistory.received = [];
        this.chartHistory.latency = [];
        this.chartHistory.jitter = [];
        this.renderBitrateGraph();
        this.renderLatencyGraph();
    }

    pushGraphPoint(sentBitrate, receivedBitrate, latencyMilliseconds, jitterMilliseconds) {
        this.chartHistory.sent.push(Number.isFinite(sentBitrate) ? Math.max(0, sentBitrate) : 0);
        this.chartHistory.received.push(Number.isFinite(receivedBitrate) ? Math.max(0, receivedBitrate) : 0);
        this.chartHistory.latency.push(Number.isFinite(latencyMilliseconds) ? Math.max(0, latencyMilliseconds) : 0);
        this.chartHistory.jitter.push(Number.isFinite(jitterMilliseconds) ? Math.max(0, jitterMilliseconds) : 0);

        if (this.chartHistory.sent.length > this.chartMaxPoints) this.chartHistory.sent.shift();
        if (this.chartHistory.received.length > this.chartMaxPoints) this.chartHistory.received.shift();
        if (this.chartHistory.latency.length > this.chartMaxPoints) this.chartHistory.latency.shift();
        if (this.chartHistory.jitter.length > this.chartMaxPoints) this.chartHistory.jitter.shift();

        this.renderBitrateGraph();
        this.renderLatencyGraph();
    }

    renderBitrateGraph() {
        const canvas = this.getId('networkBitrateChart');
        if (!canvas) return;

        const cssWidth = canvas.clientWidth || 300;
        const cssHeight = canvas.clientHeight || 120;
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.max(1, Math.floor(cssWidth * dpr));
        const targetHeight = Math.max(1, Math.floor(cssHeight * dpr));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.scale(dpr, dpr);

        const width = cssWidth;
        const height = cssHeight;
        const top = 8;
        const bottom = height - 8;
        const plotHeight = Math.max(1, bottom - top);
        const left = 8;
        const right = width - 8;
        const plotWidth = Math.max(1, right - left);

        const values = [...this.chartHistory.sent, ...this.chartHistory.received];
        const maxValue = Math.max(1, ...values);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1;
        const gridLines = 3;
        for (let i = 0; i <= gridLines; i++) {
            const y = top + (plotHeight * i) / gridLines;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
        }

        const drawLine = (series, color) => {
            if (!series.length) return;
            const denominator = Math.max(1, this.chartMaxPoints - 1);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            series.forEach((value, index) => {
                const x = left + (plotWidth * index) / denominator;
                const normalized = Math.min(1, Math.max(0, value / maxValue));
                const y = bottom - normalized * plotHeight;
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        };

        drawLine(this.chartHistory.sent, '#4ecb71');
        drawLine(this.chartHistory.received, '#5aa8ff');
    }

    renderLatencyGraph() {
        const canvas = this.getId('networkLatencyChart');
        if (!canvas) return;

        const cssWidth = canvas.clientWidth || 300;
        const cssHeight = canvas.clientHeight || 120;
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.max(1, Math.floor(cssWidth * dpr));
        const targetHeight = Math.max(1, Math.floor(cssHeight * dpr));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.scale(dpr, dpr);

        const width = cssWidth;
        const height = cssHeight;
        const top = 8;
        const bottom = height - 8;
        const plotHeight = Math.max(1, bottom - top);
        const left = 8;
        const right = width - 8;
        const plotWidth = Math.max(1, right - left);

        const values = [...this.chartHistory.latency, ...this.chartHistory.jitter];
        const maxValue = Math.max(1, ...values);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1;
        const gridLines = 3;
        for (let i = 0; i <= gridLines; i++) {
            const y = top + (plotHeight * i) / gridLines;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
        }

        const drawLine = (series, color) => {
            if (!series.length) return;
            const denominator = Math.max(1, this.chartMaxPoints - 1);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            series.forEach((value, index) => {
                const x = left + (plotWidth * index) / denominator;
                const normalized = Math.min(1, Math.max(0, value / maxValue));
                const y = bottom - normalized * plotHeight;
                if (index === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        };

        drawLine(this.chartHistory.latency, '#bb8dff');
        drawLine(this.chartHistory.jitter, '#ffb86c');
    }

    resetQuality() {
        const badge = this.getId('networkQualityBadge');
        this.qualityHistory.packetLoss = [];
        this.qualityHistory.jitter = [];
        this.qualityHistory.rtt = [];
        this.qualityState = 'checking';
        this.qualityCandidate = null;
        this.qualityCandidateStreak = 0;
        if (!badge) return;
        badge.classList.remove(...this.qualityClasses);
        badge.textContent = 'Checking...';
    }

    updateQualityBadge(packetLossPercentage, jitterMilliseconds, rttMilliseconds) {
        const badge = this.getId('networkQualityBadge');
        if (!badge) return;

        this.pushQualityHistory(packetLossPercentage, jitterMilliseconds, rttMilliseconds);

        const smoothedPacketLoss = this.averageNumbers(this.qualityHistory.packetLoss);
        const smoothedJitter = this.averageNumbers(this.qualityHistory.jitter);
        const smoothedRtt = this.averageNumbers(this.qualityHistory.rtt);

        const qualityLevel = this.getQualityLevel(smoothedPacketLoss, smoothedJitter, smoothedRtt);
        const resolvedQuality = this.resolveQualityWithHysteresis(qualityLevel);

        badge.classList.remove(...this.qualityClasses);
        badge.classList.add(`network-quality--${resolvedQuality}`);
        badge.textContent = resolvedQuality;
    }

    pushQualityHistory(packetLossPercentage, jitterMilliseconds, rttMilliseconds) {
        this.qualityHistory.packetLoss.push(
            Number.isFinite(packetLossPercentage) ? Math.max(0, packetLossPercentage) : 0
        );
        this.qualityHistory.jitter.push(Number.isFinite(jitterMilliseconds) ? Math.max(0, jitterMilliseconds) : 0);
        this.qualityHistory.rtt.push(Number.isFinite(rttMilliseconds) ? Math.max(0, rttMilliseconds) : 0);

        if (this.qualityHistory.packetLoss.length > this.qualitySmoothingWindow) this.qualityHistory.packetLoss.shift();
        if (this.qualityHistory.jitter.length > this.qualitySmoothingWindow) this.qualityHistory.jitter.shift();
        if (this.qualityHistory.rtt.length > this.qualitySmoothingWindow) this.qualityHistory.rtt.shift();
    }

    resolveQualityWithHysteresis(nextQuality) {
        if (this.qualityState === 'checking') {
            this.qualityState = nextQuality;
            this.qualityCandidate = null;
            this.qualityCandidateStreak = 0;
            return this.qualityState;
        }

        if (nextQuality === this.qualityState) {
            this.qualityCandidate = null;
            this.qualityCandidateStreak = 0;
            return this.qualityState;
        }

        if (this.qualityCandidate !== nextQuality) {
            this.qualityCandidate = nextQuality;
            this.qualityCandidateStreak = 1;
        } else {
            this.qualityCandidateStreak++;
        }

        const rank = { excellent: 0, good: 1, fair: 2, poor: 3 };
        const currentRank = rank[this.qualityState];
        const nextRank = rank[nextQuality];
        const isWorse = nextRank > currentRank;
        const requiredStreak = isWorse ? 3 : 5;

        if (this.qualityCandidateStreak >= requiredStreak) {
            this.qualityState = nextQuality;
            this.qualityCandidate = null;
            this.qualityCandidateStreak = 0;
        }

        return this.qualityState;
    }

    getQualityLevel(packetLossPercentage, jitterMilliseconds, rttMilliseconds) {
        const loss = Number.isFinite(packetLossPercentage) ? packetLossPercentage : 0;
        const jitter = Number.isFinite(jitterMilliseconds) ? jitterMilliseconds : 0;
        const rtt = Number.isFinite(rttMilliseconds) ? rttMilliseconds : 0;

        if (loss <= 1 && jitter <= 30 && rtt <= 120) return 'excellent';
        if (loss <= 3 && jitter <= 70 && rtt <= 220) return 'good';
        if (loss <= 6 && jitter <= 120 && rtt <= 350) return 'fair';
        return 'poor';
    }

    renderStats(stats = null) {
        const sentEl = this.getId('networkSentValue');
        const receivedEl = this.getId('networkReceivedValue');
        const packetLossEl = this.getId('networkPacketLossValue');
        const jitterEl = this.getId('networkJitterValue');
        const rttEl = this.getId('networkRttValue');

        if (!sentEl || !receivedEl || !packetLossEl || !jitterEl || !rttEl) return;

        const sentBitrate = stats?.sentBitrate ?? 0;
        const receivedBitrate = stats?.receivedBitrate ?? 0;
        const packetLossPercentage = stats?.packetLossPercentage ?? 0;
        const jitterSeconds = stats?.jitterSeconds ?? 0;
        const rttSeconds = stats?.rttSeconds ?? 0;

        sentEl.textContent = this.formatBitrate(sentBitrate);
        receivedEl.textContent = this.formatBitrate(receivedBitrate);
        packetLossEl.textContent = Number.isFinite(packetLossPercentage)
            ? `${Math.max(0, packetLossPercentage).toFixed(2)}%`
            : '0.00%';
        jitterEl.textContent = this.formatSecondsToMilliseconds(jitterSeconds);
        rttEl.textContent = this.formatSecondsToMilliseconds(rttSeconds);
    }
}

window.NetworkStats = NetworkStats;
