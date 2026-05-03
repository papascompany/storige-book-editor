# PHP 측 통합 검증 가이드

> **목적**: Storige 에디터 연동에서 PHP 개발자가 검증·구현해야 할 항목을 Storige 측 현재 구현 기준으로 정리.  
> Storige 측은 이미 운영 배포 완료 (`726389f`). PHP 측 작업 준비가 되는 시점에 이 문서를 기준으로 진행할 것.  
> **기준일**: 2026-05-03 (Storige master `726389f`, 보안 패치 A-E 반영)  
> **관련 문서**: `docs/BOOKMOA_INTEGRATION_DIFF.md`, `docs/BOOKMOA_INTEGRATION_GUIDE.md`, `docs/USER_IDENTITY_AUDIT_2026-05-03.md`

> ## ⚠️ 2026-05-03 보안 패치 — PHP 측 영향 요약
>
> 사용자 격리 권한 검증을 강화했습니다. PHP 측 **기존 코드는 그대로 작동**하지만, 다음 사항을 반드시 알고 진행해야 합니다:
>
> ### 🔴 즉시 영향 (운영 자동 적용)
> 1. **`/files/:id/download` 인증 강제**: 이전엔 누구나 다운로드 가능 → 이제 **JWT 인증 + 소유자 검증** 필요
>    - PHP 서버에서 합성 결과 PDF를 가져갈 때는 **`/files/:id/download/external` (X-API-Key)** 사용 (신규)
>    - 브라우저에서 직접 다운로드 시도하면 401
> 2. **`/files`, `/files/:id`, `/edit-sessions/:id` 모두 소유자 검증**
>    - JWT의 `memberSeqno`가 리소스의 `memberSeqno`와 일치해야 접근 가능
>    - PHP 마이페이지에서 사용자별 작업 목록 조회 시 PHP 서버에서 X-API-Key로 호출 권장 (브라우저 직접 호출 금지)
> 3. **`/edit-sessions/:id` 소유자 외 접근 시 403 ForbiddenException** 반환
>
> ### 🟡 권장 보강 (PHP 측 선택)
> 4. **shop-session 호출 시 `orderSeqno` 또는 `allowedOrderSeqnos` 전달 권장 (호환 유지)**
>    - 전달하면 JWT에 포함되어 EditSession 생성 시 자동 검증
>    - 미전달 시 기존 동작 유지 (DTO 값 신뢰)
> 5. **`callbackUrl` 호스트 화이트리스트**: `papascompany.co.kr`, `bookmoa.com`만 자동 허용
>    - 다른 호스트는 거부됨 — 운영 시 `WEBHOOK_ALLOWED_HOSTS` 환경변수로 추가 가능
>
> 자세한 내용은 [USER_IDENTITY_AUDIT_2026-05-03.md](./USER_IDENTITY_AUDIT_2026-05-03.md) 참조.

---

## 0. 요약 체크리스트

| # | 항목 | 우선순위 | PHP 작업 | 검증 방법 |
|---|---|---|---|---|
| 1 | 에디터 URL 파라미터 매핑 | 🔴 P0 | URL 생성 코드 수정 | 에디터 진입 확인 |
| 2 | `result.files` → fileId 기반 처리 | 🔴 P0 | 콜백 코드 수정 | `onComplete` 로그 확인 |
| 3 | Worker API 인증 (X-API-Key) | 🔴 P0 | API 호출 헤더 수정 | `/synthesize/external` 호출 |
| 4 | Webhook 수신 PHP 구현 | 🔴 P0 | 신규 파일 작성 | 실제 webhook POST 확인 |
| 5 | `apiBaseUrl` 명시 전달 | 🟡 P1 | config에 추가 | 에디터 API 요청 확인 |
| 6 | `paperType` / `bindingType` 매핑 | 🟡 P1 | 북모아 코드 → Storige 코드 매핑 | 책등 계산 확인 |
| 7 | 주문 처리 시 `synthesize/external` 호출 | 🟡 P1 | 주문 처리 코드에 추가 | Worker 작업 생성 확인 |
| 8 | 옵션 C: `allowCustomSize` 토글 + URL | 🟡 P1 | Admin + URL 파라미터 | width/height 적용 확인 |
| 9 | 재편집: `sessionId` 전달 | 🟡 P1 | 기존 세션 ID 전달 | 캔버스 복원 확인 |
| 10 | `onSave` / `onReady` 콜백 활용 | 🟢 P2 | 선택적 UX 개선 | — |
| 11 | **합성 결과 PDF 다운로드: `/external` endpoint 사용** | 🔴 P0 | PHP 서버에서 `X-API-Key` 헤더로 호출 | curl 200 OK |
| 12 | **fileId/sessionId 클라이언트 노출 금지** | 🔴 P0 | PHP 마이페이지 코드 검수 | 브라우저 DevTools에서 노출 X |
| 13 | **shop-session 호출 시 `orderSeqno` 추가** (권장) | 🟡 P1 | 기존 코드에 한 필드 추가 | JWT 페이로드에 `allowedOrderSeqnos` 포함 |

