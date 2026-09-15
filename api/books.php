<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

require_auth();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $data = read_data();

    usort($data['books'], function ($a, $b) {
        $aTime = $a['history'][count($a['history']) - 1]['at'] ?? $a['createdAt'];
        $bTime = $b['history'][count($b['history']) - 1]['at'] ?? $b['createdAt'];
        return strcmp($bTime, $aTime);
    });

    send_json(['books' => array_map('normalize_book', $data['books'])]);
}

if ($method === 'POST') {
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    $author = trim((string)($body['author'] ?? ''));
    $startPage = $body['startPage'] ?? 0;
    $weeklyTarget = $body['weeklyTarget'] ?? DEFAULT_WEEKLY_TARGET;
    $coverUrl = $body['coverUrl'] ?? null;
    $totalPages = $body['totalPages'] ?? null;

    if ($title === '') {
        send_json(['error' => 'Title is required'], 422);
    }

    $startPage = is_numeric($startPage) && (int)$startPage >= 0 ? (int)$startPage : 0;
    $weeklyTarget = is_numeric($weeklyTarget) && (int)$weeklyTarget > 0
        ? (int)$weeklyTarget
        : DEFAULT_WEEKLY_TARGET;
    $coverUrl = is_string($coverUrl) && preg_match('#^https://#', $coverUrl) ? $coverUrl : null;
    $totalPages = is_numeric($totalPages) && (int)$totalPages > 0 ? (int)$totalPages : null;

    $now = date('c');
    $book = [
        'id' => generate_id(),
        'title' => $title,
        'author' => $author,
        'currentPage' => $startPage,
        'weeklyTarget' => $weeklyTarget,
        'coverUrl' => $coverUrl,
        'totalPages' => $totalPages,
        'createdAt' => $now,
        'history' => [
            ['page' => $startPage, 'at' => $now],
        ],
    ];

    $data = read_data();
    $data['books'][] = $book;
    write_data($data);

    send_json(['book' => $book], 201);
}

if ($method === 'PATCH') {
    $body = read_json_body();
    $id = (string)($body['id'] ?? '');
    $weeklyTarget = $body['weeklyTarget'] ?? null;

    if ($id === '' || !is_numeric($weeklyTarget) || (int)$weeklyTarget <= 0) {
        send_json(['error' => 'Invalid input'], 422);
    }

    $data = read_data();
    $updatedBook = null;

    foreach ($data['books'] as &$book) {
        if ($book['id'] === $id) {
            $book['weeklyTarget'] = (int)$weeklyTarget;
            $updatedBook = normalize_book($book);
            break;
        }
    }
    unset($book);

    if ($updatedBook === null) {
        send_json(['error' => 'Book not found'], 404);
    }

    write_data($data);
    send_json(['book' => $updatedBook]);
}

if ($method === 'DELETE') {
    $id = $_GET['id'] ?? '';
    if ($id === '') {
        send_json(['error' => 'Missing id'], 422);
    }

    $data = read_data();
    $before = count($data['books']);
    $data['books'] = array_values(array_filter(
        $data['books'],
        fn($b) => $b['id'] !== $id
    ));

    if (count($data['books']) === $before) {
        send_json(['error' => 'Not found'], 404);
    }

    write_data($data);
    send_json(['ok' => true]);
}

send_json(['error' => 'Method not allowed'], 405);
