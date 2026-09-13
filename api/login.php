<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(['error' => 'Method not allowed'], 405);
}

$body = read_json_body();
$password = $body['password'] ?? '';

start_session();

if (is_string($password) && $password !== '' && hash_equals(SITE_PASSWORD, $password)) {
    session_regenerate_id(true);
    $_SESSION['authenticated'] = true;
    send_json(['ok' => true]);
}

send_json(['error' => 'Invalid password'], 401);
