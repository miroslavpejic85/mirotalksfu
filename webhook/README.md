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

- **Events**: `join`, `exit`, `disconnect`.
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
