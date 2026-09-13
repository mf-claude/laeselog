<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

send_json(['authenticated' => is_authenticated()]);
