<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

define('DATA_FILE', __DIR__ . '/data.json');
define('DEFAULT_WEEKLY_TARGET', 30);
define('CLAUDE_MODEL', 'claude-opus-5-5');

// Who can log reading. goalMode 'book' means each book has its own fixed
// weekly target; 'week' means one goal per reading week, counted across all
// of the reader's books, which may change from week to week.
const READERS = [
    'isac' => ['name' => 'Isac', 'goalMode' => 'book'],
    'johannes' => ['name' => 'Johannes', 'goalMode' => 'week'],
];
// Books from before there were several readers are Isac's.
const DEFAULT_READER = 'isac';

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
    // Encode before touching the file: if encoding fails we must not have
    // truncated data.json already, or every book would be lost.
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        send_json(['error' => 'Could not encode data'], 500);
    }

    $fp = fopen(DATA_FILE, 'c+');
    if (!$fp) {
        send_json(['error' => 'Could not write data'], 500);
    }
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, $json);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

function generate_id(): string
{
    return bin2hex(random_bytes(8));
}

function is_reader(string $id): bool
{
    return array_key_exists($id, READERS);
}

function normalize_book(array $book): array
{
    $reader = $book['readerId'] ?? null;
    $book['readerId'] = is_string($reader) && is_reader($reader) ? $reader : DEFAULT_READER;

    $target = $book['weeklyTarget'] ?? null;
    $book['weeklyTarget'] = is_numeric($target) && (int)$target > 0
        ? (int)$target
        : DEFAULT_WEEKLY_TARGET;

    $coverUrl = $book['coverUrl'] ?? null;
    $book['coverUrl'] = is_string($coverUrl) && $coverUrl !== '' ? $coverUrl : null;

    $totalPages = $book['totalPages'] ?? null;
    $book['totalPages'] = is_numeric($totalPages) && (int)$totalPages > 0
        ? (int)$totalPages
        : null;

    $book['comments'] = is_array($book['comments'] ?? null) ? $book['comments'] : [];

    // Only the question text may reach the browser: the stored expected
    // answer stays on the server, so it can't be read before answering.
    $pending = $book['pendingQuestion'] ?? null;
    $book['pendingQuestion'] = is_array($pending) ? ['text' => $pending['text']] : null;

    return $book;
}

// Weekly goals for 'week'-mode readers, keyed by the Saturday (YYYY-MM-DD)
// the reading week starts on.
function reader_goals(array $data, string $readerId): array
{
    $goals = $data['weeklyGoals'][$readerId] ?? [];
    if (!is_array($goals)) {
        return [];
    }
    ksort($goals);
    return array_map('intval', $goals);
}

function list_readers(array $data): array
{
    $readers = [];
    foreach (READERS as $id => $reader) {
        $readers[] = $reader + [
            'id' => $id,
            'weeklyGoals' => (object)reader_goals($data, $id),
        ];
    }
    return $readers;
}

function anthropic_key(): string
{
    return defined('ANTHROPIC_API_KEY') ? (string)ANTHROPIC_API_KEY : '';
}

// One Messages API call. $params holds 'system' and 'messages'; with a
// $schema the reply is constrained to that JSON. Returns the reply's text,
// or null if there is none.
function call_claude(string $key, array $params, string $effort = 'low', ?array $schema = null): ?string
{
    $payload = $params + [
        'model' => CLAUDE_MODEL,
        'max_tokens' => 4000,
        'thinking' => ['type' => 'adaptive'],
        'output_config' => ['effort' => $effort],
        // If a safety classifier ever declines, let the API retry on its
        // recommended fallback model instead of returning nothing.
        'fallbacks' => 'default',
    ];
    if ($schema !== null) {
        $payload['output_config']['format'] = ['type' => 'json_schema', 'schema' => $schema];
    }

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-api-key: ' . $key,
            'anthropic-version: 2023-06-01',
            'anthropic-beta: server-side-fallback-2026-07-01',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($raw === false || $status !== 200) {
        error_log("laeselog: Anthropic API returned $status: " . substr((string)$raw, 0, 500));
        return null;
    }

    $response = json_decode((string)$raw, true);
    if (!is_array($response) || ($response['stop_reason'] ?? '') === 'refusal') {
        return null;
    }

    $text = '';
    foreach ($response['content'] ?? [] as $block) {
        if (($block['type'] ?? '') === 'text') {
            $text .= $block['text'];
        }
    }
    return $text !== '' ? $text : null;
}

function call_claude_json(string $key, array $params, string $effort, array $schema): ?array
{
    $text = call_claude($key, $params, $effort, $schema);
    $reply = $text === null ? null : json_decode($text, true);
    return is_array($reply) ? $reply : null;
}
