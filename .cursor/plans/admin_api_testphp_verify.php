<?php

declare(strict_types=1);

require_once __DIR__ . '/../../test-php/php/config.php';

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

function verifyUsage(): void
{
    $usage = <<<TXT
Admin -> API -> test-php verification script

Usage:
  php .cursor/plans/admin_api_testphp_verify.php [options]

Options:
  --productId=PROD-001
  --templateSetId=ts-001
  --sortcode=001001001
  --stanSeqno=1
  --apiKey=YOUR_API_KEY
  --orderSeqno=12345
  --jobId=test-job-001
  --editorBaseUrl=http://localhost:8080/editor.php
  --webhookUrl=http://localhost:8080/webhook.php
  --sendTestWebhook
  --help
TXT;

    fwrite(STDOUT, $usage . PHP_EOL);
}

function parseVerifyOptions(): array
{
    $options = getopt('', [
        'productId::',
        'templateSetId::',
        'sortcode::',
        'stanSeqno::',
        'apiKey::',
        'orderSeqno::',
        'jobId::',
        'editorBaseUrl::',
        'webhookUrl::',
        'sendTestWebhook',
        'help',
    ]);

    if (isset($options['help'])) {
        verifyUsage();
        exit(0);
    }

    return [
        'productId' => $options['productId'] ?? 'PROD-001',
        'templateSetId' => $options['templateSetId'] ?? null,
        'sortcode' => $options['sortcode'] ?? null,
        'stanSeqno' => isset($options['stanSeqno']) ? (int) $options['stanSeqno'] : null,
        'apiKey' => $options['apiKey'] ?? null,
        'orderSeqno' => isset($options['orderSeqno']) ? (int) $options['orderSeqno'] : null,
        'jobId' => $options['jobId'] ?? null,
        'editorBaseUrl' => $options['editorBaseUrl'] ?? 'http://localhost:8080/editor.php',
        'webhookUrl' => $options['webhookUrl'] ?? 'http://localhost:8080/webhook.php',
        'sendTestWebhook' => array_key_exists('sendTestWebhook', $options),
    ];
}

function httpJson(string $method, string $url, array $headers = [], ?array $body = null): array
{
    $curl = curl_init();
    $mergedHeaders = array_merge(['Accept: application/json'], $headers);

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

    return [
        'success' => $error === '' && $httpCode >= 200 && $httpCode < 300,
        'httpCode' => $httpCode,
        'error' => $error !== '' ? $error : null,
        'data' => $raw !== false ? json_decode($raw, true) : null,
        'raw' => $raw,
    ];
}

function httpText(string $url): array
{
    $curl = curl_init();
    curl_setopt_array($curl, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
    ]);

    $raw = curl_exec($curl);
    $httpCode = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    return [
        'success' => $error === '' && $httpCode >= 200 && $httpCode < 300,
        'httpCode' => $httpCode,
        'error' => $error !== '' ? $error : null,
        'raw' => $raw,
    ];
}

function printCheck(string $label, bool $ok, string $detail): void
{
    fwrite(STDOUT, sprintf("[%s] %s - %s\n", $ok ? 'PASS' : 'FAIL', $label, $detail));
}

function lookupTemplateSets(string $apiKey, string $sortcode, ?int $stanSeqno): array
{
    $query = ['sortcode' => $sortcode];
    if ($stanSeqno !== null) {
        $query['stanSeqno'] = (string) $stanSeqno;
    }

    $url = API_BASE_URL . '/product-template-sets/by-product?' . http_build_query($query);

    return httpJson('GET', $url, [
        'X-API-Key: ' . $apiKey,
    ]);
}

function resolveTemplateSetId(array $config): ?string
{
    if ($config['templateSetId'] !== null) {
        return $config['templateSetId'];
    }

    if ($config['apiKey'] === null || $config['sortcode'] === null) {
        return null;
    }

    $lookup = lookupTemplateSets($config['apiKey'], $config['sortcode'], $config['stanSeqno']);
    $templateSets = $lookup['data']['templateSets'] ?? [];

    if (!is_array($templateSets) || $templateSets === []) {
        return null;
    }

    foreach ($templateSets as $templateSet) {
        if (!empty($templateSet['isDefault']) && !empty($templateSet['id'])) {
            return (string) $templateSet['id'];
        }
    }

    return !empty($templateSets[0]['id']) ? (string) $templateSets[0]['id'] : null;
}

function buildEditorUrl(array $config, string $templateSetId): string
{
    return $config['editorBaseUrl'] . '?' . http_build_query([
        'productId' => $config['productId'],
        'templateSetId' => $templateSetId,
        'pages' => 20,
    ]);
}

