'use strict';

// Minimal Node helper: fixWebmDurationBuffer(buffer: Buffer, durationMs: number) -> Buffer
function padHex(h) {
    return h.length % 2 === 1 ? '0' + h : h;
}

class WebmBase {
    constructor(name, type) {
        this.name = name || 'Unknown';
        this.type = type || 'Unknown';
    }
    updateBySource() {}
    setSource(s) {
        this.source = s;
        this.updateBySource();
    }
    updateByData() {}
    setData(d) {
        this.data = d;
        this.updateByData();
    }
}
class WebmUint extends WebmBase {
    constructor() {
        super('Uint', 'Uint');
    }
    updateBySource() {
        this.data = '';
        for (let i = 0; i < this.source.length; i++) this.data += padHex(this.source[i].toString(16));
    }
    updateByData() {
        const len = this.data.length / 2;
        this.source = new Uint8Array(len);
        for (let i = 0; i < len; i++) this.source[i] = parseInt(this.data.substr(i * 2, 2), 16);
    }
    getValue() {
        return parseInt(this.data, 16);
    }
    setValue(v) {
        this.setData(padHex(v.toString(16)));
    }
}
class WebmFloat extends WebmBase {
    constructor() {
        super('Float', 'Float');
    }
    _arrType() {
        return this.source && this.source.length === 4 ? Float32Array : Float64Array;
    }
    updateBySource() {
        const bytes = this.source.slice().reverse();
        const T = this._arrType();
        this.data = new T(bytes.buffer)[0];
    }
    updateByData() {
        const T = this._arrType();
        const fa = new T([this.data]);
        const bytes = new Uint8Array(fa.buffer);
        this.source = bytes.reverse();
    }
    getValue() {
        return this.data;
    }
    setValue(v) {
        this.setData(v);
    }
}
class WebmContainer extends WebmBase {
    constructor(name) {
        super(name || 'Container', 'Container');
    }
    readByte() {
        return this.source[this.offset++];
    }
    readVint() {
        const b0 = this.readByte();
        const bytes = 8 - b0.toString(2).length;
        let v = b0 - (1 << (7 - bytes));
        for (let i = 0; i < bytes; i++) {
            v = v * 256 + this.readByte();
        }
        return v;
    }
    updateBySource() {
        this.data = [];
        for (this.offset = 0; this.offset < this.source.length; ) {
            const id = this.readVint();
            const len = this.readVint();
            const end = Math.min(this.offset + len, this.source.length);
            const bytes = this.source.slice(this.offset, end);
            let ctor = WebmBase;
            if (id === ID.Segment || id === ID.Info) ctor = WebmContainer;
            else if (id === ID.TimecodeScale) ctor = WebmUint;
            else if (id === ID.Duration) ctor = WebmFloat;
            const elem = new ctor();
            elem.setSource(bytes);
            this.data.push({ id, data: elem });
            this.offset = end;
        }
    }
    writeVint(x, draft) {
        let bytes = 1,
            flag = 0x80;
        while (x >= flag && bytes < 8) {
            bytes++;
            flag *= 0x80;
        }
        if (!draft) {
            let val = flag + x;
            for (let i = bytes - 1; i >= 0; i--) {
                const c = val % 256;
                this.source[this.offset + i] = c;
                val = (val - c) / 256;
            }
        }
        this.offset += bytes;
    }
    writeSections(draft) {
        this.offset = 0;
        for (const s of this.data) {
            const content = s.data.source;
            const len = content.length;
            this.writeVint(s.id, draft);
            this.writeVint(len, draft);
            if (!draft) this.source.set(content, this.offset);
            this.offset += len;
        }
        return this.offset;
    }
    updateByData() {
        const len = this.writeSections(true);
        this.source = new Uint8Array(len);
        this.writeSections(false);
    }
    getSectionById(id) {
        for (const s of this.data) {
            if (s.id === id) return s.data;
        }
        return null;
    }
}
class WebmFile extends WebmContainer {
    constructor(src) {
        super('File');
        this.setSource(src);
    }
    toBuffer() {
        return Buffer.from(this.source.buffer);
    }
    fixDuration(durationMs) {
        const segment = this.getSectionById(ID.Segment);
        if (!segment) return false;
        const info = segment.getSectionById(ID.Info);
        if (!info) return false;
        let scale = info.getSectionById(ID.TimecodeScale);
        if (!scale) return false;
        scale.setValue(1000000); // 1ms
        let dur = info.getSectionById(ID.Duration);
        if (dur) {
            if (dur.getValue() > 0) return false;
            dur.setValue(durationMs);
        } else {
            dur = new WebmFloat();
            dur.setValue(durationMs);
            info.data.push({ id: ID.Duration, data: dur });
        }
        info.updateByData();
        segment.updateByData();
        this.updateByData();
        return true;
    }
}
const ID = {
    Segment: 0x8538067, // 0x18538067
    Info: 0x549a966, // 0x1549A966
    TimecodeScale: 0xad7b1, // 0x2AD7B1
    Duration: 0x489, // 0x4489
};

function fixWebmDurationBuffer(inputBuffer, durationMs) {
    if (!Buffer.isBuffer(inputBuffer) || !Number.isFinite(durationMs)) return inputBuffer;
    try {
        const file = new WebmFile(new Uint8Array(inputBuffer));
        const fixed = file.fixDuration(Math.max(0, Math.round(durationMs)));
        return fixed ? file.toBuffer() : inputBuffer;
    } catch {
        return inputBuffer;
    }
}

module.exports = { fixWebmDurationBuffer };