---

## 1. 에디터 진입 URL 파라미터 (Breaking Changes)

### 1-1. 원본 vs 현재 매핑 비교

| 원본 파라미터 | 현재 파라미터 | 변경 유형 | 비고 |
|---|---|---|---|
| `productId=Y` | `productId=Y` (여전히 동작) OR `orderSeqno=12345` | 🔄 유지 가능 | Storige는 두 방식 모두 수신. `orderSeqno` 우선 권장 |
| `pages=20` | ❌ 제거됨 | 🔴 Breaking | `pageCount=20` 으로 교체 |
| `wingFront=10&wingBack=5` | ❌ 제거됨 | 🔴 Breaking | `bindingType` + `paperType` 으로 교체 |
| (없음) | `pageCount=50` | 🟡 Added | 내지 페이지 수 (표지 제외) |
| (없음) | `paperType=mojo_80g` | 🟡 Added | 종이 코드 (하단 §3 참조) |
| (없음) | `bindingType=perfect` | 🟡 Added | 제본 방식 코드 (하단 §3 참조) |
| (없음) | `return_url=%2Fmypage%2Forder_detail.php` | 🟡 Added | 완료 후 리다이렉트 대상 |
| (없음) | `apiBaseUrl=https://api.papascompany.co.kr/api` | 🟡 Added | 명시 전달 권장 |
| (없음) | `sessionId=<uuid>` | 🟡 Added | 재편집 시 기존 세션 ID |
| (없음) | `width=148&height=210` | 🟡 Added | 옵션 C: mm 단위 사이즈 직접 지정 |

### 1-2. PHP URL 생성 코드

```php
<?php
// ✅ 현재 권장 방식

function buildStorigeEditorUrl(array $params): string {
    $base = 'https://editor.papascompany.co.kr';

    // 필수
    $query = [
        'template_set_id' => $params['templateSetId'],
        'api_base_url'    => 'https://api.papascompany.co.kr/api',
    ];

    // 방식 1: orderSeqno 기반 (권장 - 세션 자동 생성)
    if (!empty($params['orderSeqno'])) {
        $query['order_seqno'] = $params['orderSeqno'];
    }

    // 방식 2: productId 기반 (기존 호환)
    if (!empty($params['productId'])) {
        $query['product_id'] = $params['productId'];
    }

    // 페이지 수 (주의: pages → pageCount)
    if (!empty($params['pageCount'])) {
        $query['page_count'] = $params['pageCount'];   // ⚠️ 'pages' 는 더 이상 사용 안 함
    }

    // 종이·제본 정보 (책등 폭 자동 계산에 사용)
    if (!empty($params['paperType'])) {
        $query['paper_type']   = $params['paperType'];   // 예: 'mojo_80g'
        $query['binding_type'] = $params['bindingType']; // 예: 'perfect'
    }

    // 완료 후 리다이렉트
    if (!empty($params['returnUrl'])) {
        $query['return_url'] = $params['returnUrl'];
    }

    // 재편집: 기존 세션 ID 전달
    if (!empty($params['sessionId'])) {
        $query['session_id'] = $params['sessionId'];
    }

    // 옵션 C: 자유 사이즈 (product.allowCustomSize=true 인 상품만)
    if (!empty($params['widthMm']) && !empty($params['heightMm'])) {
        $query['width']  = $params['widthMm'];
        $query['height'] = $params['heightMm'];
    }

    return $base . '?' . http_build_query($query);
}

// 사용 예시
$url = buildStorigeEditorUrl([
    'templateSetId' => 'ts-perfect-a5-50p',
    'orderSeqno'    => $order['seqno'],
    'pageCount'     => 50,
    'paperType'     => 'mojo_80g',
    'bindingType'   => 'perfect',
    'returnUrl'     => '/mypage/order_edit.php?order_seqno=' . $order['seqno'],
]);
```

> ⚠️ **주의**: Storige 에디터는 iframe 임베딩이 아닌 **직접 URL 이동** 방식으로 운영 중.  
> 에디터에서 "편집 완료" 클릭 시 `returnUrl` 로 리다이렉트됨 + `onComplete` 콜백 실행.

### 1-3. EditorView.tsx 수신 코드 (참고용)

