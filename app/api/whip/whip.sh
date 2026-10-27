#!/bin/bash

API_KEY_SECRET="mirotalksfu_default_secret"
MIROTALK_URL="https://sfu.mirotalk.com/api/v1/whip"
#MIROTALK_URL="http://localhost:3010/api/v1/whip"

# Returns { whip, token }: use them in OBS Studio -> Settings -> Stream -> Service: WHIP
# (Server: whip, Bearer Token: token) or with any other WHIP client.
curl $MIROTALK_URL \
    --header "authorization: $API_KEY_SECRET" \
    --header "Content-Type: application/json" \
    --data '{"room":"test","name":"OBS","expire":"4h"}' \
    --request POST
