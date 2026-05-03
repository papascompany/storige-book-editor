# 🚨 [PHP 팀 통보] Storige 보안 패치 적용 안내 (2026-05-03)

> **수신**: bookmoa PHP 개발팀
> **발신**: Storige 운영팀
> **시행일**: 2026-05-03 (master `726389f`, VPS API 재배포 완료)
> **호환성**: 🟢 **PHP 측 기존 코드는 그대로 작동** — 1가지 endpoint 변경 + 점진적 보강 권장
> **시급도**: 🔴 **합성 결과 PDF 다운로드 코드는 즉시 변경 필요** (그 외는 권장)

---

## 📌 요약 (1분 안에 파악)

| 변경 항목 | 영향 | 시급도 | 작업량 |
|---------|------|--------|--------|
| **PDF 다운로드 endpoint** `/files/:id/download` → `/files/:id/download/external` | 🔴 즉시 | 🔴 즉시 | 5분 (PHP 함수 1줄 수정) |
| `fileId` / `sessionId` 클라이언트 노출 검수 | 🟡 점검 | 🟡 단기 | 1~2시간 (마이페이지/주문 화면 검수) |
| `shop-session` 호출 시 `orderSeqno` 추가 | 🟢 호환 | 🟢 권장 | 5분 (한 필드 추가) |
| `callbackUrl` 호스트 화이트리스트 | 🟢 자동 | 🟢 자동 | 0분 (기본값에 `papascompany.co.kr`/`bookmoa.com` 포함) |

---

## 🔴 즉시 변경 필요 (1건)

### #1 — 합성 결과 PDF 다운로드 endpoint 변경

**왜 변경하나?**
- 이전 `/files/:id/download`는 `@Public()` 데코레이터로 **인증 없이 누구나 다운로드 가능**한 결함이었음
- 보안 패치 후 JWT 인증 + 소유자 검증 강제 → **PHP 서버에서 이 endpoint 호출 시 401**
- PHP 서버 (server-to-server) 용으로 신규 endpoint `/files/:id/download/external` 분리 (X-API-Key 인증)

**Before (작동 안 함, 401 반환)**:
```php
// ❌ 이전 코드 — 더 이상 작동 안 함
$pdfData = file_get_contents("https://api.papascompany.co.kr/api/files/{$fileId}/download");
```

**After (X-API-Key 인증)**:
```php
// ✅ 신규 endpoint + X-API-Key 헤더 사용
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
        error_log("[Storige] PDF 다운로드 실패: HTTP $httpCode (fileId=$fileId)");
        throw new Exception("PDF 다운로드 실패");
    }
    return $pdfData;
}
```

**검증 방법**:
```bash
# 운영에서 직접 테스트
curl -H "X-API-Key: $STORIGE_API_KEY" \
     -o /tmp/test.pdf \
     "https://api.papascompany.co.kr/api/files/{유효한_fileId}/download/external"
# → HTTP 200 + PDF 바이너리 다운로드 성공 확인
```

> ⚠️ **브라우저(클라이언트)에서 직접 다운로드 시도하면 401 반환됨**.
> 사용자에게 직접 보여주려면 PHP가 받은 후 다시 PHP가 사용자에게 스트림으로 전달:
>
> ```php
> // /mypage/download_result.php?orderSeqno=12345
> $pdfData = downloadSynthesizedPdf($fileId);  // PHP 서버가 받음
> header('Content-Type: application/pdf');
> header('Content-Disposition: attachment; filename="결과.pdf"');
> echo $pdfData;  // PHP가 사용자에게 전달
> ```

---

## 🟡 점검/검수 필요 (1건)

### #2 — `fileId` / `sessionId` 클라이언트 노출 검수

**왜 검수하나?**
- 이전엔 UUID 유출 시 누구나 다운로드/조회 가능했음 (위 결함 포함)
- 보안 패치 후엔 인증/권한 강제 → **클라이언트 노출 자체가 즉각적 위험은 아니지만**
- 실수로 fileId/sessionId가 HTML/JS에 박혀있으면 향후 다른 결함과 결합 시 위험
- **본인 외 다른 사용자의 UUID로 시도 시 403** — 정상 사용자에게도 혼란 가능

**검수 대상**:
1. PHP 마이페이지에서 storige UUID를 HTML에 직접 출력하는 곳
2. JavaScript 변수로 sessionId/fileId 저장하는 곳
3. URL 쿼리스트링에 노출하는 곳 (예: `?fileId=xxx`)