function resultsFilePath(string $jobId): string
{
    return __DIR__ . '/../../test-php/php/logs/results/' . basename($jobId) . '.json';
}

function sendTestWebhook(string $webhookUrl, string $jobId): array
{
    $payload = [
        'event' => 'synthesis.completed',
        'jobId' => $jobId,
        'status' => 'completed',
        'outputFileUrl' => '/storage/outputs/' . $jobId . '/merged.pdf',
        'outputFiles' => [
            ['type' => 'cover', 'url' => '/storage/outputs/' . $jobId . '/cover.pdf'],
            ['type' => 'content', 'url' => '/storage/outputs/' . $jobId . '/content.pdf'],
        ],
        'outputFormat' => 'separate',
        'timestamp' => gmdate('c'),
    ];

    return httpJson('POST', $webhookUrl, [], $payload);
}

$config = parseVerifyOptions();

fwrite(STDOUT, "Verification started\n");
fwrite(STDOUT, 'API_BASE_URL=' . API_BASE_URL . PHP_EOL);

$token = getEditorToken();
printCheck(
    'auth/login',
    $token !== null,
    $token !== null ? 'JWT acquired from existing test-php login flow' : 'JWT acquisition failed'
);

if ($config['apiKey'] !== null && $config['sortcode'] !== null) {
    $lookup = lookupTemplateSets($config['apiKey'], $config['sortcode'], $config['stanSeqno']);
    $templateCount = is_array($lookup['data']['templateSets'] ?? null)
        ? count($lookup['data']['templateSets'])
        : 0;

    printCheck(
        'product-template-sets/by-product',
        $lookup['success'] && $templateCount > 0,
        'HTTP=' . $lookup['httpCode'] . ', templateSets=' . $templateCount
    );
} else {
    printCheck(
        'product-template-sets/by-product',
        true,
        'Skipped because --apiKey or --sortcode was not provided'
    );
}

$templateSetId = resolveTemplateSetId($config);
printCheck(
    'templateSetId resolution',
    $templateSetId !== null,
    $templateSetId !== null ? 'Resolved templateSetId=' . $templateSetId : 'Could not resolve templateSetId'
);

if ($templateSetId !== null) {
    $editorUrl = buildEditorUrl($config, $templateSetId);
    $editorPage = httpText($editorUrl);
    $containsEditorMarkers = is_string($editorPage['raw'])
        && strpos($editorPage['raw'], 'editor-root') !== false
        && strpos($editorPage['raw'], 'StorigeEditor') !== false;

    printCheck(
        'editor.php response',
        $editorPage['success'] && $containsEditorMarkers,
        'HTTP=' . $editorPage['httpCode'] . ', markers=' . ($containsEditorMarkers ? 'yes' : 'no')
    );

    fwrite(STDOUT, 'Editor URL: ' . $editorUrl . PHP_EOL);
}

if ($config['apiKey'] !== null && $config['orderSeqno'] !== null) {
    $sessionLookup = httpJson(
        'GET',
        API_BASE_URL . '/edit-sessions/external?' . http_build_query(['orderSeqno' => $config['orderSeqno']]),
        ['X-API-Key: ' . $config['apiKey']]
    );

    $sessionCount = is_array($sessionLookup['data']['data'] ?? null)
        ? count($sessionLookup['data']['data'])
        : 0;

    printCheck(
        'edit-sessions/external',
        $sessionLookup['success'],
        'HTTP=' . $sessionLookup['httpCode'] . ', sessions=' . $sessionCount
    );
} else {
    printCheck(
        'edit-sessions/external',
        true,
        'Skipped because --apiKey or --orderSeqno was not provided'
    );
}

if ($config['sendTestWebhook']) {
    $jobId = $config['jobId'] ?? ('verify-job-' . date('YmdHis'));
    $webhookResult = sendTestWebhook($config['webhookUrl'], $jobId);
    $resultFile = resultsFilePath($jobId);

    printCheck(
        'webhook.php POST',
        $webhookResult['success'],
        'HTTP=' . $webhookResult['httpCode'] . ', jobId=' . $jobId
    );

    clearstatcache(true, $resultFile);
    printCheck(
        'webhook result file',
        file_exists($resultFile),
        file_exists($resultFile) ? $resultFile : 'Result file not found'
    );
} elseif ($config['jobId'] !== null) {
    $resultFile = resultsFilePath($config['jobId']);
    clearstatcache(true, $resultFile);
    printCheck(
        'webhook result file',
        file_exists($resultFile),
        file_exists($resultFile) ? $resultFile : 'Result file not found'
    );
} else {
    printCheck(
        'webhook result file',
        true,
        'Skipped because --jobId was not provided and --sendTestWebhook was not used'
    );
}
