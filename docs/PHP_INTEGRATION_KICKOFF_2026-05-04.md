# PHP 팀 통합 킥오프 문서 (2026-05-04)

> **수신**: bookmoa PHP 개발팀  
> **발신**: Storige 운영팀  
> **목적**: Storige × bookmoa 통합 작업 일정 조율 및 킥오프  
> **현재 상태**: Storige 측 준비 **100% 완료** — PHP 측 작업 2일 예상

---

## 1. 현재 상태 요약

### ✅ Storige 측 완료 항목

| 항목 | 상태 | 날짜 |
|------|------|------|
| API 운영 배포 | ✅ 완료 | 2026-05-03 |
| 보안 패치 A-E 적용 | ✅ 완료 | 2026-05-03 |
| Worker 합성 E2E 검증 | ✅ 완료 | 2026-05-04 |
| PHP 팀용 외부 endpoint 분리 | ✅ 완료 | 2026-05-03 |
| Sentry 모니터링 활성화 | ✅ 완료 | 2026-05-03 |
| API 문서 (Swagger) | ✅ 운영 중 | — |

### 📌 PHP 측 필요 작업

| 작업 | 시급도 | 예상 시간 |
|------|--------|-----------|
| PDF 다운로드 endpoint 변경 (필수) | 🔴 즉시 | 5분 |
| API Key 발급 수령 및 저장 | 🔴 즉시 | 5분 |
| 통합 시나리오 테스트 | 🟡 1~2일 | 1~2일 |
| 운영 컷오버 확인 | 🟢 협의 | 협의 |

---

## 2. PHP 측 필수 코드 변경 (1건 — 5분)

### 합성 PDF 다운로드 endpoint 변경

**기존 (작동 안 함, 401 오류)**:
```php
// ❌ 이 코드는 보안 패치 이후 401을 반환합니다
$pdfData = file_get_contents("https://api.papascompany.co.kr/api/files/{$fileId}/download");
```

**변경 후**:
```php
// ✅ 외부용 endpoint + X-API-Key 헤더 사용
define('STORIGE_API_KEY', 'sk-storige-REDACTED_SEE_VPS_ENV');
define('STORIGE_API_BASE', 'https://api.papascompany.co.kr/api');

function storigenDownloadOutputPdf(string $fileId): string {
    $ch = curl_init(STORIGE_API_BASE . "/files/{$fileId}/download/external");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'X-API-Key: ' . STORIGE_API_KEY,
            'Accept: application/pdf',
        ],
        CURLOPT_TIMEOUT => 30,
    ]);
    $pdfData = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        error_log("[Storige] PDF 다운로드 실패: HTTP {$httpCode} (fileId={$fileId})");
        throw new RuntimeException("Storige PDF 다운로드 실패 (HTTP {$httpCode})");
    }
    return $pdfData;
}
```

> 🔑 **API Key**: `CLAUDE.local.md`의 `STORIGE_API_KEY` 항목 참조  
> (이 문서에는 기재하지 않음 — Storige 운영팀에 직접 요청)

---

## 3. 통합 테스트 시나리오

### 시나리오 1: 기본 합성 플로우

```
1. bookmoa 고객이 주문 → orderSeqno 발급
2. PHP → POST /api/worker-jobs/synthesize/external (X-API-Key)
   Body: { coverFileId, contentFileId, spineWidth, orderId, callbackUrl }
3. Worker 처리 (수 초~수십 초)
4. callbackUrl로 webhook 수신 (synthesis.completed)
5. PHP → GET /api/files/{outputFileId}/download/external (X-API-Key)
6. PDF 저장 → 고객에게 다운로드 제공
```

### 시나리오 2: Webhook 없이 폴링

```
1. POST /api/worker-jobs/synthesize/external → jobId 수신
2. GET /api/worker-jobs/external/{jobId} (X-API-Key) 반복 조회
3. status = COMPLETED → outputFileUrl에서 fileId 추출 후 다운로드
```

---

## 4. 운영 API 엔드포인트 (PHP 팀용)