**잘못된 패턴**:
```html
<!-- ❌ HTML에 직접 노출 -->
<a href="https://api.papascompany.co.kr/api/files/<?= $fileId ?>/download">
    다운로드
</a>

<!-- ❌ JavaScript 변수로 노출 -->
<script>
const sessionId = '<?= $sessionId ?>';
window.location = `editor.papascompany.co.kr/?session_id=${sessionId}`;
</script>

<!-- ❌ URL 파라미터로 노출 -->
<a href="/mypage/download.php?fileId=<?= $fileId ?>">다운로드</a>
```

**올바른 패턴**:
```php
// ✅ /mypage/download.php?orderSeqno=12345 (orderSeqno만 노출)
<?php
$orderSeqno = (int) $_GET['orderSeqno'];
$memberSeqno = $_SESSION['memberSeqno'];

// 1. 본인 주문인지 PHP DB에서 검증
if (!isOrderOwnedByUser($orderSeqno, $memberSeqno)) {
    http_response_code(403);
    exit('Forbidden');
}

// 2. PHP DB에서 fileId 조회 (사용자에게 노출 안 됨)
$fileId = getOrderResultFileId($orderSeqno);

// 3. PHP 서버가 storige API 호출 (X-API-Key)
$pdfData = downloadSynthesizedPdf($fileId);

// 4. 사용자에게 스트림으로 전달
header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="주문결과_' . $orderSeqno . '.pdf"');
echo $pdfData;
```

```html
<!-- ✅ 사용자에게는 orderSeqno만 노출 -->
<a href="/mypage/download.php?orderSeqno=<?= $orderSeqno ?>">결과 PDF 다운로드</a>
```

**에디터 진입 URL은 sessionId를 포함해도 OK**:
```php
// ✅ 에디터 임베드 URL — sessionId 노출 OK (소유자 검증으로 안전)
// 다만 PHP에서 본인 sessionId 만 전달하도록 사전 검증
$mySessionId = getOrderSessionId($orderSeqno, $memberSeqno);  // 본인 것만 반환
?>
<iframe src="https://editor.papascompany.co.kr/?session_id=<?= $mySessionId ?>&token=<?= $jwt ?>"></iframe>
```

---

## 🟢 점진적 보강 권장 (2건)

### #3 — `shop-session` 호출 시 `orderSeqno` 추가 (호환 유지)

**왜 추가하나?**
- JWT 페이로드에 주문 컨텍스트 포함 → EditSession 생성 시 자동 검증
- 미적용 시 기존 동작 유지 (호환성 100%)
- 적용 시 사용자가 다른 주문번호로 작업 시도 시 **403 ORDER_NOT_ALLOWED** 자동 차단

**Before (호환 동작)**:
```php
function getShopSessionToken(int $orderSeqno, int $memberSeqno): string {
    $body = [
        'memberSeqno' => $memberSeqno,
        'memberId'    => $memberId,
        'memberName'  => $memberName,
    ];
    // ... API 호출
}
```

**After (권장 — 한 줄 추가)**:
```php
function getShopSessionToken(int $orderSeqno, int $memberSeqno): string {
    $body = [
        'memberSeqno'  => $memberSeqno,
        'memberId'     => $memberId,
        'memberName'   => $memberName,
        'orderSeqno'   => $orderSeqno,  // ✅ 한 줄 추가 — JWT에 포함됨
    ];
    // ... API 호출
}
```

**장바구니/복수 주문 시나리오** (선택):
```php
// 사용자가 여러 주문 한 번에 편집 가능한 경우
$body['allowedOrderSeqnos'] = [12345, 12346, 12347];  // 배열로
```

**효과**:
- 사용자 A의 JWT로 사용자 B의 주문에 작업하려는 시도 자동 차단
- PHP 측은 한 줄 변경만으로 추가 보안 확보

---

### #4 — `callbackUrl` 호스트 화이트리스트 (자동 적용)

**자동 허용 호스트**:
- `*.papascompany.co.kr` (서브도메인 포함)
- `*.bookmoa.com`
- `localhost`, `127.0.0.1` (개발 환경)

**예시 — 정상 동작**:
```php
$callbackUrl = 'https://www.bookmoa.com/storige/proc/synthesis_callback.php';  // ✅ 허용
$callbackUrl = 'https://api.bookmoa.com/storige/webhook';                       // ✅ 허용
$callbackUrl = 'https://www.papascompany.co.kr/webhook/storige';                // ✅ 허용
```

**예시 — 차단되는 경우**:
```php
$callbackUrl = 'https://evil.com/steal';                                        // ❌ 차단
$callbackUrl = 'https://attacker.com/intercept';                                // ❌ 차단
```

**다른 호스트 추가 필요 시** Storige 운영팀에 요청 → VPS `~/storige/.env`에 `WEBHOOK_ALLOWED_HOSTS` 추가 후 API 재기동.

---

## 🔍 변경된 API endpoint 매트릭스

