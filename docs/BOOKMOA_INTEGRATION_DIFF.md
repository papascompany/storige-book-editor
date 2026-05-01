# 북모아 PHP ↔ Storige 연동 변경점 정리

> **목적**: PHP 개발자가 처음 제안한 연동안과 현재 Storige 측 개발 상태를 비교해 **PHP 측에서 반드시 수정해야 할 항목**을 한 곳에 정리.
>
> **기준 문서**:
> - 원본 제안: [`docs/PHP_EDITOR_INTEGRATION_PLAN.md`](./PHP_EDITOR_INTEGRATION_PLAN.md)
> - 현재 상태: [`docs/BOOKMOA_INTEGRATION_GUIDE.md`](./BOOKMOA_INTEGRATION_GUIDE.md), [`docs/EDITOR_INTEGRATION_GUIDE.md`](./EDITOR_INTEGRATION_GUIDE.md), [`docs/03_INTEGRATION_GUIDE_KR.md`](./03_INTEGRATION_GUIDE_KR.md), [`docs/WORKER_MERGE_PLAN.md`](./WORKER_MERGE_PLAN.md), [`docs/worker-ux-plan.md`](./worker-ux-plan.md)
>
> **작성일**: 2026-05-01

---

## 0. 핵심 요약 (TL;DR)

PHP 개발자가 **반드시** 알아야 할 12개 변경:

| # | 항목 | 원본 | 현재 | 심각도 |
|---|---|---|---|---|
| 1 | **`productId` 파라미터** | 필수 | ❌ 폐기 → `orderSeqno` 로 대체 | 🔴 Breaking |
| 2 | **`pages` URL 파라미터** | URL 파라미터 | `pageCount` 로 이름 변경 (내지 기준) | 🔴 Breaking |
| 3 | **Worker 인증** | JWT 토큰 | API Key (`X-API-Key` 헤더) | 🔴 Breaking |
| 4 | **`result.files` 구조** | URL 직접 | `fileId` (UUID) 만 전달 | 🔴 Breaking |
| 5 | **`wingFront/wingBack`** | URL 파라미터 | ❌ 제거 → `paperType` + `bindingType` 코드로 대체 | 🔴 Deprecated |
| 6 | **Worker `check-mergeable` API** | 없음 | `POST /api/worker-jobs/check-mergeable/external` | 🟡 Added |
| 7 | **Worker `synthesize/external` API** | 없음 | `POST /api/worker-jobs/synthesize/external` | 🟡 Added |
| 8 | **Worker 웹훅 콜백** | 없음 | `synthesis.completed` / `synthesis.failed` 이벤트 | 🟡 Added |
| 9 | **`paperType`, `bindingType`** | 없음 | URL 파라미터 추가 (예: `mojo_80g`, `perfect`) | 🟡 Added |
| 10 | **`mode`** | 없음 | `'both' \| 'cover' \| 'content'` | 🟡 Added |
| 11 | **`returnUrl`** | 없음 | PHP 가 명시적 지정 → 완료 후 리다이렉트 대상 | 🟡 Added |
| 12 | **`apiBaseUrl`** | 암묵적 (디폴트) | 명시적 전달 필수 | 🟡 Changed |

> 🔴 = Breaking (PHP 코드 수정 필수, 안 하면 동작 안 함)
> 🟡 = Added/Changed (신규 기능 도입 또는 확장 — 호환은 되지만 활용 권장)

---

## 1. Worker (PDF 검증·병합) ↔ 북모아 PHP 연동

### 1-1. 원본 PHP 개발자 제안 (PHP_EDITOR_INTEGRATION_PLAN.md)

- 워커(PDF 합성/검증) 직접 연동 **언급 없음**
- 단순히 "에디터 임베딩 + 콜백 처리" 까지만 명시
- 인증: JWT 토큰
- 세션 기반 저장/완료 흐름만 정의

### 1-2. 현재 개발 상태 (WORKER_MERGE_PLAN.md, 03_INTEGRATION_GUIDE_KR.md)