```typescript
// apps/editor/src/views/EditorView.tsx:78~84
const pageCount    = searchParams.get('pageCount')      // ✅ 'pages' 아님
const paperType    = searchParams.get('paperType')
const bindingType  = searchParams.get('bindingType')
const width        = searchParams.get('width')           // 옵션 C
const height       = searchParams.get('height')          // 옵션 C
```

---

## 2. 편집 완료 콜백 (`onComplete`) — fileId 처리

### 2-1. `EditorResult` 현재 구조

```typescript
// apps/editor/src/embed.tsx:105~122
interface EditorResult {
  sessionId: string            // 편집 세션 UUID
  orderSeqno?: number          // 주문 번호
  editCode?: string            // 'EDIT-XXXXXXXX' 형식 단축 코드
  pages: {
    initial: number            // 초기 페이지 수
    final: number              // 최종 페이지 수
  }
  files: {
    coverFileId?: string       // 표지 PDF 파일 UUID  ← ⚠️ URL 아님!
    contentFileId?: string     // 내지 PDF 파일 UUID  ← ⚠️ URL 아님!
    cover?: string             // 표지 PDF URL (선택적으로 포함될 수 있음)
    content?: string           // 내지 PDF URL (선택적으로 포함될 수 있음)
    thumbnailUrl?: string      // 썸네일 이미지 URL
    thumbnail?: string         // 썸네일 URL (별칭)
  }
  savedAt: string              // ISO 8601
}
```

### 2-2. PHP 콜백 처리 코드

```javascript
// PHP 페이지에 삽입될 JS (returnUrl 이후 페이지에서)
window.STORIGE_RETURN_HANDLER = function(result) {
    // result.files.coverFileId / contentFileId 는 UUID (URL 아님)
    fetch('/storige/proc/save_edit_result.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            order_seqno:      result.orderSeqno,
            session_id:       result.sessionId,
            cover_file_id:    result.files.coverFileId,    // ⚠️ UUID
            content_file_id:  result.files.contentFileId,  // ⚠️ UUID
            thumbnail_url:    result.files.thumbnailUrl || result.files.thumbnail,
            final_pages:      result.pages.final,
        })
    });
};
```

```php
<?php
// /storige/proc/save_edit_result.php
$data = json_decode(file_get_contents('php://input'), true);

// ⚠️ fileId는 UUID — 직접 다운로드 URL이 아님
// 파일 다운로드 URL은 Storige API 를 통해 획득:
// GET https://api.papascompany.co.kr/api/files/{fileId}
// 응답: { id, url, ... }

$orderSeqno    = (int)$data['order_seqno'];
$sessionId     = $data['session_id'];
$coverFileId   = $data['cover_file_id'];   // UUID
$contentFileId = $data['content_file_id']; // UUID
$thumbnailUrl  = $data['thumbnail_url'];

// DB에 저장
// UPDATE bookmoa_orders SET 
//   storige_session_id = ?,
//   storige_cover_file_id = ?,
//   storige_content_file_id = ?
// WHERE order_seqno = ?
saveEditResult($orderSeqno, $sessionId, $coverFileId, $contentFileId);
```

> **파일 URL 조회 API**: `GET https://api.papascompany.co.kr/api/files/{fileId}`  
> 이 endpoint는 Worker가 synthesis 완료 후 outputFileUrl을 반환하므로, 편집 완료 시점에는 병합 전 PDF URL임.  
> 최종 병합 PDF URL은 Webhook 콜백(`synthesis.completed`)의 `outputFileUrl` 필드에서 획득.

---

## 3. 종이·제본 코드 매핑

### 3-1. `paperType` 코드

| 북모아 UI 값 | Storige `paperType` 코드 | 책등 계산 기준 (80g 기준 ~0.1mm/p) |
|---|---|---|
| 모조지 80g | `mojo_80g` | 0.1 mm/장 |
| 모조지 100g | `mojo_100g` | 0.12 mm/장 |
| 아트지 100g | `art_100g` | 0.10 mm/장 |
| 아트지 150g | `art_150g` | 0.13 mm/장 |
| 스노우 100g | `snow_100g` | 0.105 mm/장 |
| 뉴플러스 80g | `newplus_80g` | 0.095 mm/장 |

> ⚠️ **미확정**: 위 코드 값은 Storige 측과 상호 합의 필요. 현재 에디터가 수신은 하지만 책등 계산 공식은 추후 확정 예정.  
> PHP → Storige URL 파라미터에 넣을 때 위 코드를 사용하도록 매핑 테이블 작성 권장.

### 3-2. `bindingType` 코드