| 메서드 | 경로 | 변경 | 인증 | 사용 위치 |
|-------|------|------|------|----------|
| `POST` | `/api/auth/shop-session` | 🟢 호환 (orderSeqno 옵션 추가) | X-API-Key | PHP 서버 |
| `POST` | `/api/files/upload/external` | 🟢 변경 없음 | X-API-Key | PHP 서버 |
| `POST` | `/api/worker-jobs/synthesize/external` | 🟢 변경 없음 | X-API-Key | PHP 서버 |
| `GET` | `/api/files/:id/download` | 🔴 **JWT 필수 + 소유자 검증** (이전 @Public) | JWT Bearer | 사용자 브라우저만 |
| `GET` | `/api/files/:id/download/external` | 🆕 **신규** | X-API-Key | PHP 서버 |
| `GET` | `/api/files/:id` | 🟡 소유자 검증 추가 | JWT Bearer | 본인만 |
| `GET` | `/api/files?orderSeqno=` | 🟡 일반 사용자는 본인 필터 강제 | JWT Bearer / X-API-Key | – |
| `GET` | `/api/edit-sessions/:id` | 🟡 소유자 검증 추가 | JWT Bearer | 본인만 |
| `GET` | `/api/edit-sessions/external?orderSeqno=` | 🟢 변경 없음 | X-API-Key | PHP 서버 |

> 💡 **핵심 원칙**:
> - PHP 서버에서 호출할 때 = `X-API-Key` 헤더 + `/external` endpoint 사용
> - 사용자 브라우저에서 호출 = `JWT Bearer` (본인 자원만 접근)

---

## ✅ PHP 팀 작업 체크리스트

복사해서 사용하세요:

```
☐ 1. /files/:id/download 호출 코드 검색 + /external 로 변경
   grep: "files/.*download" your-php-codebase
   대상: 합성 결과 PDF 다운로드 함수
   소요: 5분

☐ 2. fileId / sessionId 클라이언트 노출 검수
   대상: 마이페이지, 주문 상세, 결과 다운로드 화면
   확인: HTML/JS에 storige UUID 직접 박혀있는지
   소요: 1~2시간

☐ 3. shop-session 호출 코드에 orderSeqno 추가 (권장)
   대상: getShopSessionToken() 함수
   소요: 5분

☐ 4. callbackUrl이 papascompany.co.kr / bookmoa.com 호스트인지 확인
   대상: synthesis 호출 시 callbackUrl, edit-session 생성 시 callbackUrl
   소요: 5분

☐ 5. 통합 테스트 — 위 4건 적용 후 합성 + 다운로드 + Webhook 모두 정상 동작 확인
   소요: 30분
```

---

## 🆘 문제 발생 시 대응

### 다운로드 401 발생 시
```bash
# 1. /external endpoint 사용 + X-API-Key 헤더 확인
curl -v -H "X-API-Key: $KEY" https://api.papascompany.co.kr/api/files/{ID}/download/external

# 2. STORIGE_API_KEY 환경변수 확인
echo $STORIGE_API_KEY  # 비어있으면 .env / Apache SetEnv 점검
```

### EditSession 403 발생 시
```bash
# JWT 페이로드의 memberSeqno 와 EditSession.memberSeqno 일치 여부 확인
# Sentry 대시보드 (storige-api 프로젝트) 에서 자동 수집됨
```

### Webhook 차단 (호스트 검증)
```bash
# Storige API 로그 확인
ssh deploy@158.247.235.202 'docker logs storige-api 2>&1 | grep -i "Blocked callback URL"'
```

### Sentry 운영 추적
- 모든 storige 내부 에러는 https://sentry.io/organizations/papascompany/issues/ 에서 자동 수집
- PHP 측 호출이 storige에서 5xx 발생 시 즉시 가시화

---

## 📚 참고 문서

- [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) (v2.4) — 통합 레퍼런스
- [`PHP_INTEGRATION_VERIFICATION.md`](./PHP_INTEGRATION_VERIFICATION.md) (v2) — 13개 체크리스트 + §11 보안 가이드
- [`USER_IDENTITY_AUDIT_2026-05-03.md`](./USER_IDENTITY_AUDIT_2026-05-03.md) — 결함 분석 + 패치 상세
- [`BOOKMOA_INTEGRATION_DIFF.md`](./BOOKMOA_INTEGRATION_DIFF.md) — 원본 vs 현재 차이
- [`BOOKMOA_INTEGRATION_GUIDE.md`](./BOOKMOA_INTEGRATION_GUIDE.md) — 종합 가이드

---

## 📅 변경 이력

- **2026-05-03 v1** — 보안 패치 A-E 적용 + PHP 팀 통보 문서 신규 작성
- 패치 커밋: `726389f`
- 가이드 갱신: `1bbc8e9`
- VPS 적용: 2026-05-03 12:48 KST
