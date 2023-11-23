#!/bin/bash

API_KEY_SECRET="mirotalksfu_default_secret"
MIROTALK_URL="https://sfu.mirotalk.com/api/v1/join"
# MIROTALK_URL="http://localhost:3010/api/v1/join"

curl $MIROTALK_URL \
    --header "authorization: $API_KEY_SECRET" \
    --header "Content-Type: application/json" \
    --data '{"room":"test","roomPassword":"false","name":"mirotalksfu","audio":"true","video":"true","screen":"false","hide":"false","notify":"true"}' \
    --request POST