| 제본 방식 | Storige `bindingType` 코드 |
|---|---|
| 무선 제본 (Perfect Binding) | `perfect` |
| 중철 제본 (Saddle Stitch) | `saddle` |
| 스프링 제본 | `spring` |
| 반양장 | `half_hardcover` |
| 양장 (Hardcover) | `hardcover` |

---

## 4. Worker API 연동 (PDF 병합)

### 4-1. 인증 방식

```
❌ 원본: Authorization: Bearer {JWT}
✅ 현재: X-API-Key: {api-key}
```

> API Key는 Storige Admin 또는 인프라팀으로부터 발급.  
> 운영 API Key: 별도 채널로 전달 예정 (이 문서에 기재 안 함).

### 4-2. 병합 가능 여부 사전 체크 (`check-mergeable`)

저장 시점 또는 주문 직전에 PDF 병합 가능 여부를 사전 확인:

```php
function checkMergeable(string $sessionId, string $coverFileId, string $contentFileId, float $spineWidth): array {
    $payload = [
        'editSessionId' => $sessionId,
        'coverFileId'   => $coverFileId,
        'contentFileId' => $contentFileId,
        'spineWidth'    => $spineWidth,   // mm 단위
    ];

    $ch = curl_init('https://api.papascompany.co.kr/api/worker-jobs/check-mergeable/external');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'X-API-Key: ' . STORIGE_API_KEY,    // ⚠️ JWT 아님!
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_TIMEOUT        => 30,
    ]);

    $resp = json_decode(curl_exec($ch), true);
    curl_close($ch);

    // 응답: { mergeable: true/false, issues: [{ code, message }, ...] }
    return $resp;
}

// 사용 예시 (주문 처리 직전)
$check = checkMergeable($sessionId, $coverFileId, $contentFileId, $spineWidthMm);
if (!$check['mergeable']) {
    // 주문 중단 + 사용자에게 안내
    $errorMsg = implode(', ', array_column($check['issues'], 'message'));
    throw new Exception('PDF 병합 불가: ' . $errorMsg);
}
```

### 4-3. PDF 합성 요청 (`synthesize/external`)

주문 처리(주문 생성 or 결제 완료) 시점에 호출:

```php
function requestSynthesis(array $params): array {
    $payload = [
        'editSessionId' => $params['sessionId'],
        'coverFileId'   => $params['coverFileId'],
        'contentFileId' => $params['contentFileId'],
        'spineWidth'    => $params['spineWidthMm'],
        'orderId'       => 'ORD-' . $params['orderSeqno'],
        'priority'      => $params['priority'] ?? 'high',   // 'high' | 'normal' | 'low'
        'callbackUrl'   => 'https://www.bookmoa.co.kr/storige/proc/synthesis_callback.php',
    ];

    $ch = curl_init('https://api.papascompany.co.kr/api/worker-jobs/synthesize/external');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'X-API-Key: ' . STORIGE_API_KEY,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_TIMEOUT        => 30,
    ]);

    $resp = json_decode(curl_exec($ch), true);
    curl_close($ch);

    // 응답: { jobId: "...", status: "PENDING", createdAt: "..." }
    return $resp;
}

// 응답 jobId를 DB에 저장해 상태 추적에 활용
$job = requestSynthesis([...]);
saveJobId($orderSeqno, $job['jobId']);
```

### 4-4. 작업 상태 폴링 (선택)

Webhook 수신이 어려운 환경에서는 폴링으로 상태 확인 가능:

```php
function getJobStatus(string $jobId): array {
    $ch = curl_init("https://api.papascompany.co.kr/api/worker-jobs/external/{$jobId}");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['X-API-Key: ' . STORIGE_API_KEY],
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp = json_decode(curl_exec($ch), true);
    curl_close($ch);

    // 응답: { id, status: 'PENDING'|'PROCESSING'|'COMPLETED'|'FAILED', outputFileUrl, ... }
    return $resp;
}

// 상태 값
// PENDING    → 대기 중
// PROCESSING → 처리 중
// COMPLETED  → 완료 (outputFileUrl에 최종 PDF URL)
// FAILED     → 실패 (errorMessage 확인)
```

---

## 5. Webhook 수신 구현 (신규 파일 필요)

### 5-1. 파일 생성 위치

```
/storige/proc/synthesis_callback.php   ← 신규 구현 필요
```

### 5-2. 구현 코드

