<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

define('DATA_FILE', __DIR__ . '/data.json');

function start_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_start();
    }
}

function is_authenticated(): bool
{
    start_session();
    return !empty($_SESSION['authenticated']);
}

function send_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function require_auth(): void
{
    if (!is_authenticated()) {
        send_json(['error' => 'Unauthorized'], 401);
    }
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : [];
}

function read_data(): array
{
    if (!file_exists(DATA_FILE)) {
        return ['books' => []];
    }
    $fp = fopen(DATA_FILE, 'r');
    if (!$fp) {
        return ['books' => []];
    }
    flock($fp, LOCK_SH);
    $content = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $data = json_decode((string)$content, true);
    return is_array($data) ? $data : ['books' => []];
}

function write_data(array $data): void
{
    $fp = fopen(DATA_FILE, 'c+');
    if (!$fp) {
        send_json(['error' => 'Could not write data'], 500);
    }
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

function generate_id(): string
{
    return bin2hex(random_bytes(8));
}
