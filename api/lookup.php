<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

require_auth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    send_json(['error' => 'Method not allowed'], 405);
}

$title = trim((string)($_GET['title'] ?? ''));
$author = trim((string)($_GET['author'] ?? ''));

if ($title === '') {
    send_json(['error' => 'Title is required'], 422);
}

const MAX_RESULTS = 6;

// Candidate books for the user to pick from. Isac mostly reads Danish books,
// so Google Books (best coverage of Danish editions) is asked first,
// restricted to Danish, and Open Library fills in the rest. Either source
// failing just means fewer candidates — the user can always add the book
// without a match.
$results = array_merge(
    google_books_lookup($title, $author),
    open_library_lookup($title, $author)
);

send_json(['results' => dedupe_candidates($results)]);

function http_get_json(string $url): ?array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT => 'Laeselog/1.0 (dsfog.dk)',
        ]);
        $raw = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false || $status !== 200) {
            return null;
        }
    } else {
        $context = stream_context_create(['http' => [
            'timeout' => 6,
            'user_agent' => 'Laeselog/1.0 (dsfog.dk)',
            'ignore_errors' => false,
        ]]);
        $raw = @file_get_contents($url, false, $context);
        if ($raw === false) {
            return null;
        }
    }
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : null;
}

function https_url(?string $url): ?string
{
    if (!is_string($url) || $url === '') {
        return null;
    }
    return preg_replace('#^http://#', 'https://', $url);
}

function positive_int($value): ?int
{
    return is_numeric($value) && (int)$value > 0 ? (int)$value : null;
}

function google_books_lookup(string $title, string $author): array
{
    $key = defined('GOOGLE_BOOKS_API_KEY') ? (string)GOOGLE_BOOKS_API_KEY : '';
    if ($key === '') {
        return [];
    }

    $q = 'intitle:' . $title;
    if ($author !== '') {
        $q .= ' inauthor:' . $author;
    }
    $params = http_build_query([
        'q' => $q,
        'langRestrict' => 'da',
        'printType' => 'books',
        'maxResults' => MAX_RESULTS,
        'key' => $key,
    ]);
    $data = http_get_json('https://www.googleapis.com/books/v1/volumes?' . $params);

    $out = [];
    foreach ($data['items'] ?? [] as $item) {
        $info = $item['volumeInfo'] ?? [];
        if (empty($info['title'])) {
            continue;
        }
        $fullTitle = $info['title'] . (!empty($info['subtitle']) ? ': ' . $info['subtitle'] : '');
        $cover = $info['imageLinks']['thumbnail'] ?? $info['imageLinks']['smallThumbnail'] ?? null;
        $out[] = [
            'title' => $fullTitle,
            'author' => implode(', ', $info['authors'] ?? []),
            'year' => substr((string)($info['publishedDate'] ?? ''), 0, 4) ?: null,
            'totalPages' => positive_int($info['pageCount'] ?? null),
            'pagesEstimated' => false,
            'coverUrl' => $cover ? str_replace('&edge=curl', '', https_url($cover)) : null,
            'language' => $info['language'] ?? null,
            'source' => 'Google Books',
        ];
    }
    return $out;
}

function open_library_lookup(string $title, string $author): array
{
    // lang=da makes the nested "editions" pick the Danish edition of each
    // work when one exists, so we get the Danish title/cover/page count
    // rather than the original-language ones. Note: "editions" only comes
    // back populated when the work "key" is also requested.
    $params = [
        'title' => $title,
        'lang' => 'da',
        'limit' => (string)MAX_RESULTS,
        'fields' => 'key,title,language,author_name,cover_i,first_publish_year,number_of_pages_median,'
            . 'editions,editions.title,editions.number_of_pages,editions.cover_i,'
            . 'editions.language,editions.publish_date',
    ];
    if ($author !== '') {
        $params['author'] = $author;
    }
    $data = http_get_json('https://openlibrary.org/search.json?' . http_build_query($params));

    $out = [];
    foreach ($data['docs'] ?? [] as $doc) {
        $edition = $doc['editions']['docs'][0] ?? [];
        $editionIsDanish = in_array('dan', $edition['language'] ?? [], true);
        $useEdition = $editionIsDanish ? $edition : [];
        // A work published only in Danish counts as Danish even when
        // Open Library has no edition details for it.
        $isDanish = $editionIsDanish || ($doc['language'] ?? []) === ['dan'];

        $editionPages = positive_int($useEdition['number_of_pages'] ?? null);
        $medianPages = positive_int($doc['number_of_pages_median'] ?? null);
        $coverId = $useEdition['cover_i'] ?? $doc['cover_i'] ?? null;
        $year = $useEdition['publish_date'][0] ?? $doc['first_publish_year'] ?? null;
        if ($year !== null && preg_match('/\d{4}/', (string)$year, $m)) {
            $year = $m[0];
        }

        $out[] = [
            'title' => $useEdition['title'] ?? $doc['title'] ?? '',
            'author' => implode(', ', $doc['author_name'] ?? []),
            'year' => $year !== null ? (string)$year : null,
            'totalPages' => $editionPages ?? $medianPages,
            // A median across all editions/languages is only a rough guess
            // for the Danish edition — flag it so the UI can say so.
            'pagesEstimated' => $editionPages === null && $medianPages !== null,
            'coverUrl' => $coverId ? "https://covers.openlibrary.org/b/id/{$coverId}-M.jpg" : null,
            'language' => $isDanish ? 'da' : null,
            'source' => 'Open Library',
        ];
    }
    return $out;
}

function dedupe_candidates(array $results): array
{
    $seen = [];
    $out = [];
    foreach ($results as $r) {
        if ($r['title'] === '') {
            continue;
        }
        $key = mb_strtolower($r['title'] . '|' . $r['author'] . '|' . ($r['totalPages'] ?? ''));
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $out[] = $r;
    }

    // Danish editions first, then ones with a (real) page count.
    usort($out, function ($a, $b) {
        $score = fn($r) => ($r['language'] === 'da' ? 2 : 0)
            + ($r['totalPages'] !== null && !$r['pagesEstimated'] ? 1 : 0);
        return $score($b) <=> $score($a);
    });

    return array_slice($out, 0, MAX_RESULTS);
}
