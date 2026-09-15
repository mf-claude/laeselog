<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

require_auth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(['error' => 'Method not allowed'], 405);
}

$body = read_json_body();
$bookId = (string)($body['bookId'] ?? '');
$page = $body['page'] ?? null;

if ($bookId === '' || !is_numeric($page) || (int)$page < 0) {
    send_json(['error' => 'Invalid input'], 422);
}
$page = (int)$page;

$data = read_data();
$updatedBook = null;

foreach ($data['books'] as &$book) {
    if ($book['id'] === $bookId) {
        $book['currentPage'] = $page;
        $book['history'][] = ['page' => $page, 'at' => date('c')];
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
