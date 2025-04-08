#!/bin/bash

# Configuration
API_KEY_SECRET="mirotalksfu_default_secret"
MIROTALK_URL="https://sfu.mirotalk.com/api/v1/join"
# Alternative URL for local testing:
# MIROTALK_URL="http://localhost:3010/api/v1/join"

# Request data with proper JSON formatting
REQUEST_DATA='{
    "room": "test",
    "roomPassword": false,
    "name": "mirotalksfu",
    "avatar": false,
    "audio": false,
    "video": false,
    "screen": false,
    "hide": false,
    "notify": true,
    "duration": "unlimited",
    "token": {
        "username": "username",
        "password": "password",
        "presenter": true,
        "expire": "1h"
    }
}'

# Make the API request
curl -X POST "$MIROTALK_URL" \
    -H "Authorization: $API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_DATA"