```php
<?php
// /storige/proc/synthesis_callback.php
// Storige Worker가 PDF 합성 완료/실패 시 POST로 호출

// HMAC 서명 검증 (Storige 측과 키 합의 필요)
// $signature = $_SERVER['HTTP_X_STORIGE_SIGNATURE'] ?? '';
// if (!verifySignature(file_get_contents('php://input'), $signature, STORIGE_WEBHOOK_SECRET)) {
//     http_response_code(401);
//     exit;
// }

$rawBody = file_get_contents('php://input');
$payload = json_decode($rawBody, true);
$event   = $_SERVER['HTTP_X_STORIGE_EVENT'] ?? $payload['event'] ?? '';

// 요청 로깅 (디버깅용)
error_log('[storige_webhook] event=' . $event . ' jobId=' . ($payload['jobId'] ?? 'n/a'));

if ($event === 'synthesis.completed') {
    /*
     * Payload 구조:
     * {
     *   "event":         "synthesis.completed",
     *   "jobId":         "uuid",
     *   "orderId":       "ORD-12345",
     *   "status":        "COMPLETED",
     *   "outputFileUrl": "https://api.papascompany.co.kr/api/files/{uuid}/download",
     *   "completedAt":   "2026-05-02T10:00:00Z"
     * }
     */
    $jobId         = $payload['jobId'];
    $orderId       = $payload['orderId'];          // 'ORD-12345' 형식 → 파싱 필요
    $outputFileUrl = $payload['outputFileUrl'];    // 최종 병합 PDF URL
    $completedAt   = $payload['completedAt'];

    // orderId 파싱: 'ORD-12345' → 12345
    $orderSeqno = (int)str_replace('ORD-', '', $orderId);

    // DB 업데이트
    // 1) order_files: 병합된 PDF URL 저장
    // 2) order_status: 110(에디팅 완료) → 210(PDF 생성 완료)
    updateOrderFile($orderSeqno, $outputFileUrl);
    updateOrderStatus($orderSeqno, 210);

    // 관리자 알림 (선택)
    // notifyAdminOrderReady($orderSeqno);

} elseif ($event === 'synthesis.failed') {
    /*
     * Payload 구조:
     * {
     *   "event":        "synthesis.failed",
     *   "jobId":        "uuid",
     *   "orderId":      "ORD-12345",
     *   "status":       "FAILED",
     *   "errorMessage": "PDF merge failed: ...",
     *   "failedAt":     "2026-05-02T10:00:00Z"
     * }
     */
    $orderId      = $payload['orderId'];
    $errorMessage = $payload['errorMessage'] ?? '알 수 없는 오류';
    $orderSeqno   = (int)str_replace('ORD-', '', $orderId);

    // 실패 처리
    updateOrderStatus($orderSeqno, -1);   // 실패 상태 코드 (북모아 기준)
    notifyAdminOfSynthesisFailure($orderSeqno, $errorMessage);
    // 선택: 고객에게 재편집 요청 이메일 발송

} else {
    // 알 수 없는 이벤트 — 200으로 수신 확인 후 무시
    error_log('[storige_webhook] unknown event: ' . $event);
}

// Storige 측에 200 응답 필수 (미응답 시 재시도 3회)
http_response_code(200);
echo json_encode(['received' => true]);
exit;
```

### 5-3. Webhook 응답 정책

| 응답 코드 | Storige 처리 |
|---|---|
| 200 | 성공 — 재시도 없음 |
| 4xx, 5xx | 실패 — 지수 백오프로 최대 3회 재시도 |
| 타임아웃 (>30s) | 실패로 간주 — 재시도 |

> ⚠️ **중요**: Webhook 응답은 30초 내에 반환해야 함. 오래 걸리는 처리는 큐에 넣고 즉시 200 반환.

---

## 6. 재편집 흐름

PHP에서 기존 편집 작업을 다시 불러올 때:

```php
// 주문 상세 페이지에서 "수정하기" 버튼 클릭 시
function buildEditAgainUrl(int $orderSeqno, string $existingSessionId): string {
    return buildStorigeEditorUrl([
        'templateSetId' => getTemplateSetIdForOrder($orderSeqno),
        'orderSeqno'    => $orderSeqno,
        'sessionId'     => $existingSessionId,   // ⚠️ 기존 세션 전달 → 캔버스 자동 복원
        'pageCount'     => getPageCountForOrder($orderSeqno),
        'paperType'     => getPaperTypeForOrder($orderSeqno),
        'bindingType'   => getBindingTypeForOrder($orderSeqno),
        'returnUrl'     => '/mypage/order_edit.php?order_seqno=' . $orderSeqno,
    ]);
}
```

에디터 흐름:
1. `sessionId` 전달 → Storige API에서 기존 `edit_sessions` 조회
2. `canvasData` 있으면 캔버스에 복원 (`core.loadFromJSON`)
3. 없으면 새 세션 생성 (신규 작업으로 진행)

---

## 7. 옵션 C: 자유 사이즈 설정

