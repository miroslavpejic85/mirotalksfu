#!/bin/bash

API_KEY_SECRET="mirotalksfu_default_secret"
MIROTALK_URL="https://sfu.mirotalk.com/api/v1/meeting"
# MIROTALK_URL="http://localhost:3010/api/v1/meeting"

ROOM="test"

# Optional: redirect URL (leave empty object for home page)
# BODY='{"redirect": "https://example.com/meeting-ended"}'
BODY='{}'

curl "$MIROTALK_URL/$ROOM" \
    --header "authorization: $API_KEY_SECRET" \
    --header "Content-Type: application/json" \
    --data "$BODY" \
    --request DELETE
