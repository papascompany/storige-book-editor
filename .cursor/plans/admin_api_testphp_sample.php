<?php

declare(strict_types=1);

require_once __DIR__ . '/../../test-php/php/config.php';

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

function usage(): void
{
    $usage = <<<TXT
Admin -> API -> test-php sample launcher

Usage:
  php .cursor/plans/admin_api_testphp_sample.php [options]

Options:
  --productId=PROD-001
  --templateSetId=uuid-or-code
  --sortcode=001001001
  --stanSeqno=1
  --apiKey=YOUR_API_KEY
  --pages=20
  --mode=both
  --orderSeqno=1
  --editorBaseUrl=http://localhost:8080/editor.php

Rules:
  1. If --templateSetId is given, it is used directly.
  2. If --templateSetId is missing, the script tries:
     GET /api/product-template-sets/by-product?sortcode=...&stanSeqno=...
  3. The script logs in with test-php's existing auth/login flow and prints
     the final editor launch URL.
TXT;

    fwrite(STDOUT, $usage . PHP_EOL);
}

function parseOptions(): array
{
    $options = getopt('', [
        'productId::',
        'templateSetId::',
        'sortcode::',
        'stanSeqno::',
        'apiKey::',
        'pages::',
        'mode::',
        'orderSeqno::',
        'editorBaseUrl::',
        'help::',
    ]);

    if (isset($options['help'])) {
        usage();
        exit(0);
    }

    return [
        'productId' => $options['productId'] ?? 'PROD-001',
        'templateSetId' => $options['templateSetId'] ?? null,
        'sortcode' => $options['sortcode'] ?? null,
        'stanSeqno' => isset($options['stanSeqno']) ? (int) $options['stanSeqno'] : null,
        'apiKey' => $options['apiKey'] ?? null,
        'pages' => isset($options['pages']) ? (int) $options['pages'] : 20,
        'mode' => $options['mode'] ?? 'both',
        'orderSeqno' => isset($options['orderSeqno']) ? (int) $options['orderSeqno'] : 1,
        'editorBaseUrl' => $options['editorBaseUrl'] ?? 'http://localhost:8080/editor.php',
    ];
}

function requestJson(
    string $method,
    string $url,
    array $headers = [],
    ?array $body = null
): array {
    $curl = curl_init();

    $mergedHeaders = array_merge(
        ['Accept: application/json'],
        $headers
    );

    curl_setopt_array($curl, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $mergedHeaders,
        CURLOPT_TIMEOUT => 10,
    ]);

    if ($body !== null) {
        $mergedHeaders[] = 'Content-Type: application/json';
        curl_setopt($curl, CURLOPT_HTTPHEADER, $mergedHeaders);
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }

    $raw = curl_exec($curl);
    $httpCode = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    if ($error !== '') {
        return [
            'success' => false,
            'httpCode' => 0,
            'error' => $error,
            'data' => null,
        ];
    }

    return [
        'success' => $httpCode >= 200 && $httpCode < 300,
        'httpCode' => $httpCode,
        'error' => null,
        'data' => $raw !== false ? json_decode($raw, true) : null,
    ];
}

function fetchTemplateSetsByProduct(string $apiKey, string $sortcode, ?int $stanSeqno): array
{
    $query = ['sortcode' => $sortcode];
    if ($stanSeqno !== null) {
        $query['stanSeqno'] = (string) $stanSeqno;
    }

    $url = API_BASE_URL . '/product-template-sets/by-product?' . http_build_query($query);

    return requestJson('GET', $url, [
        'X-API-Key: ' . $apiKey,
    ]);
}

function chooseTemplateSet(array $templateSets): ?array
{
    if ($templateSets === []) {
        return null;
    }

    foreach ($templateSets as $templateSet) {
        if (!empty($templateSet['isDefault'])) {
            return $templateSet;
        }
    }

    return $templateSets[0];
}

