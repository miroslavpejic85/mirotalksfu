import requests
import json

API_KEY = "mirotalksfu_default_secret"
MIROTALK_URL = "https://sfu.mirotalk.org/api/v1/join"

headers = {
    "authorization": API_KEY,
    "Content-Type": "application/json",
}

data = {
    "room": "test",
    "name": "mirotalksfu",
    "audio": "true",
    "video": "true",
    "notify": "true",
}

response = requests.post(
    MIROTALK_URL,
    headers=headers,
    json=data,
)

print("Status code:", response.status_code)
data = json.loads(response.text)
print("join:", data["join"])