| 용도 | Method | Endpoint | 인증 |
|------|--------|----------|------|
| 검증 잡 생성 | POST | `/api/worker-jobs/validate/external` | X-API-Key |
| 합성 잡 생성 | POST | `/api/worker-jobs/synthesize/external` | X-API-Key |
| 잡 상태 조회 | GET | `/api/worker-jobs/external/{id}` | X-API-Key |
| 파일 다운로드 | GET | `/api/files/{id}/download/external` | X-API-Key |
| API 문서 | — | https://api.papascompany.co.kr/api/docs | — |

**공통 헤더**:
```
X-API-Key: <STORIGE_API_KEY>
Content-Type: application/json
```

---

## 5. 권장 통합 일정

| 주차 | PHP 팀 작업 | Storige 지원 |
|------|-------------|-------------|
| **1주차** (즉시~5/11) | endpoint 변경 + API Key 설정 + 로컬 통합 테스트 | API 문서 제공, 질의 응답 |
| **2주차** (5/12~5/18) | 운영 통합 테스트 (실 주문 데이터로) | Sentry 모니터링 + 이슈 즉각 대응 |
| **3주차** (5/19~5/25) | 운영 컷오버 + 1주 모니터링 기간 | 24시간 대응 준비 |

> 일정 조율이 필요한 경우 아래 섹션에서 논의.

---

## 6. PHP 팀에 요청할 정보

통합 진행을 위해 아래 정보를 Storige 운영팀에 공유해 주세요:

1. **담당자 연락처** (이름, 이메일, Slack/Teams)
2. **가능한 킥오프 미팅 일정** (30분)
3. **Webhook 수신 URL** (`callbackUrl`에 등록할 bookmoa 서버 endpoint)
4. **통합 테스트 환경** (운영 직접? 별도 스테이징?)
5. **주문 볼륨 예상** (일 주문 수 → Worker 큐 사이즈 사전 조정)

---

## 7. 이메일/메시지 템플릿

### PHP 팀 킥오프 요청 메일

```
제목: [Storige × bookmoa] 통합 킥오프 요청 — Storige 측 준비 완료

안녕하세요, bookmoa PHP 팀 담당자님.

Storige 운영팀입니다.

Storige × bookmoa 인쇄 워크플로 통합 준비가 완료되었습니다.
PHP 팀 측 작업은 총 2일 이내로 예상됩니다.

**필수 변경 사항 (즉시)**
- PDF 다운로드 endpoint 변경: 1줄 코드, 5분 작업
  /files/:id/download → /files/:id/download/external (X-API-Key 헤더 추가)
- 상세 가이드: [첨부 문서 PHP_INTEGRATION_KICKOFF_2026-05-04.md]

**운영 준비 상태**
- API 운영 중: https://api.papascompany.co.kr/api
- Worker 합성 E2E 검증 완료 (2026-05-04)
- Sentry 모니터링 활성 (이슈 자동 추적)

**다음 단계**
킥오프 미팅 (30분) 일정 잡아 드리겠습니다.
가능한 날짜를 알려주시면 빠르게 진행하겠습니다.

감사합니다.
Storige 운영팀 드림
```

---

## 8. 참조 문서

| 문서 | 내용 |
|------|------|
| [SECURITY_PATCH_PHP_NOTICE_2026-05-03.md](SECURITY_PATCH_PHP_NOTICE_2026-05-03.md) | 보안 패치 상세 + PHP 코드 예시 |
| [PHP_INTEGRATION_VERIFICATION.md](PHP_INTEGRATION_VERIFICATION.md) | 13개 통합 체크리스트 |
| [SYSTEM_INTEGRATION_OVERVIEW.md](SYSTEM_INTEGRATION_OVERVIEW.md) | 전체 시스템 통합 구조 (v2.4) |
| [SYNTHESIS_E2E_REPORT_2026-05-04.md](SYNTHESIS_E2E_REPORT_2026-05-04.md) | Worker 합성 E2E 검증 결과 |
| https://api.papascompany.co.kr/api/docs | Swagger API 문서 (운영) |

---

## 9. 변경 이력

- **2026-05-04 v1** — 초안 작성. 작업 1 (결함 #12) + 작업 2 (합성 E2E) 완료 직후 킥오프 문서 생성.