PHP에서 사용자가 mm 단위로 사이즈를 입력할 때:

### 7-1. Storige Admin 설정 (선행 필요)

1. `https://editor.papascompany.co.kr` 에디터 어드민 로그인
2. 상품 목록 → 해당 상품 선택 → 편집
3. **"외부 쇼핑몰 사이즈 override 허용"** 스위치 **ON** 저장

> 이 설정 없이 `width/height` 파라미터를 보내도 무시됨 (보안 정책).

### 7-2. PHP URL 생성

```php
// 사용자가 폼에서 사이즈 입력 (mm)
$widthMm  = (int)$_POST['width_mm'];
$heightMm = (int)$_POST['height_mm'];

$url = buildStorigeEditorUrl([
    'templateSetId' => 'ts-custom-size',
    'orderSeqno'    => $orderSeqno,
    'widthMm'       => $widthMm,
    'heightMm'      => $heightMm,
    'pageCount'     => $pageCount,
    'paperType'     => $paperType,
    'bindingType'   => $bindingType,
    'returnUrl'     => '/mypage/order_edit.php?order_seqno=' . $orderSeqno,
]);
```

### 7-3. 검증 규칙 (Storige Editor 측)

```typescript
// apps/editor/src/views/EditorView.tsx:213~234
const customWidthMm  = Number(width)
const customHeightMm = Number(height)
const isValidCustomSize =
    product.allowCustomSize === true &&
    Number.isFinite(customWidthMm) && customWidthMm > 0 && customWidthMm <= 2000 &&
    Number.isFinite(customHeightMm) && customHeightMm > 0 && customHeightMm <= 2000
// 유효하지 않으면 무시 + console.warn
```

---

## 8. 전체 연동 흐름 다이어그램 (현재 기준)

```
[북모아 PHP]                              [Storige Editor]                [Storige API/Worker]
     │                                           │                               │
     │── 에디터 URL 이동 ─────────────────────────▶│                               │
     │   ?template_set_id=...                    │── GET /templates/:id ─────────▶│
     │   &order_seqno=12345                      │   GET /editor/sessions?... ──▶│
     │   &page_count=50                          │                               │
     │   &paper_type=mojo_80g                    │── POST /editor/sessions ─────▶│ (신규 세션 생성)
     │   &binding_type=perfect                   │◀── session { id, canvasData }─│
     │   &return_url=/mypage/...                 │                               │
     │                                           │  [사용자 편집 중...]            │
     │                                           │── POST /editor/sessions/:id/  │
     │                                           │   auto-save (1분마다) ────────▶│
     │                                           │                               │
     │                                           │  [편집 완료 클릭]               │
     │                                           │── PUT /editor/sessions/:id ──▶│ (canvasData 저장)
     │                                           │── POST /editor/sessions/:id/  │
     │                                           │   complete ───────────────────▶│
     │                                           │                               │
     │◀── returnUrl 리다이렉트 + onComplete ──────│                               │
     │    result.files.coverFileId = UUID        │                               │
     │    result.files.contentFileId = UUID      │                               │
     │                                           │                               │
     │── POST /api/worker-jobs/                  │                               │
     │   check-mergeable/external ───────────────────────────────────────────────▶│
     │◀── { mergeable: true } ────────────────────────────────────────────────────│
     │                                           │                               │
     │  [주문 결제 완료]                           │                               │
     │── POST /api/worker-jobs/                  │                               │
     │   synthesize/external ────────────────────────────────────────────────────▶│
     │◀── { jobId: "uuid", status: "PENDING" } ──────────────────────────────────│
     │                                           │  [Worker 비동기 처리 중...]     │
     │                                           │                               │── PDF 합성
     │                                           │                               │
     │◀── POST /storige/proc/synthesis_callback.php ──────────────────────────────│
     │    X-Storige-Event: synthesis.completed   │                               │
     │    { outputFileUrl: "https://..." }       │                               │
     │                                           │                               │
     │ order_status: 110 → 210                   │                               │
     │ order_files: outputFileUrl 저장            │                               │
```

---

## 9. 검증 시나리오 (PHP 준비 완료 후 실행)

### 시나리오 1: 신규 편집 진입

```
1. PHP → 에디터 URL 생성 (order_seqno, template_set_id, page_count, paper_type, binding_type)
2. 에디터 로드 확인 → 콘솔에 "[EmbeddedEditor] New session created: {uuid}" 출력 확인
3. 간단한 텍스트 추가 후 "편집 완료" 클릭
4. returnUrl 리다이렉트 확인
5. PHP DB: storige_session_id, cover_file_id 저장 확인
```

### 시나리오 2: 재편집

