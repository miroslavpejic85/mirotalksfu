import requests
import json

API_KEY = "mirotalksfu_default_secret"
MIROTALK_URL = "http://localhost:3010/api/v1/meeting"

headers = {
    "authorization": API_KEY,
    "Content-Type": "application/json",
}

response = requests.post(
    MIROTALK_URL,
    headers=headers
)

print("Status code:", response.status_code)
data = json.loads(response.text)
print("meeting:", data["meeting"])
