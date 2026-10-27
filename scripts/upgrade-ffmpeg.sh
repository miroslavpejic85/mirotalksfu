#!/usr/bin/env bash

# Upgrade FFmpeg to a patched static build on Ubuntu and Debian servers.
#
# Debian/Ubuntu apt still ship FFmpeg versions (e.g. 4.4.x, 5.1.x) that are
# vulnerable to a heap buffer overflow in the VobSub subtitle demuxer
# (libavformat/mpeg.c, vobsub_read_header). A crafted .idx that alternates
# stream IDs grows nb_streams past the fixed q[32] queue and crashes FFmpeg
# (SIGSEGV). The fix is only in FFmpeg >= 9.0 / >= 8.1.3 and is not backported
# to the distro packages, so this installs a maintained static build instead.
#
# Run from the repository root with: sudo ./scripts/upgrade-ffmpeg.sh

set -Eeuo pipefail

readonly MIN_MAJOR=9
readonly INSTALL_DIR='/usr/local/bin'
readonly BTBN_BASE='https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ -n "${TERM:-}" ]]; then
    readonly RED="$(tput setaf 1)"
    readonly YELLOW="$(tput setaf 3)"
    readonly MAGENTA="$(tput setaf 5)"
    readonly RESET="$(tput sgr0)"
else
    readonly RED=''
    readonly YELLOW=''
    readonly MAGENTA=''
    readonly RESET=''
fi

log() {
    local level="$1"
    shift
    local color="$MAGENTA"

    case "$level" in
        warning) color="$YELLOW" ;;
        error) color="$RED" ;;
    esac

    printf '%s :: %b%s%b\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$color" "$*" "$RESET"
}

die() {
    log error "$*" >&2
    exit 1
}

on_error() {
    local exit_code=$?
    log error "FFmpeg upgrade failed near line ${BASH_LINENO[0]} (exit ${exit_code})." >&2
    exit "$exit_code"
}

trap on_error ERR

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

# Map the machine architecture to the BtbN static-build suffix.
btbn_arch() {
    case "$(uname -m)" in
        x86_64|amd64) printf 'linux64' ;;
        aarch64|arm64) printf 'linuxarm64' ;;
        *) die "Unsupported architecture: $(uname -m). Install a static FFmpeg >= ${MIN_MAJOR}.0 manually." ;;
    esac
}

# Reject a build older than MIN_MAJOR; a static "master" build reports a date-
# based version (e.g. N-xxxxx or 2026-...), which is always newer than 9.0.
is_fixed_version() {
    local version="$1"
    local major="${version%%.*}"

    [[ "$major" =~ ^[0-9]+$ ]] || return 0
    (( major >= MIN_MAJOR ))
}

# Build a tiny alternating-stream-id VobSub payload and confirm FFmpeg no longer
# crashes on it. Exit 139 (SIGSEGV) means still vulnerable; anything else is fine.
verify_not_vulnerable() {
    local ffmpeg_bin="$1"
    local work idx sub exit_code i

    work="$(mktemp -d)"
    idx="${work}/payload.idx"
    sub="${work}/payload.sub"

    printf '# VobSub index file, v7 (do not modify this line!)\n# Language: und\n\n' > "$idx"
    for (( i = 0; i < 70; i++ )); do
        printf 'id: %d, index: %d\ntimestamp: 00:00:%02d:000, filepos: %08X\n\n' \
            "$(( i % 2 ))" "$(( i % 2 ))" "$(( i % 60 ))" "$(( (i + 1) * 256 ))" >> "$idx"
    done
    head -c 4096 /dev/zero > "$sub"

    set +e
    "$ffmpeg_bin" -hide_banner -loglevel error -i "$idx" -f null - >/dev/null 2>&1
    exit_code=$?
    set -e

    rm -rf "$work"

    if (( exit_code == 139 )); then
        die "VobSub crash still reproduces (exit 139). The installed FFmpeg is not patched."
    fi

    log info "VobSub crash test passed (exit ${exit_code}, not a SIGSEGV)."
}

[[ "$(uname -s)" == 'Linux' ]] || die 'This script supports Linux only.'
[[ "$EUID" -eq 0 ]] || die 'Run this script as root: sudo ./scripts/upgrade-ffmpeg.sh'

require_command curl
require_command tar

arch="$(btbn_arch)"
archive="ffmpeg-master-latest-${arch}-gpl.tar.xz"
url="${BTBN_BASE}/${archive}"

current='none'
if command -v ffmpeg >/dev/null 2>&1; then
    current="$(ffmpeg -version | head -n 1 | sed -E 's/^ffmpeg version ([^ ]+).*/\1/')"
fi
log info "Current FFmpeg: ${current}"

# Remove the distro package so its /usr/bin/ffmpeg cannot shadow the new binary.
if command -v apt-get >/dev/null 2>&1 && dpkg -s ffmpeg >/dev/null 2>&1; then
    log info 'Removing the apt-provided ffmpeg package'
    DEBIAN_FRONTEND=noninteractive apt-get remove -y ffmpeg
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

log info "Downloading static FFmpeg build: ${archive}"
curl -fL --retry 3 -o "${work_dir}/ffmpeg.tar.xz" "$url"

log info 'Extracting archive'
tar -xf "${work_dir}/ffmpeg.tar.xz" -C "$work_dir"

build_dir="$(find "$work_dir" -maxdepth 1 -type d -name 'ffmpeg-*-gpl' | head -n 1)"
[[ -n "$build_dir" && -x "${build_dir}/bin/ffmpeg" ]] || die 'Extracted build does not contain a usable ffmpeg binary.'

installed_version="$("${build_dir}/bin/ffmpeg" -version | head -n 1 | sed -E 's/^ffmpeg version ([^ ]+).*/\1/')"
is_fixed_version "$installed_version" || \
    die "Downloaded FFmpeg ${installed_version} is older than ${MIN_MAJOR}.0 and may be vulnerable."

log info "Installing ffmpeg and ffprobe ${installed_version} into ${INSTALL_DIR}"
install -m 0755 "${build_dir}/bin/ffmpeg" "${INSTALL_DIR}/ffmpeg"
install -m 0755 "${build_dir}/bin/ffprobe" "${INSTALL_DIR}/ffprobe"

hash -r 2>/dev/null || true
resolved="$(command -v ffmpeg || true)"
log info "ffmpeg now resolves to: ${resolved:-unknown}"
if [[ "$resolved" != "${INSTALL_DIR}/ffmpeg" ]]; then
    log warning "${INSTALL_DIR} is not first on PATH; set RTMP_FFMPEG_PATH=${INSTALL_DIR}/ffmpeg in your .env."
fi

verify_not_vulnerable "${INSTALL_DIR}/ffmpeg"

log info "Done. FFmpeg upgraded to ${installed_version}. Restart MiroTalk SFU to use it."
