<?php

$API_KEY_SECRET = "mirotalksfu_default_secret";
$MIROTALK_URL = "https://sfu.mirotalk.com/api/v1/meeting";
// $MIROTALK_URL = "http://localhost:3010/api/v1/meeting";

$ROOM = "test";

// Optional: redirect URL (leave empty for home page)
$data = json_encode([
    // 'redirect' => 'https://example.com/meeting-ended',
]);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, "$MIROTALK_URL/$ROOM");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
curl_setopt($ch, CURLOPT_POSTFIELDS, $data);

$headers = [
    'authorization:' . $API_KEY_SECRET,
    'Content-Type: application/json'
];

curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
$response = curl_exec($ch);
$httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

curl_close($ch);

echo "Status code: $httpcode \n";
$data = json_decode($response);
echo "result: ";
print_r($data);
echo "\n";
