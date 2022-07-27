#!/bin/bash

API_KEY="mirotalksfu_default_secret"
MIROTALK_URL="https://sfu.mirotalk.com/api/v1/join"
# MIROTALK_URL="http://localhost:3010/api/v1/join"

curl $MIROTALK_URL \
    --header "authorization: $API_KEY" \
    --header "Content-Type: application/json" \
    --data '{"room":"test","password":"0","name":"mirotalksfu","audio":"1","video":"1","screen":"1","notify":"1"}' \
    --request POST