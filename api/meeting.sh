#!/bin/bash

API_KEY="mirotalksfu_default_secret"
MIROTALK_URL="http://localhost:3010/api/v1/meeting"

curl $MIROTALK_URL \
    --header "authorization: $API_KEY" \
    --header "Content-Type: application/json" \
    --request POST