```
1. 기존 sessionId를 URL에 추가
2. 에디터 로드 시 캔버스 복원 확인 → "[EmbeddedEditor] Existing session loaded: {uuid}"
3. 편집 완료 → 세션 덮어쓰기 확인
```

### 시나리오 3: PDF 합성

```
1. 편집 완료 후 coverFileId / contentFileId 수신 확인
2. POST /synthesize/external 호출 → jobId 응답 확인
3. 5~10분 후 synthesis_callback.php 수신 확인
4. outputFileUrl에서 PDF 다운로드 확인
```

### 시나리오 4: 옵션 C 자유 사이즈

```
1. Admin에서 allowCustomSize=true 설정 확인
2. URL에 width=148&height=210 추가
3. 에디터 캔버스가 148mm × 210mm로 로드됨 확인
4. allowCustomSize=false 상품에 같은 파라미터 → 기본 사이즈로 무시됨 확인
```

---

## 10. FAQ

**Q. API Key는 어떻게 발급받나요?**  
A. Storige 인프라팀에서 발급. 환경별(개발/운영)로 별도 Key 사용 권장.

**Q. `sessionId` 없이 `orderSeqno`만 전달하면?**  
A. Storige API가 해당 `orderSeqno`로 기존 세션을 검색 → 없으면 신규 생성. 있으면 기존 세션 사용 (재편집 자동 처리).

**Q. Webhook 없이 운영하고 싶다면?**  
A. `GET /api/worker-jobs/external/{jobId}` 폴링으로 상태 확인 가능. 단 실시간성 떨어짐.

**Q. PDF 합성 없이 에디터만 쓰고 싶다면?**  
A. `synthesize/external` 호출 없이 편집 완료 후 `coverFileId`/`contentFileId` UUID로 Storige API에서 파일 직접 다운로드 가능.

**Q. `pages` 파라미터가 왜 `pageCount`로 바뀌었나요?**  
A. 원본 `pages`는 표지 포함 전체 페이지 수였으나, Storige의 내부 모델은 내지(본문) 페이지 수를 기준으로 표지를 별도 계산. 혼선 방지를 위해 명칭 변경.

---

## 관련 파일 경로 (Storige 내부 참고용)

| 역할 | 파일 |
|---|---|
| 에디터 임베드 진입점 | `apps/editor/src/embed.tsx` |
| URL 파라미터 수신 | `apps/editor/src/views/EditorView.tsx:39~85` |
| 세션 API 엔드포인트 | `apps/api/src/editor/editor.controller.ts` |
| Worker 외부 API | `apps/api/src/worker-jobs/worker-jobs.controller.ts:94~175` |
| Worker 합성 서비스 | `apps/api/src/worker-jobs/worker-jobs.service.ts:299~350` |
| DB 마이그레이션 SQL | `apps/api/migrations/20260501_add_edit_session_versions.sql` |
| 기존 연동 차이 비교 | `docs/BOOKMOA_INTEGRATION_DIFF.md` |
| 북모아 연동 가이드 | `docs/BOOKMOA_INTEGRATION_GUIDE.md` |
| 종합 통합 가이드 | `docs/03_INTEGRATION_GUIDE_KR.md` |
| 사용자 식별 감사 보고 | `docs/USER_IDENTITY_AUDIT_2026-05-03.md` |
| 보안 패치 (Patch A-E) | commit `726389f` |

---

## 11. 보안 패치 (2026-05-03) — PHP 측 작업 가이드

### 11-1. 합성 결과 PDF 다운로드 — `/external` endpoint 사용

**Before** (이전 — 인증 없이 다운로드 가능, 결함):
```php
// ❌ 더 이상 작동 안 함 (401 반환)
$pdfData = file_get_contents("https://api.papascompany.co.kr/api/files/{$fileId}/download");
```

**After** (보안 패치 후 — X-API-Key 인증 필수):
```php
// ✅ PHP 서버에서 합성 결과 다운로드
function downloadSynthesizedPdf(string $fileId): string {
    $ch = curl_init("https://api.papascompany.co.kr/api/files/{$fileId}/download/external");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['X-API-Key: ' . STORIGE_API_KEY],
    ]);
    $pdfData = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new Exception("PDF 다운로드 실패: HTTP $httpCode");
    }
    return $pdfData;
}
```

> ⚠️ **브라우저(클라이언트)에서 직접 다운로드 시도하면 401**. 사용자에게 직접 보여줄 필요가 있다면 PHP 서버에서 받아서 PHP가 다시 사용자에게 스트림으로 전달.

### 11-2. fileId / sessionId 클라이언트 노출 금지