```http
# 1. 병합 가능 체크 (Dry-run, 저장 시점)
POST /api/worker-jobs/check-mergeable/external
Headers:
  X-API-Key: {api-key}
  Content-Type: application/json
Body:
  {
    "editSessionId": "...",
    "coverFileId": "...",
    "contentFileId": "...",
    "spineWidth": 12.5
  }

# 2. 실제 병합 작업 시작 (주문 시점)
POST /api/worker-jobs/synthesize/external
Headers: X-API-Key: {api-key}
Body:
  {
    "editSessionId": "...",
    "coverFileId": "...",
    "contentFileId": "...",
    "spineWidth": 12.5,
    "orderId": "ORD-12345",
    "priority": "high",   // 'high' | 'normal' | 'low'
    "callbackUrl": "https://bookmoa.com/storige/proc/synthesis_callback.php"
  }

# 3. 작업 상태 폴링 (선택)
GET /api/worker-jobs/external/{jobId}
Headers: X-API-Key: {api-key}

# 4. 웹훅 콜백 (Storige → Bookmoa)
# Storige 가 callbackUrl 에 POST 보냄
POST {callbackUrl}
Headers:
  X-Storige-Event: synthesis.completed   # 또는 synthesis.failed
  Content-Type: application/json
Body:
  {
    "event": "synthesis.completed",
    "jobId": "...",
    "orderId": "ORD-12345",
    "status": "COMPLETED",
    "outputFileUrl": "https://...",
    "completedAt": "2026-05-01T10:00:00Z"
  }
```

### 1-3. 변경점 표

| 항목 | 원본 | 현재 | 유형 |
|---|---|---|---|
| 병합 가능 체크 | ❌ 없음 | `POST /api/worker-jobs/check-mergeable/external` | 🟡 Added |
| 병합 트리거 | ❌ 없음 | `POST /api/worker-jobs/synthesize/external` | 🟡 Added |
| 작업 상태 조회 | ❌ 없음 | `GET /api/worker-jobs/external/{jobId}` | 🟡 Added |
| 인증 방식 | JWT 토큰 | **API Key** (`X-API-Key`) | 🔴 Breaking |
| 콜백 페이로드 | 없음 | `{ event, jobId, orderId, status, outputFileUrl, … }` | 🟡 Added |
| 우선순위 | 없음 | `priority: high \| normal \| low` | 🟡 Added |
| 큐잉 시스템 | 언급 없음 | Bull Queue + Worker 프로세서 (비동기) | 🟡 Added |

### 1-4. PHP 측 작업 코드 (예시)

```php
// 1. 주문 처리 시 병합 요청
function requestSynthesis($orderSeqno, $sessionId, $coverFileId, $contentFileId, $spineWidth) {
    $ch = curl_init(STORIGE_API_URL . '/api/worker-jobs/synthesize/external');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'X-API-Key: ' . STORIGE_API_KEY,           // ⚠️ JWT 아님!
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'editSessionId'  => $sessionId,
            'coverFileId'    => $coverFileId,
            'contentFileId'  => $contentFileId,
            'spineWidth'     => $spineWidth,
            'orderId'        => 'ORD-' . $orderSeqno,
            'priority'       => 'high',
            'callbackUrl'    => 'https://bookmoa.com/storige/proc/synthesis_callback.php',
        ]),
    ]);
    $resp = curl_exec($ch);
    return json_decode($resp, true);
}

// 2. 웹훅 처리 — 신규 파일: /storige/proc/synthesis_callback.php
<?php
$payload = json_decode(file_get_contents('php://input'), true);
$event   = $_SERVER['HTTP_X_STORIGE_EVENT'] ?? '';

if ($event === 'synthesis.completed') {
    $orderId       = $payload['orderId'];
    $outputFileUrl = $payload['outputFileUrl'];
    updateOrderFile($orderId, $outputFileUrl);
    updateOrderStatus($orderId, 210);          // 110 → 210
} elseif ($event === 'synthesis.failed') {
    notifyAdminOfSynthesisFailure($payload);
}

http_response_code(200);
echo json_encode(['received' => true]);
```

---

## 2. 에디터 임베딩 진입점 (Editor Integration)

### 2-1. 원본 제안 (PHP_EDITOR_INTEGRATION_PLAN.md)

```js
window.StorigeEditor.create({
  templateSetId: 'X',
  productId:     'Y',
  token:         'JWT...',
  sessionId:     'optional',
  options: { pages: 20, coverWing: { ... }, paper: '...' },
  onComplete, onCancel, onError
})
```

URL 형태:
```
/editor.php?templateSetId=X&productId=Y&pages=20&wingFront=10&wingBack=5&sessionId=Z
```

### 2-2. 현재 상태 (BOOKMOA_INTEGRATION_GUIDE.md)

```js
window.StorigeEditor.create({
  // 필수
  templateSetId: 'X',
  token:         'JWT...',
  apiBaseUrl:    'https://api.papascompany.co.kr/api',   // 명시 필수

  // 선택
  mode:         'both',        // 'both' | 'cover' | 'content'   ⚠️ 신규
  orderSeqno:   12345,         // ⚠️ productId → orderSeqno
  pageCount:    50,            // ⚠️ pages → pageCount (내지 기준)
  paperType:    'mojo_80g',    // ⚠️ 신규
  bindingType:  'perfect',     // ⚠️ 신규
  returnUrl:    '/mypage/order_detail.php',  // ⚠️ 신규

  // 콜백
  onReady,                     // ⚠️ 신규 (에디터 준비 완료)
  onSave,                      // ⚠️ 신규 (자동 저장 이벤트)
  onComplete,
  onCancel,
  onError,
})
```

