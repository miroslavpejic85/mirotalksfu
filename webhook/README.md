# Webhooks Example

![webhook](./webhooks.png)

This example shows how to set up a server to listen for MiroTalk SFU webhook events (join, exitRoom, disconnect).

### Step 1: Enable Webhooks

Edit the `.env` to enable webhooks:

```bash
WEBHOOK_ENABLED=true
WEBHOOK_URL=https://YOUR-DOMAIN-NAME/webhook-endpoint
```

---

### Step 2: Run the Webhook Server

1. **Install dependencies**:

    ```bash
    npm install
    ```

2. **Start the server**:

    ```bash
    npm start
    ```

---

### Step 3: Webhook Events

MiroTalk SFU sends HTTP `POST` requests to the specified URL with event data:

**Example Payload**:

```json
{
    "event": "join",
    "data": {}
}
```

- **Events**: `join`, `exit`, `disconnect`, `serverRecordingStarted`, `serverRecordingCompleted`.
- **Data**: Includes `event` and custom `data`.

---

### Session ID (conference-instance grouping)

Every `join`, `exit`, and `disconnect` payload includes a `session_id` field inside `data`.

`room_id` (the room name) is static and can be reused at different times by different people, so it cannot identify a single meeting. Instead, a unique `session_id` is generated the moment a room is created (first peer joins) and is destroyed together with the room (last peer leaves). Reusing the same room name later produces a brand-new `session_id`.

This lets you reliably group all events belonging to the same conference instance — regardless of the room name — without relying on fragile "room emptied" gap-detection, which fails if the server crashes and no exit/disconnect event is ever sent.

The same `session_id` is also embedded in the server recording filename:

```text
Rec_<roomName>_<dateTime>_<session_id>.webm
```

so recording files and participants can be correlated directly.

**Example `join` payload with `session_id`**:

```json
{
    "event": "join",
    "data": {
        "timestamp": "7/6/2026, 12:31:34:495",
        "room_id": "partner",
        "session_id": "2f1c8a90-5a1b-4e2f-9c3d-1a2b3c4d5e6f",
        "peer_info": {
            "peer_name": "A USER"
        }
    }
}
```

---

### Server-side recording events

With `RECORDING_SERVER_SIDE_ENABLED=true` the server records the room itself from mediasoup (no browser involved): one audio file per participant, aligned on the recording timeline, plus a mixed file and `manifest.json` (format set by `RECORDING_SERVER_SIDE_FORMAT`: `ogg` default, `mp3`, `m4a`, `wav`), saved in `RECORDING_DIR/ServerRec_<roomName>_<dateTime>_<session_id>/`.

- `serverRecordingStarted`: `room_id`, `session_id`, `started_by` (peer name, or `auto` with `RECORDING_SERVER_SIDE_AUTO_START=true`).
- `serverRecordingCompleted`: sent once the files are written (and uploaded to S3 when `RECORDING_UPLOAD_TO_S3=true`, in which case `s3_keys` lists them and the local copy is removed).

**Example `serverRecordingCompleted` payload**:

```json
{
    "event": "serverRecordingCompleted",
    "data": {
        "timestamp": "11/15/2026, 07:41:29:446",
        "room_id": "partner",
        "session_id": "2f1c8a90-5a1b-4e2f-9c3d-1a2b3c4d5e6f",
        "status": "completed",
        "folder": "ServerRec_partner_2026-11-15T06-41-01-093Z_2f1c8a90-5a1b-4e2f-9c3d-1a2b3c4d5e6f",
        "files": [
            "ServerRec_.../Alice.ogg",
            "ServerRec_.../Bob.ogg",
            "ServerRec_.../mixed.ogg",
            "ServerRec_.../manifest.json"
        ],
        "s3_keys": [],
        "manifest": {
            "status": "completed",
            "duration_ms": 18976,
            "participants": [
                { "peer_name": "Alice", "file": "Alice.ogg", "tracks": ["<producer_id>"] },
                { "peer_name": "Bob", "file": "Bob.ogg", "tracks": ["<producer_id>", "<producer_id>"] }
            ],
            "mixed": "mixed.ogg",
            "tracks": [{ "producer_id": "<producer_id>", "peer_name": "Bob", "start_ms": 7120, "end_ms": 12950 }]
        }
    }
}
```

Every participant file and the mixed file start at `started_at` and last `duration_ms`, so per-participant transcripts share the same timeline. `status` is `completed`, `partial` (post-processing failed: raw tracks are kept), `raw` (server shutdown: only raw tracks) or `empty` (nobody spoke).
