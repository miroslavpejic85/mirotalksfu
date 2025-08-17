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