URL 형태:
```
/storige/edit.php
  ?template_set_id=X
  &order_seqno=12345
  &page_count=50
  &paper_type=mojo_80g
  &binding_type=perfect
  &return_url=%2Fmypage%2Forder_detail.php
```

### 2-3. 변경점 표

| 항목 | 원본 | 현재 | 유형 |
|---|---|---|---|
| `productId` | 필수 | ❌ 폐기 → `orderSeqno` | 🔴 Breaking |
| `pages` (URL) | 필수 | `pageCount` (내지 기준) | 🔴 Renamed |
| `wingFront`, `wingBack` | URL 파라미터 | ❌ 제거 → `paperType` + `bindingType` 으로 대체 | 🔴 Deprecated |
| `mode` | 없음 | `'both' \| 'cover' \| 'content'` | 🟡 Added |
| `paperType` | 없음 | URL 파라미터 추가 (`mojo_80g` 등) | 🟡 Added |
| `bindingType` | 없음 | URL 파라미터 추가 (`perfect` 등) | 🟡 Added |
| `returnUrl` | 없음 | 완료 후 리다이렉트 대상 | 🟡 Added |
| `apiBaseUrl` | 암묵적 | 명시적 전달 | 🟡 Changed |
| `onReady` 콜백 | 없음 | 추가 | 🟡 Added |
| `onSave` 콜백 | 없음 | 추가 | 🟡 Added |
| `result.files` | URL 포함 | **`fileId` (UUID) 만 전달** | 🔴 Breaking |
| `result.pages.final` | 있음 | 호환 유지 | ✅ 호환 |

### 2-4. PHP 측 마이그레이션

```php
// ❌ 원본 (폐기)
$editorUrl = '/editor.php?templateSetId=' . $templateSetId
           . '&productId=' . $productId
           . '&pages=' . $pageCount
           . '&wingFront=10&wingBack=5';

// ✅ 현재
$editorUrl = '/storige/edit.php'
           . '?template_set_id=' . $templateSetId
           . '&order_seqno=' . $orderSeqno
           . '&page_count=' . $pageCount
           . '&paper_type=' . $paperType
           . '&binding_type=' . $bindingType
           . '&return_url=' . urlencode('/mypage/order_detail.php');
```

```js
// ❌ 원본 콜백
onComplete: function (result) {
    window.location.href = '/callback.php'
        + '?sessionId=' + result.sessionId
        + '&pages='     + result.pages.final
        + '&productId=' + result.productId   // 폐기!
}

// ✅ 현재 콜백 (returnUrl 활용)
onComplete: function (result) {
    // result.files.coverFileId / contentFileId / thumbnailUrl 사용
    window.location.href = window.EDITOR_CONFIG.returnUrl
        + '?order_seqno='  + result.orderSeqno
        + '&session_id='   + result.sessionId
        + '&cover_file_id='   + result.files.coverFileId      // ⚠️ URL 아닌 fileId
        + '&content_file_id=' + result.files.contentFileId
}
```

---

## 3. 편집 완료 → 보관함 / 장바구니 연동

### 3-1. 원본 흐름 (PHP_EDITOR_INTEGRATION_PLAN.md)

```
편집 완료
   ↓
onComplete(result)
   ↓
window.location.href = '/callback.php?sessionId=...&pages=...&productId=...'
   ↓
/callback.php 에서 직접 장바구니 add_cart 호출
   ↓
주문 화면
```

- 보관함 = URL 파라미터로 전달
- 장바구니 연동은 **명시 없음**
- 워커 병합 단계 **없음** — 사용자가 업로드한 파일을 그대로 사용

### 3-2. 현재 흐름 (BOOKMOA_INTEGRATION_GUIDE.md + worker-ux-plan.md)

```
편집 완료
   ↓
onComplete(result)
   ↓
returnUrl 로 리다이렉트 (PHP 에서 미리 지정)
   ↓
/mypage/order_detail.php 로드
   • order_seqno 조회
   • edit_sessions 에서 session_id 확인 (보관함 자동 저장)
   • 편집 상태 확인 (draft → complete)
   ↓
[선택] 병합 가능 체크
POST /api/worker-jobs/check-mergeable/external
   ↓
주문 진행 시 병합 요청
POST /api/worker-jobs/synthesize/external
   • coverFileId, contentFileId, spineWidth, orderId, callbackUrl 전달
   ↓
Worker 비동기 처리 (PENDING → PROCESSING → COMPLETED)
   ↓
완료 시 웹훅 콜백
POST /storige/proc/synthesis_callback.php
   • outputFileUrl (병합된 PDF) 수신
   • bookmoa.order_files 업데이트
   • bookmoa.order_status: 110 → 210
   ↓
보관함:   edit_sessions (session_id ↔ orderSeqno) 로 영구 보관
장바구니: order_files (병합된 PDF 경로) 가 자동 연결
```

