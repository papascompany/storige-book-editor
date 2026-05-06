# Storige × bookmoa PHP 연동 최종 가이드 (v3.1)

> **수신**: bookmoa PHP 개발팀  
> **발신**: Storige 운영팀  
> **버전**: v3.1 (2026-05-06) — Phase A 멀티사이트 안내 추가 (API/PHP 코드 변경 0)  
> **Storige 상태**: 운영 배포 완료 · Worker E2E 검증 완료 · PHP 측 작업 2일 예상  
> **API 문서**: https://api.papascompany.co.kr/api/docs (Swagger)

---

## 목차

0. [빠른 시작 — 5분 체크리스트](#0-빠른-시작--5분-체크리스트)
1. [현재 상태 요약](#1-현재-상태-요약)
2. [환경 설정 — API Key](#2-환경-설정--api-key)
3. [에디터 URL 파라미터](#3-에디터-url-파라미터)
4. [편집 완료 콜백 처리](#4-편집-완료-콜백-처리)
5. [PDF 합성 Worker API](#5-pdf-합성-worker-api)
6. [Webhook 수신 구현](#6-webhook-수신-구현)
7. [합성 결과 PDF 다운로드](#7-합성-결과-pdf-다운로드)
8. [재편집 흐름](#8-재편집-흐름)
9. [보안 가이드](#9-보안-가이드)
10. [검증 시나리오](#10-검증-시나리오)
11. [권장 통합 일정](#11-권장-통합-일정)
12. [킥오프 요청 정보](#12-킥오프-요청-정보)
13. [FAQ](#13-faq)
14. [API 엔드포인트 레퍼런스](#14-api-엔드포인트-레퍼런스)

---

## 0. 빠른 시작 — 5분 체크리스트

PHP 측 필수 작업 우선순위:

| 순서 | 항목 | 시급도 | 예상 시간 |
|------|------|--------|-----------|
| **①** | API Key 환경변수 등록 | 🔴 즉시 | 5분 |
| **②** | PDF 다운로드 endpoint 변경 (→ `/external`) | 🔴 즉시 | 5분 |
| **③** | 에디터 URL 파라미터 수정 | 🔴 P0 | 1~2시간 |
| **④** | `onComplete` 콜백에서 `fileId` 처리 코드 수정 | 🔴 P0 | 1~2시간 |
| **⑤** | Worker synthesize/external 호출 구현 | 🟡 P1 | 2~3시간 |
| **⑥** | Webhook 수신 PHP 파일 신규 작성 | 🟡 P1 | 2~3시간 |
| **⑦** | 합성 결과 PDF 다운로드 구현 | 🟡 P1 | 1시간 |
| **⑧** | 보안 검수 (fileId 클라이언트 노출 점검) | 🟡 점검 | 1~2시간 |

---

## 1. 현재 상태 요약

### Storige 측 완료 항목

| 항목 | 상태 | 날짜 |
|------|------|------|
| API 운영 배포 | ✅ 완료 | 2026-05-03 |
| 보안 패치 A-E (사용자 격리) | ✅ 완료 | 2026-05-03 |
| PHP 팀용 외부 endpoint 분리 (`/external`) | ✅ 완료 | 2026-05-03 |
| Worker 합성 E2E 검증 (3 시나리오) | ✅ 완료 | 2026-05-04 |
| Sentry 모니터링 활성화 | ✅ 완료 | 2026-05-03 |
| Swagger API 문서 | ✅ 운영 중 | — |

### 전체 연동 흐름 (현재 기준)

```
[북모아 PHP]                          [Storige Editor]           [Storige API/Worker]
     │                                       │                           │
     │① shop-session JWT 발급 (X-API-Key) ──────────────────────────────▶│
     │◀── accessToken ──────────────────────────────────────────────────│
     │                                       │                           │
     │② 에디터 URL로 이동 ──────────────────▶│                           │
     │   ?template_set_id=&order_seqno=...   │── GET /templates ────────▶│
     │                                       │── POST /edit-sessions ───▶│
     │                                       │   (세션 생성)              │
     │                                       │                           │
     │                                [고객 편집 중...]                   │
     │                                       │── 자동저장 (1분) ──────────▶│
     │                                       │                           │
     │                               [편집 완료 클릭]                     │
     │                                       │── POST /complete ─────────▶│
     │◀── returnUrl 리다이렉트 + onComplete ──│                           │
     │    { coverFileId, contentFileId }     │                           │
     │                                       │                           │
     │③ check-mergeable (선택) ──────────────────────────────────────────▶│
     │◀── { mergeable: true } ───────────────────────────────────────────│
     │                                       │                           │
     │④ synthesize/external (주문 결제 시) ──────────────────────────────▶│
     │◀── { jobId, status: PENDING } ────────────────────────────────────│
     │                                       │       [Worker PDF 합성 중] │
     │                                       │                           │
     │⑤ Webhook 수신 ◀───────────────────────────────────────────────────│
     │   synthesis.completed / jobId         │                           │
     │                                       │                           │
     │⑥ 합성 PDF 다운로드 ────────────────────────────────────────────────▶│
     │   (shop-session JWT + /worker-jobs/{jobId}/output)                │
     │◀── PDF 바이너리 ──────────────────────────────────────────────────│
```

---

## 2. 환경 설정 — API Key

> **🆕 v3.1 (2026-05-06) — 멀티사이트 안내** (PHP 측 영향 0)
>
> Storige는 2026-05-06부터 단일 시스템에서 여러 외부 사이트(예: 북모아 메인,
> 점보포토, 스튜디오북, Storywork, Printcard studio, MD2Books, 100p Books)의
> 편집기·워커 연동을 동시 지원합니다. 각 사이트는 **고유 인증코드**(편집기용 +
> 워커용)를 발급받아 같은 가이드를 그대로 따릅니다.
>
> **북모아 측 변경 0** — 기존 `STORIGE_API_KEY` 값은 부팅 시 자동으로 DB에
> 마이그레이션돼 그대로 인증 통과합니다. 새 값으로 교체할 필요 없음.
>
> **새 사이트 추가 시** (예: 점보포토): Storige 운영팀이 admin 콘솔에서 사이트
> 등록 → 인증코드 자동 발급 → 안전 채널로 전달 → 그 사이트 PHP `.env`에 입력.
> 코드는 동일.

### 2-1. PHP 서버 설정

```php
<?php
// storige/config.php — API Key 및 엔드포인트 설정
// ⚠️ API Key는 절대 클라이언트(JS/HTML)에 노출하지 말 것

define('STORIGE_API_KEY',  'sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g');
define('STORIGE_API_BASE', 'https://api.papascompany.co.kr/api');
define('STORIGE_EDITOR_URL', 'https://editor.papascompany.co.kr');

// Webhook 서명 키 (Storige 팀과 합의 후 설정)
// define('STORIGE_WEBHOOK_SECRET', '***');
```

Apache `.htaccess` 또는 서버 환경변수로 관리하는 경우:
```apache
SetEnv STORIGE_API_KEY "sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g"
SetEnv STORIGE_API_BASE "https://api.papascompany.co.kr/api"
```

### 2-2. Shop Session JWT 발급 (공통 헬퍼)

```php
/**
 * bookmoa 회원용 Storige JWT 발급
 * 에디터 진입 또는 서버 간 API 호출에 사용
 */
function getStorigeJWT(int $memberSeqno, string $memberId, string $memberName, int $orderSeqno = 0): string {
    $body = [
        'memberSeqno' => $memberSeqno,
        'memberId'    => $memberId,
        'memberName'  => $memberName,
    ];
    // 권장: 단일 주문 컨텍스트 포함 → Storige가 주문 교차 접근 자동 차단
    if ($orderSeqno > 0) {
        $body['orderSeqno'] = $orderSeqno;
    }

    $ch = curl_init(STORIGE_API_BASE . '/auth/shop-session');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'X-API-Key: '    . STORIGE_API_KEY,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_TIMEOUT    => 10,
    ]);

    $resp     = json_decode(curl_exec($ch), true);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 201 || empty($resp['accessToken'])) {
        throw new RuntimeException('[Storige] JWT 발급 실패: HTTP ' . $httpCode);
    }
    return $resp['accessToken'];
}
```

---

## 3. 에디터 URL 파라미터

### 3-1. Breaking Changes 요약 (기존 코드에서 수정 필요)

| 원본 파라미터 | 현재 | 비고 |
|---|---|---|
| `pages=20` | **`pageCount=20`** | 🔴 Breaking — 내지 기준 페이지 수 |
| `wingFront=10&wingBack=5` | **`paperType=mojo_80g&bindingType=perfect`** | 🔴 Deprecated |
| `productId=Y` (필수) | `orderSeqno=12345` (권장) | 🟡 기존도 동작하나 `orderSeqno` 권장 |
| (없음) | `mode=both\|cover\|content` | 🟡 Added |
| (없음) | `return_url=/mypage/...` | 🟡 Added |
| (없음) | `session_id=<uuid>` | 🟡 재편집 시 사용 |
| (없음) | `width=148&height=210` | 🟡 옵션 C (자유 사이즈) |
| (없음) | `api_base_url=https://api...` | 🟡 명시 전달 권장 |

### 3-2. PHP URL 생성 코드

```php
function buildStorigeEditorUrl(array $params): string {
    $query = [
        'template_set_id' => $params['templateSetId'],      // 필수
        'api_base_url'    => STORIGE_API_BASE,              // 권장
    ];

    // 방식 선택 (orderSeqno 권장)
    if (!empty($params['orderSeqno'])) {
        $query['order_seqno'] = $params['orderSeqno'];
    } elseif (!empty($params['productId'])) {
        $query['product_id'] = $params['productId'];        // 기존 호환
    }

    // 편집 모드 (both=표지+내지, cover=표지만, content=내지만)
    $query['mode'] = $params['mode'] ?? 'both';

    // 페이지 수 — ⚠️ 'pages' 아님!
    if (!empty($params['pageCount'])) {
        $query['page_count'] = $params['pageCount'];
    }

    // 책등 계산용 종이/제본 코드
    if (!empty($params['paperType'])) {
        $query['paper_type']   = $params['paperType'];      // 예: 'mojo_80g'
        $query['binding_type'] = $params['bindingType'];    // 예: 'perfect'
    }

    // 편집 완료 후 리다이렉트
    if (!empty($params['returnUrl'])) {
        $query['return_url'] = $params['returnUrl'];
    }

    // 재편집: 기존 세션 ID 전달
    if (!empty($params['sessionId'])) {
        $query['session_id'] = $params['sessionId'];
    }

    // 옵션 C: 자유 사이즈 (Admin에서 allowCustomSize=true 설정 필요)
    if (!empty($params['widthMm']) && !empty($params['heightMm'])) {
        $query['width']  = $params['widthMm'];
        $query['height'] = $params['heightMm'];
    }

    return STORIGE_EDITOR_URL . '/?' . http_build_query($query);
}

// 사용 예시
$editorUrl = buildStorigeEditorUrl([
    'templateSetId' => 'ts-perfect-a5-50p',
    'orderSeqno'    => $order['seqno'],
    'mode'          => 'both',
    'pageCount'     => 50,
    'paperType'     => 'mojo_80g',
    'bindingType'   => 'perfect',
    'returnUrl'     => '/mypage/order_edit.php?order_seqno=' . $order['seqno'],
]);
```

### 3-3. 인쇄물 사이즈 결정 방식 (3 옵션)

| 옵션 | 방식 | 적합한 경우 |
|------|------|-------------|
| **A** | `templateSetId`가 사이즈 포함 | 사이즈가 templateSet별 사전 등록 (기본) |
| **B** | `productId + size=N` (sizeNo 인덱스) | product_sizes에 사이즈 사전 등록 |
| **C** | `productId + width + height` (mm) | 사용자가 사이즈 직접 입력 (`allowCustomSize=true` 필요) |

### 3-4. paperType / bindingType 코드 매핑

| 북모아 UI | Storige `paperType` | 두께 기준 |
|---|---|---|
| 모조지 80g | `mojo_80g` | 0.10 mm/장 |
| 모조지 100g | `mojo_100g` | 0.12 mm/장 |
| 아트지 100g | `art_100g` | 0.10 mm/장 |
| 아트지 150g | `art_150g` | 0.13 mm/장 |
| 스노우 100g | `snow_100g` | 0.105 mm/장 |

| 제본 방식 | Storige `bindingType` |
|---|---|
| 무선 제본 | `perfect` |
| 중철 제본 | `saddle` |
| 스프링 제본 | `spring` |
| 양장 | `hardcover` |

---

## 4. 편집 완료 콜백 처리

### 4-1. `EditorResult` 구조

편집 완료 시 에디터가 `returnUrl`로 리다이렉트하며 다음 데이터를 전달합니다:

```typescript
// 에디터가 returnUrl로 redirect 할 때 URL 파라미터 또는 JS 콜백으로 전달
interface EditorResult {
  sessionId: string         // 편집 세션 UUID
  orderSeqno?: number       // 주문 번호
  files: {
    coverFileId?: string    // ⚠️ URL 아님 — 파일 UUID
    contentFileId?: string  // ⚠️ URL 아님 — 파일 UUID
    thumbnailUrl?: string   // 썸네일 이미지 URL
  }
  pages: { initial: number; final: number }
  savedAt: string           // ISO 8601
}
```

### 4-2. PHP 콜백 처리 코드

```php
<?php
// /storige/proc/save_edit_result.php
// returnUrl 리다이렉트 후 파라미터 수신

$data = json_decode(file_get_contents('php://input'), true);

$orderSeqno    = (int)$data['order_seqno'];
$sessionId     = $data['session_id'];
$coverFileId   = $data['cover_file_id'];    // ⚠️ UUID (URL 아님)
$contentFileId = $data['content_file_id'];  // ⚠️ UUID (URL 아님)
$thumbnailUrl  = $data['thumbnail_url'];    // 이것만 URL (썸네일)

// DB에 저장 (파일 UUID를 직접 저장 — 다운로드는 §7 참조)
$sql = "UPDATE bookmoa_orders SET
    storige_session_id     = ?,
    storige_cover_file_id  = ?,
    storige_content_file_id = ?,
    storige_thumbnail_url  = ?
WHERE order_seqno = ?";

// ... execute($sql, [$sessionId, $coverFileId, $contentFileId, $thumbnailUrl, $orderSeqno])

// ✅ 이 시점에 synthesize 요청하지 말 것 — 결제 완료 시점에 요청
http_response_code(200);
echo json_encode(['ok' => true]);
```

---

## 5. PDF 합성 Worker API

### 5-1. 병합 가능 여부 사전 체크 (선택, 저장 시점)

```php
function checkMergeable(string $sessionId, string $coverFileId, string $contentFileId, float $spineWidth): array {
    $ch = curl_init(STORIGE_API_BASE . '/worker-jobs/check-mergeable/external');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'X-API-Key: '    . STORIGE_API_KEY,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'editSessionId' => $sessionId,
            'coverFileId'   => $coverFileId,
            'contentFileId' => $contentFileId,
            'spineWidth'    => $spineWidth,   // mm 단위
        ]),
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp = json_decode(curl_exec($ch), true);
    curl_close($ch);

    // 응답: { mergeable: true/false, issues: [{ code, message }, ...] }
    return $resp;
}

// 사용 예시 (주문 처리 직전)
$check = checkMergeable($sessionId, $coverFileId, $contentFileId, $spineWidthMm);
if (!($check['mergeable'] ?? false)) {
    $errors = implode(', ', array_column($check['issues'] ?? [], 'message'));
    throw new Exception('PDF 병합 불가: ' . $errors);
}
```

### 5-2. PDF 합성 요청 (결제 완료 시)

```php
function requestSynthesis(array $params): array {
    $payload = [
        'editSessionId' => $params['sessionId'],
        'coverFileId'   => $params['coverFileId'],
        'contentFileId' => $params['contentFileId'],
        'spineWidth'    => $params['spineWidthMm'],       // mm 단위 (필수)
        'orderId'       => 'ORD-' . $params['orderSeqno'],
        'priority'      => $params['priority'] ?? 'high',  // high | normal | low
        // Webhook 수신 URL (§6 참조, 미설정 시 폴링으로 확인)
        'callbackUrl'   => 'https://www.bookmoa.co.kr/storige/proc/synthesis_callback.php',
        // 선택: outputFormat = 'merged'(기본) | 'separate'(표지/내지 분리)
        // 선택: bindingType = 'perfect'(기본) | 'saddle' | 'hardcover'
    ];

    $ch = curl_init(STORIGE_API_BASE . '/worker-jobs/synthesize/external');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'X-API-Key: '    . STORIGE_API_KEY,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT    => 30,
    ]);
    $resp     = json_decode(curl_exec($ch), true);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 201) {
        throw new RuntimeException('[Storige] 합성 요청 실패: HTTP ' . $httpCode);
    }

    // 응답: { id: "job-uuid", status: "PENDING", ... }
    return $resp['data'] ?? $resp;
}

// 사용 예시 (결제 완료 hook에서)
$job = requestSynthesis([
    'sessionId'    => $sessionId,
    'coverFileId'  => $coverFileId,
    'contentFileId'=> $contentFileId,
    'spineWidthMm' => $spineWidthMm,
    'orderSeqno'   => $orderSeqno,
]);

// jobId를 DB에 저장해 상태 추적
saveJobId($orderSeqno, $job['id']);
```

### 5-3. 잡 상태 폴링 (Webhook 없이 운영 시)

```php
function getJobStatus(string $jobId): array {
    $ch = curl_init(STORIGE_API_BASE . '/worker-jobs/external/' . $jobId);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['X-API-Key: ' . STORIGE_API_KEY],
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $resp['data'] ?? $resp;
}

// 상태 값
// PENDING    → 대기 중
// PROCESSING → 처리 중
// COMPLETED  → 완료 → §7 다운로드 진행
// FAILED     → 실패 (errorMessage 확인)
```

---

## 6. Webhook 수신 구현

### 6-1. 파일 생성 위치

```
/storige/proc/synthesis_callback.php   ← 신규 구현 필요
```

### 6-2. Webhook 페이로드 형식

> ⚠️ **중요**: `outputFileUrl`은 **내부 저장소 경로**(`/storage/outputs/{jobId}/merged.pdf`)입니다.  
> 이 경로로 직접 HTTP 요청하지 마세요. 다운로드 방법은 §7을 따르세요.

**synthesis.completed 페이로드**:
```json
{
  "event":        "synthesis.completed",
  "jobId":        "dcc5d57b-e731-4b25-a943-e7688a7a19c4",
  "sessionId":    "편집-세션-uuid",
  "orderId":      "ORD-12345",
  "status":       "completed",
  "outputFileUrl": "/storage/outputs/dcc5d57b-.../merged.pdf",
  "outputFormat": "merged",
  "outputFiles":  null
}
```

**outputFormat=separate일 때 추가 필드**:
```json
{
  "outputFiles": [
    { "type": "cover",   "url": "/storage/outputs/{jobId}/cover.pdf" },
    { "type": "content", "url": "/storage/outputs/{jobId}/content.pdf" }
  ]
}
```

**synthesis.failed 페이로드**:
```json
{
  "event":        "synthesis.failed",
  "jobId":        "uuid",
  "orderId":      "ORD-12345",
  "status":       "FAILED",
  "errorMessage": "PDF merge failed: ...",
  "failedAt":     "2026-05-04T10:00:00Z"
}
```

### 6-3. PHP 수신 구현 코드

```php
<?php
// /storige/proc/synthesis_callback.php

$rawBody = file_get_contents('php://input');
$payload = json_decode($rawBody, true);
$event   = $_SERVER['HTTP_X_STORIGE_EVENT'] ?? $payload['event'] ?? '';

error_log('[storige_webhook] event=' . $event . ' jobId=' . ($payload['jobId'] ?? 'n/a'));

if ($event === 'synthesis.completed') {
    $jobId    = $payload['jobId'];
    $orderId  = $payload['orderId'];             // 'ORD-12345' 형식
    $orderSeqno = (int)str_replace('ORD-', '', $orderId);

    // 1. jobId를 DB에 저장 (나중에 다운로드할 때 사용)
    saveCompletedJobId($orderSeqno, $jobId);

    // 2. 주문 상태 업데이트: 에디터 완료 → PDF 생성 완료
    updateOrderStatus($orderSeqno, 210);

    // 3. 합성 PDF 다운로드 (§7 방식으로)
    try {
        downloadAndStorePdf($orderSeqno, $jobId);
    } catch (Exception $e) {
        error_log('[storige_webhook] PDF 다운로드 실패: ' . $e->getMessage());
        // 실패 시 재시도 큐에 넣거나 관리자 알림
    }

} elseif ($event === 'synthesis.failed') {
    $orderId      = $payload['orderId'];
    $errorMessage = $payload['errorMessage'] ?? '알 수 없는 오류';
    $orderSeqno   = (int)str_replace('ORD-', '', $orderId);

    updateOrderStatus($orderSeqno, -1);   // 실패 상태 코드
    notifyAdminOfSynthesisFailure($orderSeqno, $errorMessage);
}

// ⚠️ 반드시 200 응답 (미응답 시 3회 재시도)
http_response_code(200);
echo json_encode(['received' => true]);
exit;
```

### 6-4. Webhook 응답 정책

| 응답 코드 | Storige 처리 |
|---|---|
| 200 | 성공 — 재시도 없음 |
| 4xx, 5xx | 실패 — 지수 백오프로 최대 3회 재시도 |
| 타임아웃 (>30s) | 실패로 간주 — 재시도 |

> ⚠️ 무거운 처리(PDF 다운로드/저장)는 큐에 비동기로 넣고 즉시 200 반환 권장.

### 6-5. callbackUrl 호스트 허용 목록

다음 호스트만 자동 허용:
- `*.papascompany.co.kr`
- `*.bookmoa.com`
- `localhost`, `127.0.0.1` (개발용)

다른 호스트 필요 시 VPS `~/storige/.env` 추가:
```bash
WEBHOOK_ALLOWED_HOSTS=papascompany.co.kr,bookmoa.com,my-test.example.com
```

---

## 7. 합성 결과 PDF 다운로드

### 7-1. 다운로드 방식 (중요)

Webhook의 `outputFileUrl`은 내부 경로라 **직접 HTTP 요청 불가**합니다.  
대신 Storige API의 전용 다운로드 엔드포인트를 사용해야 합니다.

```
GET /api/worker-jobs/{jobId}/output
인증: Authorization: Bearer {JWT}
```

> 이 endpoint는 JWT가 필요합니다. PHP 서버에서 `getStorigeJWT()`로 발급한 토큰을 사용하세요.

### 7-2. PHP 다운로드 코드

```php
/**
 * 합성 완료된 PDF를 Storige에서 내려받아 bookmoa 서버에 저장
 *
 * @param int    $orderSeqno 주문 번호 (JWT 발급 시 사용)
 * @param string $jobId      합성 잡 ID (Webhook 또는 폴링으로 획득)
 * @return string            저장된 로컬 파일 경로
 */
function downloadAndStorePdf(int $orderSeqno, string $jobId): string {
    // 1. 해당 주문 회원 정보 조회
    $member = getMemberByOrderSeqno($orderSeqno);

    // 2. Storige JWT 발급 (PHP 서버용 — 다운로드 권한 획득)
    $jwt = getStorigeJWT(
        $member['seqno'],
        $member['id'],
        $member['name'],
        $orderSeqno
    );

    // 3. Storige에서 합성 PDF 다운로드
    $ch = curl_init(STORIGE_API_BASE . '/worker-jobs/' . $jobId . '/output');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $jwt,
        ],
        CURLOPT_TIMEOUT => 60,   // PDF 크기에 따라 여유 있게
    ]);
    $pdfBytes = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new RuntimeException('[Storige] PDF 다운로드 실패: HTTP ' . $httpCode);
    }

    // 4. bookmoa 서버에 저장
    $savePath = '/path/to/bookmoa/pdfs/order_' . $orderSeqno . '_final.pdf';
    file_put_contents($savePath, $pdfBytes);

    // 5. DB에 경로 저장
    updateOrderFilePath($orderSeqno, $savePath);

    return $savePath;
}

/**
 * 고객에게 PDF 다운로드 스트림 전달
 * URL 예: /mypage/download.php?order_seqno=12345
 */
function streamPdfToCustomer(int $orderSeqno): void {
    $memberSeqno = $_SESSION['memberSeqno'];

    // 본인 주문 검증 (PHP DB 기준)
    if (!isOrderOwnedByMember($orderSeqno, $memberSeqno)) {
        http_response_code(403);
        exit('Forbidden');
    }

    // 저장된 PDF 경로 조회
    $filePath = getOrderFilePath($orderSeqno);
    if (!$filePath || !file_exists($filePath)) {
        http_response_code(404);
        exit('PDF가 아직 준비되지 않았습니다.');
    }

    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="order_' . $orderSeqno . '.pdf"');
    header('Content-Length: ' . filesize($filePath));
    readfile($filePath);
}
```

### 7-3. 원본 파일(표지/내지) 개별 다운로드

편집 완료 시 받은 `coverFileId` / `contentFileId`로 원본 PDF를 내려받으려면:

```php
function downloadOriginalFile(string $fileId): string {
    $ch = curl_init(STORIGE_API_BASE . '/files/' . $fileId . '/download/external');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['X-API-Key: ' . STORIGE_API_KEY],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $pdfBytes = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new RuntimeException('[Storige] 파일 다운로드 실패: HTTP ' . $httpCode);
    }
    return $pdfBytes;
}
```

---

## 8. 재편집 흐름

고객이 편집을 수정할 때 기존 세션을 복원합니다:

```php
// 주문 상세 페이지에서 "수정하기" 버튼 클릭
function buildReEditUrl(int $orderSeqno): string {
    $sessionId = getSessionIdByOrder($orderSeqno);  // DB에서 조회

    return buildStorigeEditorUrl([
        'templateSetId' => getTemplateSetIdForOrder($orderSeqno),
        'orderSeqno'    => $orderSeqno,
        'sessionId'     => $sessionId,   // ⚠️ 기존 세션 전달 → 캔버스 자동 복원
        'pageCount'     => getPageCountForOrder($orderSeqno),
        'paperType'     => getPaperTypeForOrder($orderSeqno),
        'bindingType'   => getBindingTypeForOrder($orderSeqno),
        'returnUrl'     => '/mypage/order_edit.php?order_seqno=' . $orderSeqno,
    ]);
}
```

에디터 동작:
1. `session_id` 전달 → Storige API에서 기존 `edit_sessions` 조회
2. `canvasData` 있으면 캔버스에 복원
3. 없으면 신규 세션 생성

---

## 9. 보안 가이드

### 9-1. fileId / sessionId 클라이언트 노출 금지

**❌ 잘못된 패턴** (보안 취약):
```html
<!-- 브라우저에 UUID 직접 노출 — 금지 -->
<a href="https://api.papascompany.co.kr/api/files/<?= $fileId ?>/download">다운로드</a>
<script>const sessionId = '<?= $sessionId ?>';</script>
<a href="/download.php?fileId=<?= $fileId ?>">다운로드</a>
```

**✅ 올바른 패턴** (PHP 서버 프록시):
```php
// /mypage/download.php?order_seqno=12345 (orderSeqno만 URL에 노출)
$orderSeqno  = (int)$_GET['order_seqno'];
$memberSeqno = (int)$_SESSION['memberSeqno'];

// 1. 본인 주문인지 PHP DB에서 검증
if (!isOrderOwnedByMember($orderSeqno, $memberSeqno)) {
    http_response_code(403); exit;
}
// 2. PHP 서버가 Storige에서 받아서 고객에게 전달 (fileId 클라이언트 미노출)
streamPdfToCustomer($orderSeqno);
```

### 9-2. 마이페이지 파일 목록 — 서버 측 호출

```php
// ✅ PHP 서버에서 X-API-Key로 조회 후 결과만 전달
function getMyFiles(int $memberSeqno): array {
    $ch = curl_init(STORIGE_API_BASE . '/files?memberSeqno=' . $memberSeqno);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['X-API-Key: ' . STORIGE_API_KEY],
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res['data']['files'] ?? [];
}

// ❌ 브라우저 JS에서 직접 API 호출 — 금지
// fetch(`https://api.papascompany.co.kr/api/files?memberSeqno=${memberSeqno}`)
```

### 9-3. Webhook callbackUrl 보안

- PHP의 `synthesis_callback.php`는 **Storige 서버 IP만 허용**하도록 방화벽 설정 권장
- 요청 본문 로깅 시 민감 정보 제외

---

## 10. 검증 시나리오

PHP 연동 준비 완료 후 다음 순서로 검증:

### 시나리오 1: 에디터 진입 및 기본 편집 (1~2시간)

```
1. PHP → buildStorigeEditorUrl() 호출, URL 생성 확인
2. 브라우저에서 에디터 URL 진입
3. 콘솔에 "[EmbeddedEditor] New session created: {uuid}" 출력 확인
4. 간단한 텍스트 추가 후 "편집 완료" 클릭
5. returnUrl 리다이렉트 확인
6. PHP DB: storige_session_id, cover_file_id 저장 확인
```

### 시나리오 2: 재편집 (30분)

```
1. 기존 sessionId를 URL에 추가 (session_id 파라미터)
2. 에디터 로드 시 캔버스 복원 확인
   → "[EmbeddedEditor] Existing session loaded: {uuid}"
3. 수정 후 완료 → 세션 업데이트 확인
```

### 시나리오 3: PDF 합성 E2E (2~3시간)

```
1. 편집 완료 → coverFileId / contentFileId 수신 확인
2. POST /synthesize/external 호출 → jobId 응답 확인
3. (Webhook) synthesis_callback.php 수신 확인
   또는 (폴링) GET /worker-jobs/external/{jobId} 반복 조회
4. status = COMPLETED 확인
5. §7 방식으로 PDF 다운로드 확인
6. 고객에게 streamPdfToCustomer() 스트림 확인
```

### 시나리오 4: 옵션 C 자유 사이즈 (필요 시)

```
1. Admin에서 해당 상품 allowCustomSize=true 설정
2. URL에 width=148&height=210 추가
3. 에디터 캔버스가 148mm × 210mm로 로드됨 확인
4. allowCustomSize=false 상품에 같은 파라미터 → 기본 사이즈로 무시됨 확인
```

---

## 11. 권장 통합 일정

| 주차 | 기간 | PHP 팀 작업 | Storige 지원 |
|------|------|-------------|-------------|
| **1주차** | ~5/11 | 환경 설정 + endpoint 변경 + 에디터 진입 테스트 | API 문서 제공, 실시간 질의 응답 |
| **2주차** | 5/12~5/18 | 합성 E2E + Webhook + 다운로드 테스트 | Sentry 모니터링 + 이슈 즉각 대응 |
| **3주차** | 5/19~5/25 | 보안 검수 + 운영 컷오버 | 24시간 대응 준비 |

---

## 12. 킥오프 요청 정보

통합 진행을 위해 아래 정보를 Storige 운영팀에 공유해 주세요:

1. **담당자 연락처** (이름, 이메일)
2. **가능한 킥오프 미팅 일정** (30분)
3. **Webhook 수신 URL** (`synthesis_callback.php` URL 전체 경로)
4. **통합 테스트 환경** (운영 직접? 별도 스테이징 서버?)
5. **예상 일 주문 볼륨** (Worker 큐 사이즈 사전 조정용)

### 킥오프 메일 템플릿

```
제목: [Storige × bookmoa] 통합 킥오프 요청 — Storige 측 준비 완료

안녕하세요 bookmoa PHP 팀 담당자님,

Storige 운영팀입니다.
Storige × bookmoa 인쇄 워크플로 통합 준비가 완료되었습니다.

▶ PHP 측 필수 변경 (즉시, 5분)
  - PDF 다운로드 endpoint: /files/:id/download → /files/:id/download/external
  - 상세 가이드: PHP_INTEGRATION_FINAL_v3.md 첨부

▶ 운영 현황
  - API: https://api.papascompany.co.kr/api (Swagger 포함)
  - Worker 합성 E2E 검증 완료 (3 시나리오)
  - Sentry 모니터링 활성화

킥오프 미팅(30분) 가능한 일정을 알려 주시면 빠르게 진행하겠습니다.

감사합니다.
Storige 운영팀 드림
```

---

## 13. FAQ

**Q. API Key는 어떻게 발급받나요?**  
A. Storige 운영팀에서 직접 전달. 개발/운영 환경별 별도 Key 사용 권장.

**Q. sessionId 없이 orderSeqno만 전달하면?**  
A. 해당 orderSeqno로 기존 세션 검색 → 없으면 신규 생성, 있으면 기존 사용 (재편집 자동).

**Q. Webhook 없이 운영 가능한가요?**  
A. 가능 — `GET /api/worker-jobs/external/{jobId}` 폴링으로 상태 확인. 단 실시간성 부족.

**Q. 합성 결과 PDF URL을 고객에게 바로 줄 수 없나요?**  
A. Storige 결과 파일은 내부 저장소 경로라 직접 URL 제공 불가. PHP 서버가 받아서 고객에게 스트림으로 전달해야 합니다 (§7 참조).

**Q. pages 파라미터가 pageCount로 바뀐 이유는?**  
A. 원본 `pages`는 표지 포함 전체 페이지 기준이었으나 Storige는 내지(본문) 기준으로 계산. 혼선 방지를 위해 명칭 변경.

**Q. PHP 서버 IP가 고정되지 않으면 Webhook 보안이 문제 아닌가요?**  
A. Webhook 수신은 bookmoa 서버 측에서 Storige 서버 IP를 방화벽으로 제한하는 방식으로 보완 가능. 필요 시 Storige 측 발신 IP를 안내드립니다.

**Q. 합성 실패 시 고객에게 재편집 요청을 자동화할 수 있나요?**  
A. `synthesis.failed` Webhook 수신 후 PHP에서 재편집 URL을 생성해 고객 이메일/SMS로 발송하면 됩니다.

---

## 14. API 엔드포인트 레퍼런스

**베이스 URL**: `https://api.papascompany.co.kr/api`

### PHP 서버 → Storige (X-API-Key 인증)

| 용도 | Method | Endpoint | 인증 |
|------|--------|----------|------|
| JWT 발급 | POST | `/auth/shop-session` | X-API-Key |
| 검증 잡 생성 | POST | `/worker-jobs/validate/external` | X-API-Key |
| 병합 가능 체크 | POST | `/worker-jobs/check-mergeable/external` | X-API-Key |
| 합성 잡 생성 | POST | `/worker-jobs/synthesize/external` | X-API-Key |
| 잡 상태 조회 | GET | `/worker-jobs/external/{id}` | X-API-Key |
| 원본 파일 다운로드 | GET | `/files/{id}/download/external` | X-API-Key |

### PHP 서버 → Storige (JWT 인증)

| 용도 | Method | Endpoint | 인증 |
|------|--------|----------|------|
| **합성 결과 다운로드** | GET | `/worker-jobs/{id}/output` | Bearer JWT |

> JWT는 `getStorigeJWT()` 함수로 발급 (`/auth/shop-session` 응답의 `accessToken`)

### 공통 요청 헤더

```http
# X-API-Key 인증 (서버 간 통신)
X-API-Key: sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g
Content-Type: application/json

# JWT 인증 (발급된 토큰 사용)
Authorization: Bearer {accessToken}
Content-Type: application/json
```

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-05-02 | PHP_INTEGRATION_VERIFICATION 최초 작성 (10개 체크리스트) |
| v2.0 | 2026-05-03 | 보안 패치 A-E 반영 (체크리스트 #11~13 + §11 추가) |
| v3.0 | 2026-05-04 | **KICKOFF 문서 통합** / Webhook outputFileUrl 형식 수정 (상대경로) / 합성 결과 다운로드 흐름 정확화 (JWT 방식) / Worker E2E 검증 완료 |
| v3.1 | 2026-05-06 | **Phase A 멀티사이트 안내** (§2 헤더에 박스 추가). PHP 측 코드/.env 변경 0. 기존 키는 자동 DB 마이그레이션으로 그대로 작동. 새 사이트 추가 시 admin에서 키 발급. |
