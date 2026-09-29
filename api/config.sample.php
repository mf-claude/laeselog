<?php
// Copy this file to config.php and set your own password below.
// config.php is gitignored — never commit it with your real password.

define('SITE_PASSWORD', 'change-me');

// Google Books API key (free, from console.cloud.google.com → APIs &
// Services → enable "Books API" → Credentials). Used to find Danish
// editions when adding a book. Leave empty to use Open Library only.
define('GOOGLE_BOOKS_API_KEY', '');

// Anthropic API key (console.anthropic.com → API keys). Used to write the
// fun comment shown on a book after each page update. Leave empty to turn
// comments off.
define('ANTHROPIC_API_KEY', '');
