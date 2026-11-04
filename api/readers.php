<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

require_auth();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    send_json(['readers' => list_readers(read_data())]);
}

// Set a 'week'-mode reader's goal for one reading week. The client owns the
// reading-week logic (local time), so it sends the week's Saturday.
if ($method === 'PATCH') {
    $body = read_json_body();
    $id = (string)($body['id'] ?? '');
    $weekStart = (string)($body['weekStart'] ?? '');
    $goal = $body['weeklyGoal'] ?? null;

    if (!is_reader($id) || READERS[$id]['goalMode'] !== 'week') {
        send_json(['error' => 'Unknown reader'], 422);
    }
    $date = DateTime::createFromFormat('!Y-m-d', $weekStart);
    if (!$date || $date->format('Y-m-d') !== $weekStart || $date->format('w') !== '6') {
        send_json(['error' => 'weekStart must be a Saturday (YYYY-MM-DD)'], 422);
    }
    if (!is_numeric($goal) || (int)$goal <= 0) {
        send_json(['error' => 'Invalid weekly goal'], 422);
    }

    $data = read_data();
    $data['weeklyGoals'][$id][$weekStart] = (int)$goal;
    write_data($data);

    send_json(['readers' => list_readers($data)]);
}

send_json(['error' => 'Method not allowed'], 405);
