<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

require_auth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(['error' => 'Method not allowed'], 405);
}

const COMMENT_MODEL = 'claude-opus-5';
const COMMENT_HISTORY = 8;

$key = defined('ANTHROPIC_API_KEY') ? (string)ANTHROPIC_API_KEY : '';
if ($key === '') {
    send_json(['error' => 'Comments are not configured'], 503);
}

$body = read_json_body();
$bookId = (string)($body['bookId'] ?? '');
// Weekly numbers come from the client, which owns the reading-week logic
// (Saturday–Friday, local time). They only feed the prompt.
$week = [
    'pagesThisWeek' => max(0, (int)($body['pagesThisWeek'] ?? 0)),
    'target' => max(1, (int)($body['weeklyTarget'] ?? DEFAULT_WEEKLY_TARGET)),
    'daysLeft' => min(7, max(0, (int)($body['daysLeftInWeek'] ?? 0))),
];

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

$text = generate_comment($key, $book, $week);
if ($text === null) {
    send_json(['error' => 'Could not generate a comment'], 502);
}

// Re-read before writing so a page update that landed meanwhile isn't lost.
$data = read_data();
$updatedBook = null;
foreach ($data['books'] as &$b) {
    if ($b['id'] === $bookId) {
        $comments = $b['comments'] ?? [];
        $comments[] = ['text' => $text, 'page' => $book['currentPage'], 'at' => date('c')];
        $b['comments'] = array_slice($comments, -COMMENT_HISTORY);
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

function build_prompt(array $book, array $week): string
{
    $history = $book['history'];
    $previousPage = count($history) >= 2 ? $history[count($history) - 2]['page'] : null;
    $justRead = $previousPage !== null ? $book['currentPage'] - $previousPage : null;
    $weekLeft = max(0, $week['target'] - $week['pagesThisWeek']);

    $lines = [
        'Bog: ' . $book['title'] . ($book['author'] ? ' af ' . $book['author'] : ''),
        'Læseren er nu på side ' . $book['currentPage']
            . ($book['totalPages'] ? ' af ' . $book['totalPages']
                . ' (' . round(100 * min(1, $book['currentPage'] / $book['totalPages'])) . ' %)' : ''),
    ];
    if ($justRead !== null) {
        $lines[] = $justRead > 0
            ? "Siden sidste registrering har læseren læst $justRead sider."
            : 'Læseren har ikke rykket sig siden sidste registrering.';
    } else {
        $lines[] = 'Det er første registrering for denne bog.';
    }
    $lines[] = "Ugens mål: {$week['target']} sider. Læst i denne uge: {$week['pagesThisWeek']} sider."
        . ($weekLeft > 0
            ? " Mangler $weekLeft sider, og der er {$week['daysLeft']} dag(e) tilbage af læseugen (lørdag–fredag)."
            : ' Ugens mål er nået!');

    $previous = array_column($book['comments'] ?? [], 'text');
    if ($previous) {
        $lines[] = "\nTidligere kommentarer (gentag ikke disse eller deres pointer/vendinger):\n- "
            . implode("\n- ", $previous);
    }

    return implode("\n", $lines);
}

function generate_comment(string $key, array $book, array $week): ?string
{
    $system = <<<'TXT'
Du skriver korte kommentarer i en læseapp til Isac, en dansk dreng på 13-15 år. Hver gang han registrerer, hvor langt han er nået i en bog, får han én kommentar på kortet for bogen. Formålet er, at han får lyst til at læse mere og har det sjovt imens.

Kommentaren skal:
- være på dansk, 1-3 korte sætninger (højst ca. 40 ord)
- være positiv, sjov eller kækt drillende, i en tone der passer til en teenager, gerne tør humor, aldrig barnlig eller belærende
- høre hjemme i bogens univers. Skift mellem forskellige vinkler, for eksempel: hovedpersonen (eller en anden figur) der taler direkte til Isac med sin egen stemme, en sjov fakta om bogen, forfatteren eller universet, eller en drillende udfordring
- gerne flette hans fremskridt ind: hvor langt han er i bogen, hvor tæt han er på ugens mål, eller en opfordring til at læse lidt mere
- være ny: brug ikke de samme vittigheder, pointer eller vendinger som i de tidligere kommentarer

Regler:
- Ingen spoilers. Nævn ikke noget, der sker senere i bogen end der, hvor Isac er nået til.
- Brug kun detaljer om bogen, som du er sikker på passer. Kender du ikke bogen godt, så hold dig til titlen, genren og hans fremskridt frem for at opdigte figurer eller handling.
- Hvis han ikke har læst noget siden sidst, må du gerne drille venligt, men uden at skælde ud.
- Højst én emoji.

Svar kun med selve kommentaren, uden anførselstegn eller forklaring.
TXT;

    $payload = [
        'model' => COMMENT_MODEL,
        'max_tokens' => 4000,
        'thinking' => ['type' => 'adaptive'],
        // Low effort keeps the wait short; this is a short creative text.
        'output_config' => ['effort' => 'low'],
        // If a safety classifier ever declines, let the API retry on its
        // recommended fallback model instead of returning nothing.
        'fallbacks' => 'default',
        'system' => $system,
        'messages' => [
            ['role' => 'user', 'content' => build_prompt($book, $week)],
        ],
    ];

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
    curl_close($ch);

    if ($raw === false || $status !== 200) {
        error_log("laeselog comment: Anthropic API returned $status: " . substr((string)$raw, 0, 500));
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
    // Strip surrounding whitespace/quotes. Must be a /u regex: trim() works
    // on bytes and would cut the multi-byte tail off a closing emoji.
    $text = preg_replace('/^[\s"“”„«»]+|[\s"“”„«»]+$/u', '', $text) ?? '';
    return $text !== '' ? $text : null;
}