### 3-3. 변경점 표

| 단계 | 원본 | 현재 | 유형 |
|---|---|---|---|
| 콜백 실행 | `onComplete` | `onComplete` | ✅ 동일 |
| 리다이렉트 | `/callback.php?...` (에디터에서 하드코딩) | `returnUrl` (PHP 가 미리 지정) | 🔄 Changed |
| 파일 저장 | 콜백 페이지에서 직접 처리 | `/mypage/order_detail.php` 에서 fileId 저장 | 🔄 Changed |
| 병합 작업 | ❌ 없음 | `POST /synthesize/external` (주문 시) | 🟡 Added |
| 웹훅 처리 | ❌ 없음 | `synthesis.completed` 이벤트 → 주문상태 변경 | 🟡 Added |
| 보관함 저장 | URL 파라미터 | `edit_sessions` 테이블 (session_id 기반) | 🔄 Changed |
| 장바구니 연동 | ❌ 명시 없음 | 병합 완료 후 자동 (`order_files` 에 outputFileUrl 저장) | 🟡 Added |

---

## 4. PHP 개발자 대응 우선순위

| 우선순위 | 항목 | 비고 |
|---|---|---|
| 🔴 **즉시 (P0)** | URL 파라미터 매핑 변경 (`productId` → `orderSeqno`, `pages` → `pageCount`, `wingFront/Back` 제거) | 안 하면 에디터 진입 자체 실패 |
| 🔴 **즉시 (P0)** | `result.files` 의 fileId 기반 처리로 콜백 코드 수정 | URL 가정 시 NPE/오류 |
| 🔴 **즉시 (P0)** | Worker API 인증을 API Key (`X-API-Key`) 로 변경 | JWT 사용 시 401 |
| 🔴 **즉시 (P0)** | `/storige/proc/synthesis_callback.php` 신규 구현 | 병합 결과 수신 못 받음 |
| 🟡 **단기 (P1)** | 주문 처리 시 `POST /synthesize/external` 호출 추가 | 안 하면 PDF 병합 안 됨 |
| 🟡 **단기 (P1)** | `apiBaseUrl` 명시 전달 (에디터 config) | 빠지면 에디터가 wrong endpoint 시도 |
| 🟡 **단기 (P1)** | `paperType`, `bindingType` 코드 매핑 (북모아 폼 → URL 파라미터) | 책등 자동 계산 정확도 |
| 🟢 **선택 (P2)** | `onSave`, `onReady` 콜백 활용 (자동 저장 진행률 UI) | UX 개선 |
| 🟢 **선택 (P2)** | `check-mergeable` 호출로 저장 시점 사전 체크 | 주문 직전 실패 방지 |
| 🟢 **선택 (P2)** | 보관함 조회 API 연동 (`edit_sessions`) | "내 작업" UI |

---

## 5. 시각화 자료

본 문서와 짝을 이루는 HTML 시각화: [`docs/bookmoa_integration_diff.html`](./bookmoa_integration_diff.html)

- 원본 vs 현재 흐름 다이어그램
- 변경 12개 카드뷰 (심각도 색상 코드)
- PHP 코드 마이그레이션 before/after
- API 엔드포인트 표

---

## 6. 관련 문서

- [`docs/PHP_EDITOR_INTEGRATION_PLAN.md`](./PHP_EDITOR_INTEGRATION_PLAN.md) — 원본 PHP 개발자 제안
- [`docs/BOOKMOA_INTEGRATION_GUIDE.md`](./BOOKMOA_INTEGRATION_GUIDE.md) — 현재 북모아 연동 가이드
- [`docs/EDITOR_INTEGRATION_GUIDE.md`](./EDITOR_INTEGRATION_GUIDE.md) — 에디터 임베딩 일반 가이드
- [`docs/03_INTEGRATION_GUIDE_KR.md`](./03_INTEGRATION_GUIDE_KR.md) — 종합 통합 가이드
- [`docs/WORKER_MERGE_PLAN.md`](./WORKER_MERGE_PLAN.md) — 워커 병합 설계
- [`docs/worker-ux-plan.md`](./worker-ux-plan.md) — 워커 UX 흐름
