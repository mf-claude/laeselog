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

    send_json(['books' => $data['books']]);
}

if ($method === 'POST') {
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    $author = trim((string)($body['author'] ?? ''));
    $startPage = $body['startPage'] ?? 0;

    if ($title === '') {
        send_json(['error' => 'Title is required'], 422);
    }

    $startPage = is_numeric($startPage) && (int)$startPage >= 0 ? (int)$startPage : 0;

    $now = date('c');
    $book = [
        'id' => generate_id(),
        'title' => $title,
        'author' => $author,
        'currentPage' => $startPage,
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