function buildEditorLaunchUrl(array $config): string
{
    $query = [
        'productId' => $config['productId'],
        'templateSetId' => $config['templateSetId'],
        'pages' => $config['pages'],
        'mode' => $config['mode'],
        'orderSeqno' => $config['orderSeqno'],
    ];

    return $config['editorBaseUrl'] . '?' . http_build_query($query);
}

function printSection(string $title): void
{
    fwrite(STDOUT, PHP_EOL . '=== ' . $title . ' ===' . PHP_EOL);
}

$config = parseOptions();

printSection('1. Login with existing test-php auth flow');

$token = getEditorToken();
if ($token === null) {
    fwrite(STDERR, 'Failed to get JWT from /api/auth/login' . PHP_EOL);
    exit(1);
}

fwrite(STDOUT, 'JWT acquired: yes' . PHP_EOL);
fwrite(STDOUT, 'API_BASE_URL: ' . API_BASE_URL . PHP_EOL);

if ($config['templateSetId'] === null) {
    printSection('2. Resolve templateSetId from Admin mapping API');

    if ($config['apiKey'] === null || $config['sortcode'] === null) {
        fwrite(STDERR, 'templateSetId is missing. Provide either --templateSetId or both --apiKey and --sortcode.' . PHP_EOL);
        exit(1);
    }

    $lookup = fetchTemplateSetsByProduct($config['apiKey'], $config['sortcode'], $config['stanSeqno']);
    if (!$lookup['success']) {
        fwrite(
            STDERR,
            'Failed to call by-product API. HTTP=' . $lookup['httpCode'] . ' error=' . ($lookup['error'] ?? 'unknown') . PHP_EOL
        );
        exit(1);
    }

    $templateSets = $lookup['data']['templateSets'] ?? [];
    $selected = chooseTemplateSet($templateSets);

    if ($selected === null) {
        fwrite(STDERR, 'No template sets returned from by-product API.' . PHP_EOL);
        exit(1);
    }

    $config['templateSetId'] = $selected['id'];

    fwrite(STDOUT, 'sortcode: ' . $config['sortcode'] . PHP_EOL);
    fwrite(STDOUT, 'stanSeqno: ' . ($config['stanSeqno'] !== null ? (string) $config['stanSeqno'] : '(none)') . PHP_EOL);
    fwrite(STDOUT, 'selected templateSetId: ' . $config['templateSetId'] . PHP_EOL);
    fwrite(STDOUT, 'selected template name: ' . ($selected['name'] ?? '(unknown)') . PHP_EOL);
} else {
    printSection('2. Use templateSetId directly');
    fwrite(STDOUT, 'templateSetId: ' . $config['templateSetId'] . PHP_EOL);
}

printSection('3. Build test-php editor launch URL');

$launchUrl = buildEditorLaunchUrl($config);

fwrite(STDOUT, 'productId: ' . $config['productId'] . PHP_EOL);
fwrite(STDOUT, 'pages: ' . (string) $config['pages'] . PHP_EOL);
fwrite(STDOUT, 'mode: ' . $config['mode'] . PHP_EOL);
fwrite(STDOUT, 'orderSeqno: ' . (string) $config['orderSeqno'] . PHP_EOL);
fwrite(STDOUT, 'editor launch URL:' . PHP_EOL);
fwrite(STDOUT, $launchUrl . PHP_EOL);

printSection('4. Equivalent embed config');

$embedConfig = [
    'templateSetId' => $config['templateSetId'],
    'productId' => $config['productId'],
    'token' => '[JWT omitted]',
    'apiBaseUrl' => 'http://localhost:4000/api',
    'mode' => $config['mode'],
    'orderSeqno' => $config['orderSeqno'],
    'options' => [
        'pages' => $config['pages'],
    ],
];

fwrite(STDOUT, json_encode($embedConfig, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);

printSection('5. Next action');
fwrite(STDOUT, 'Open the launch URL in a browser, finish editing, then verify callback.php and webhook.php.' . PHP_EOL);
