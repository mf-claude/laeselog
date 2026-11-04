<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

require_auth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(['error' => 'Method not allowed'], 405);
}

$key = anthropic_key();
if ($key === '') {
    send_json(['error' => 'Questions are not configured'], 503);
}

$body = read_json_body();
$bookId = (string)($body['bookId'] ?? '');

$data = read_data();
$book = null;
foreach ($data['books'] as $b) {
    if ($b['id'] === $bookId) {
        $book = normalize_book($b);
        break;
    }
}
if ($book === null) {
    send_json(['error' => 'Book not found'], 404);
}

$history = $book['history'];
$fromPage = count($history) >= 2 ? (int)$history[count($history) - 2]['page'] : 0;
$toPage = (int)$book['currentPage'];
if ($toPage <= $fromPage) {
    send_json(['error' => 'No new pages to ask about'], 422);
}

$question = generate_question($key, $book, $fromPage, $toPage);
if ($question === null) {
    send_json(['error' => 'Could not generate a question'], 502);
}

// Re-read before writing so a page update that landed meanwhile isn't lost.
$data = read_data();
$updatedBook = null;
foreach ($data['books'] as &$b) {
    if ($b['id'] === $bookId) {
        $b['pendingQuestion'] = $question;
        $updatedBook = normalize_book($b);
        break;
    }
}
unset($b);

if ($updatedBook === null) {
    send_json(['error' => 'Book not found'], 404);
}

write_data($data);
send_json(['book' => $updatedBook]);

function build_question_prompt(array $book, int $fromPage, int $toPage): string
{
    $lines = [
        'Bog: ' . $book['title'] . ($book['author'] ? ' af ' . $book['author'] : ''),
        "Læseren har lige læst side $fromPage til $toPage.",
    ];
    if ($book['totalPages']) {
        $from = round(100 * min(1, $fromPage / $book['totalPages']));
        $to = round(100 * min(1, $toPage / $book['totalPages']));
        $lines[] = "Bogen har {$book['totalPages']} sider, så det svarer til ca. $from-$to % inde i bogen.";
    } else {
        $lines[] = 'Bogens sidetal kendes ikke, så du ved ikke, hvor langt inde i bogen læseren er.';
    }

    $previous = array_values(array_filter(array_column($book['comments'], 'question')));
    if ($previous) {
        $lines[] = "\nTidligere spørgsmål (stil ikke de samme igen):\n- " . implode("\n- ", $previous);
    }

    return implode("\n", $lines);
}

// Returns ['text' => ..., 'expectedAnswer' => ...]; expectedAnswer is empty
// for an open question that has no right answer to check against.
function generate_question(string $key, array $book, int $fromPage, int $toPage): ?array
{
    $reader = READERS[$book['readerId']];
    $system = str_replace('{name}', $reader['name'], <<<'TXT'
Du stiller ét kort spørgsmål i en læseapp til {name}, en dansk dreng på 13-15 år, lige efter han har registreret, hvor langt han er nået i en bog. Spørgsmålet skal følge op på, om han har forstået det, han lige har læst, og må gerne være sjovt, men det må ikke føles som en prøve.

Du har ikke bogens tekst. Du kender højst bogen fra hukommelsen, sidetal varierer mellem udgaver, og du kan derfor kun skønne, hvor i handlingen han er, ud fra hvor mange procent af bogen han har læst.

Vælg sådan her:
- Kender du bogen godt, og er sidetallet kendt: sæt knowsBook til true, og stil et konkret spørgsmål om noget, du er sikker på sker omkring det sted i bogen eller lidt før. Er du i tvivl om placeringen, så vælg noget, der tydeligt sker før, så du ikke afslører noget. Skriv i expectedAnswer det svar, du forventer, på højst to sætninger.
- Kender du ikke bogen godt, eller kendes sidetallet ikke: sæt knowsBook til false, lad expectedAnswer være tom, og stil et åbent spørgsmål, der passer til alle bøger, for eksempel om hvad der var det vigtigste, der skete, hvad en figur gjorde, eller hvad han tror, der sker nu. Opdigt aldrig figurer, navne eller handling.

Regler:
- Dansk, én sætning, højst ca. 25 ord, i et sprog der passer til en teenager.
- Spørg til forståelse: hvad der skete, hvorfor en figur gjorde noget, eller hvad det betyder. Ikke til småting som farver eller tal.
- Ingen spoilers. Spørgsmålet må ikke afsløre noget, der sker senere end der, hvor han er nået til.
TXT);

    $reply = call_claude_json($key, [
        'system' => $system,
        'messages' => [
            ['role' => 'user', 'content' => build_question_prompt($book, $fromPage, $toPage)],
        ],
    ], 'medium', [
        'type' => 'object',
        'properties' => [
            'knowsBook' => ['type' => 'boolean'],
            'question' => ['type' => 'string'],
            'expectedAnswer' => ['type' => 'string'],
        ],
        'required' => ['knowsBook', 'question', 'expectedAnswer'],
        'additionalProperties' => false,
    ]);

    $text = trim((string)($reply['question'] ?? ''));
    if ($text === '') {
        return null;
    }
    return [
        'text' => $text,
        'expectedAnswer' => !empty($reply['knowsBook']) ? trim((string)($reply['expectedAnswer'] ?? '')) : '',
        'at' => date('c'),
    ];
}