**잘못된 패턴** (❌ 결함과 결합 시 위험):
```html
<!-- ❌ HTML에 fileId 직접 노출 -->
<a href="https://api.papascompany.co.kr/api/files/<?= $fileId ?>/download">다운로드</a>

<!-- ❌ JavaScript 변수로 노출 -->
<script>const sessionId = '<?= $sessionId ?>';</script>
```

**올바른 패턴**:
```php
// ✅ PHP 서버에서 받아서 PHP가 응답 (사용자에게 fileId 노출 X)
// /mypage/download.php?orderSeqno=12345
$orderSeqno = $_GET['orderSeqno'];
// 1. 본인 주문 검증
if (!isOrderOwnedByUser($orderSeqno, $_SESSION['memberSeqno'])) {
    http_response_code(403);
    exit('Forbidden');
}
// 2. PHP 서버가 storige API 호출
$fileId = getOrderResultFileId($orderSeqno); // DB에서 조회
$pdfData = downloadSynthesizedPdf($fileId);
// 3. 사용자에게 스트림으로 전달
header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="결과.pdf"');
echo $pdfData;
```

### 11-3. shop-session 호출 시 orderSeqno 추가 (권장)

**Before** (이전 — 호환 동작):
```php
function getShopSessionToken(int $orderSeqno, int $memberSeqno, string $templateSetId): string {
    $body = [
        'memberSeqno' => $memberSeqno,
        'memberId'    => $memberId,
        'memberName'  => $memberName,
    ];
    // ...
}
```

**After** (권장 — JWT에 주문 컨텍스트 포함):
```php
function getShopSessionToken(int $orderSeqno, int $memberSeqno, string $templateSetId): string {
    $body = [
        'memberSeqno'  => $memberSeqno,
        'memberId'     => $memberId,
        'memberName'   => $memberName,
        'orderSeqno'   => $orderSeqno,  // ✅ 권장 추가 — 단일 주문 컨텍스트
        // 또는 장바구니에서 여러 주문 가능 시:
        // 'allowedOrderSeqnos' => [$orderSeqno1, $orderSeqno2],
    ];
    // ...
}
```

**효과**:
- JWT 페이로드에 `allowedOrderSeqnos` 포함됨
- 사용자가 다른 주문번호로 EditSession 생성 시도 시 자동 차단 (403 ORDER_NOT_ALLOWED)
- **호환성 유지**: 미전달 시 기존 동작 그대로

### 11-4. PHP 마이페이지 — 사용자 작업 목록 조회

**상황**: 사용자가 마이페이지에서 자기 주문/작업 목록을 보고 싶을 때

**잘못된 패턴** (❌ JS에서 직접 호출):
```javascript
// ❌ 브라우저에서 직접 호출 — JWT 만료/탈취 위험
fetch(`https://api.papascompany.co.kr/api/files?memberSeqno=${memberSeqno}`)
```

**올바른 패턴**:
```php
// ✅ PHP 서버에서 X-API-Key로 호출 후 사용자에게 결과만 전달
function getMyFiles(int $memberSeqno): array {
    $ch = curl_init("https://api.papascompany.co.kr/api/files?memberSeqno={$memberSeqno}");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['X-API-Key: ' . STORIGE_API_KEY],
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res['files'] ?? [];
}
```

> 💡 **참고**: 위 endpoint는 일반 JWT 기반에선 본인 외 조회 차단됨. PHP 서버는 X-API-Key로 admin/manager 권한 호출 → 임의 memberSeqno 조회 가능.

### 11-5. Webhook callbackUrl 호스트 검증 (운영 변경 사항)

PHP 측 webhook 수신 URL은 다음 호스트여야 함 (자동 허용):
- `*.papascompany.co.kr` (서브도메인 포함)
- `*.bookmoa.com`
- `localhost`, `127.0.0.1` (개발 환경)

다른 호스트로 webhook 호출 시도 시 storige API에서 거부 + 로그:
```
[Webhook] Blocked callback URL not in allowlist: https://evil.com/...
```

**운영 시 추가 호스트가 필요하면** VPS `~/storige/.env`:
```bash
WEBHOOK_ALLOWED_HOSTS=papascompany.co.kr,bookmoa.com,my-test.example.com
```

---

## 12. 변경 이력

- **v1 (2026-05-02)** — 최초 작성. 10개 PHP 체크리스트.
- **v2 (2026-05-03)** — 보안 패치 (Patch A-E) 반영:
  - 체크리스트 #11/12/13 추가
  - §11 보안 패치 PHP 측 작업 가이드 신규
  - 다운로드 endpoint 변경 (`/external` 사용) + 코드 예시
  - shop-session orderSeqno 권장 + JWT 강화
  - Webhook 호스트 화이트리스트

