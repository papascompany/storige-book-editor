# Storige × Bookmoa 시스템 통합 문서

> **작성일**: 2026-05-02  
> **버전**: v2.0  
> **대상**: PHP 개발자, 운영자, 기술 검토자

---

## 목차

1. [시스템 구성도](#1-시스템-구성도)
2. [서비스 인프라 구성](#2-서비스-인프라-구성)
3. [Worker 데이터 플로우](#3-worker-데이터-플로우)
4. [Bookmoa PHP 연동안](#4-bookmoa-php-연동안)
5. [PDF 파일 검증 세부 항목](#5-pdf-파일-검증-세부-항목)
6. [환경 변수 레퍼런스](#6-환경-변수-레퍼런스)
7. [에러 코드 레퍼런스](#7-에러-코드-레퍼런스)

---

## 1. 시스템 구성도

### 1.1 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         외부 시스템 (bookmoa)                             │
│                                                                         │
│  ┌──────────────────┐          ┌──────────────────────────────────────┐ │
│  │  bookmoa Web     │          │         bookmoa 백엔드 (PHP)          │ │
│  │  (고객 브라우저)   │          │  - 주문 처리         - 파일 업로드    │ │
│  │                  │          │  - 에디터 토큰 발급   - 합성 요청     │ │
│  │  [에디터 번들 JS] │          │  - Webhook 수신      - DB 연동       │ │
│  └──────────────────┘          └──────────────────────────────────────┘ │
│           │                              │                               │
│           │ JS 번들 로드                  │ X-API-Key (서버 간)           │
└───────────┼──────────────────────────────┼───────────────────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Storige 인프라                                   │
│                                                                         │
│  ┌─────────────┐    ┌────────────────────────────────────────────────┐  │
│  │   Nginx     │    │             Storige API (NestJS :4000)         │  │
│  │  :80/:443   │───▶│                                                │  │
│  │  Reverse    │    │  ┌──────────┐ ┌──────────┐ ┌────────────────┐ │  │
│  │  Proxy      │    │  │ 인증 모듈 │ │ 파일 모듈 │ │  Worker Jobs   │ │  │
│  └─────────────┘    │  │ JWT/API  │ │ 업로드/   │ │  검증/합성/    │ │  │
│                     │  │ Key Guard│ │ 썸네일    │ │  변환 큐잉     │ │  │
│  ┌─────────────┐    │  └──────────┘ └──────────┘ └────────────────┘ │  │
│  │  Storige    │    │                                                │  │
│  │  Editor     │    │  ┌──────────┐ ┌──────────┐ ┌────────────────┐ │  │
│  │  :3000      │    │  │ Templates│ │ EditSess │ │  Webhook 서비스 │ │  │
│  │ (React App) │    │  │ 관리     │ │ 관리     │ │  콜백 발송     │ │  │
│  └─────────────┘    │  └──────────┘ └──────────┘ └────────────────┘ │  │
│                     └────────────────────────────────────────────────┘  │
│  ┌─────────────┐              │               │                         │
│  │  Storige    │              ▼               ▼                         │
│  │  Admin      │    ┌──────────────┐  ┌───────────────────┐            │
│  │  :3001      │    │   MariaDB    │  │     Redis         │            │
│  │ (React App) │    │   :3306      │  │     :6379         │            │
│  └─────────────┘    │  (메인 DB)   │  │  (Bull Queue)     │            │
│                     └──────────────┘  └───────────────────┘            │
│                                                │                        │
│                                                ▼                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  Storige Worker (NestJS :4001)                    │  │
│  │                                                                  │  │
│  │   ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │  │
│  │   │  검증 프로세서  │  │  합성 프로세서  │  │   변환 프로세서   │  │  │
│  │   │  pdf-validation│  │  pdf-synthesis │  │  pdf-conversion  │  │  │
│  │   │  (15단계)      │  │  (병합/분리)   │  │  (블리드 추가 등) │  │  │
│  │   └────────────────┘  └────────────────┘  └──────────────────┘  │  │
│  │                                                                  │  │
│  │   ┌────────────────┐  ┌────────────────┐                        │  │
│  │   │  pdf-lib       │  │  Ghostscript   │                        │  │
│  │   │  (PDF 파싱)    │  │  (CMYK 분석)   │                        │  │
│  │   └────────────────┘  └────────────────┘                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   공유 스토리지 볼륨 /app/storage                   │  │
│  │   uploads/   outputs/   thumbnails/   processed/                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 서비스별 역할 요약

| 서비스 | 포트 | 기술 스택 | 주요 역할 |
|--------|------|-----------|-----------|
| **Nginx** | 80/443 | Nginx 1.25 | 리버스 프록시, SSL 종료, 정적 파일 서빙 |
| **Storige API** | 4000 | NestJS + TypeORM | REST API, 인증, 파일 관리, 큐 등록 |
| **Storige Worker** | 4001 | NestJS + Bull | PDF 검증/합성/변환 비동기 처리 |
| **Storige Editor** | 3000 | React + Fabric.js | 캔버스 편집기 (JS 번들로도 배포) |
| **Storige Admin** | 3001 | React + Ant Design | 템플릿/리소스 관리 대시보드 |
| **MariaDB** | 3306 | MariaDB 11.2 | 메인 데이터베이스 |
| **Redis** | 6379 | Redis 7.2 | Bull Queue 백엔드, 세션 캐시 |

---

## 2. 서비스 인프라 구성

### 2.1 인증 방식 매트릭스

```
┌─────────────────────────────────────────────────────┐
│                  인증 방식 분류                        │
│                                                     │
│  고객 브라우저 (Editor)                              │
│  └── JWT Bearer Token                               │
│      - POST /auth/shop-session → JWT 발급            │
│      - 유효 시간: 1시간                               │
│                                                     │
│  Bookmoa PHP 서버 (Server-to-Server)                │
│  └── X-API-Key 헤더                                  │
│      - 환경변수 API_KEYS에 등록된 키                   │
│      - /external 접미사 엔드포인트에 사용              │
│      - 예: POST /worker-jobs/validate/external       │
│                                                     │
│  Worker → API 콜백                                   │
│  └── X-API-Key 헤더                                  │
│      - WORKER_API_KEY 환경변수                        │
│      - PATCH /worker-jobs/external/{id}/status       │
└─────────────────────────────────────────────────────┘
```

### 2.2 스토리지 경로 구조

```
/app/storage/                     ← 공유 Docker 볼륨
├── uploads/                      ← 업로드된 원본 PDF
│   └── {timestamp}_{uuid}.pdf
├── outputs/                      ← Worker 처리 결과물
│   └── {job-id}/
│       ├── merged.pdf            ← 합성된 최종 파일
│       ├── cover.pdf             ← 분리 출력 (표지)
│       └── content.pdf           ← 분리 출력 (내지)
├── thumbnails/                   ← PDF 썸네일
│   └── {filename}_p1_w200.png
└── processed/                    ← 변환 처리된 파일
```

---

## 3. Worker 데이터 플로우

### 3.1 PDF 검증 플로우 (파일 업로드 시)

```
[bookmoa PHP 서버]
        │
        │  ① POST /files/upload/external
        │     Headers: X-API-Key: {key}
        │     Body: multipart/form-data (PDF 파일)
        ▼
[Storige API]
        │  파일 저장: /app/storage/uploads/{uuid}.pdf
        │  DB 저장: files 테이블 (fileId 반환)
        │
        │  ② POST /worker-jobs/validate/external
        │     { fileId, fileType, orderOptions, callbackUrl? }
        ▼
[Bull Queue: pdf-validation]
        │  PENDING → worker 처리 대기
        │
        ▼
[Storige Worker]
        │  ③ 파일 읽기 (WORKER_STORAGE_PATH + filePath)
        │  ④ 15단계 PDF 검증 실행
        │
        │  ⑤ PATCH /worker-jobs/external/{id}/status
        │     { status: COMPLETED | FIXABLE | FAILED, result }
        ▼
[Storige API]
        │  DB 업데이트 (worker_jobs, file_edit_sessions)
        │
        │  ⑥ Webhook 발송 (callbackUrl 있을 때)
        │     POST {callbackUrl}
        │     { event: validation.completed | fixable | failed }
        ▼
[bookmoa PHP 서버]
        │  검증 결과 수신 및 주문 처리 결정
```

#### 3.1.1 검증 상태 전이

```
PENDING
   │
   │ Worker 처리 시작
   ▼
PROCESSING
   │
   ├─ 검증 통과 ──────────────────→ COMPLETED
   │                                (isValid: true)
   │
   ├─ 자동수정 가능 오류 발견 ────→ FIXABLE
   │  (allErrors.autoFixable = true)  (isValid: false, autoFixable: true)
   │
   └─ 수정 불가 오류 발견 ────────→ FAILED
      (수동 수정 필요)                (isValid: false)
```

### 3.2 PDF 합성 플로우 (주문 완료 시)

```
[bookmoa PHP 서버]
        │
        │  ① (선택) POST /worker-jobs/check-mergeable/external
        │     Dry-run: 합성 가능 여부 사전 확인
        │
        │  ② POST /worker-jobs/synthesize/external
        │     {
        │       coverFileId, contentFileId,
        │       spineWidth,     ← 책등 두께(mm) = 페이지수 × 종이두께
        │       orderId,        ← 북모아 주문 번호
        │       priority,       ← 'high' | 'normal' | 'low'
        │       callbackUrl,    ← Webhook 수신 URL
        │       outputFormat    ← 'merged' | 'separate'
        │     }
        ▼
[Bull Queue: pdf-synthesis]
        │  우선순위: high=1, normal=5, low=10
        │
        ▼
[Storige Worker: 합성 프로세서]
        │
        ├─ mode = 'normal'   → 표지 + 내지 PDF 병합
        ├─ mode = 'split'    → 단일 PDF에서 표지/내지 분리
        └─ mode = 'spread'   → 스프레드 PDF + 내지 PDF 병합
        │
        │  결과: /app/storage/outputs/{jobId}/
        │
        ▼
[Storige API Webhook]
        │
        │  POST {callbackUrl}
        │  Headers:
        │    X-Storige-Event: synthesis.completed
        │    X-Storige-Signature: base64({jobId}:{event}:{timestamp})
        │  Body:
        │  {
        │    "event": "synthesis.completed",
        │    "jobId": "...",
        │    "orderId": "ORD-12345",
        │    "status": "completed",
        │    "outputFileUrl": "/storage/outputs/{id}/merged.pdf",
        │    "outputFiles": [               ← separate 모드만
        │      { "type": "cover", "url": "..." },
        │      { "type": "content", "url": "..." }
        │    ]
        │  }
        ▼
[bookmoa PHP 서버]
        │  outputFileUrl로 완성 파일 다운로드
        │  주문 상태 업데이트
```

### 3.3 에디터 세션 플로우 (편집기 사용 시)

```
[bookmoa PHP (server-side)]
        │
        │  ① POST /auth/shop-session
        │     Headers: X-API-Key: {key}
        │     { orderSeqno, memberSeqno, templateSetId }
        │
        │  → JWT 토큰 수신 (유효 1시간)
        │
        ▼
[bookmoa PHP → edit.php 렌더링]
        │
        │  ② editor-bundle.iife.js 로드
        │  ③ window.StorigeEditor.init({
        │       token: '{JWT}',
        │       apiBaseUrl: 'https://storige-api.com/api',
        │       orderSeqno,
        │       templateSetId,
        │       mode: 'both' | 'cover' | 'content',
        │       callbackUrl
        │     })
        ▼
[Storige Editor (JS Bundle, 브라우저)]
        │
        │  ④ POST /edit-sessions
        │     → EditSession 생성 (세션 ID 수신)
        │
        │  ⑤ GET /template-sets/{id}
        │     → 템플릿 데이터 로드 (캔버스 초기화)
        │
        │  ⑥ 자동 저장 (30초 주기)
        │     PATCH /edit-sessions/{id}
        │
        │  ⑦ 편집 완료 클릭
        │     PATCH /edit-sessions/{id}/complete
        │     → onComplete({ sessionId, fileId }) 콜백
        ▼
[bookmoa PHP (callbackUrl)]
        │  → 세션/파일 ID 저장 → 주문 연결
```

---

## 4. Bookmoa PHP 연동안

### 4.1 연동 방식 비교

| 항목 | iframe 방식 | JS 번들 방식 (채택) |
|------|-------------|---------------------|
| 통신 | postMessage | 직접 함수 호출 |
| 격리 | 완전 분리 | 동일 DOM 컨텍스트 |
| 인증 | 별도 토큰 전달 | 쇼핑몰 세션 공유 가능 |
| 성능 | 별도 로딩 | 번들 단일 로딩 (~1.2MB gzip) |

### 4.2 PHP 측 파일 구조

```
bookmoa/front/storige/
├── edit.php                       ← 에디터 임베딩 페이지 (핵심)
├── storige_common.php             ← 공통 함수 라이브러리
│   ├── getShopSessionToken()      ← JWT 토큰 발급
│   ├── getEditorUrl()             ← 에디터 URL 생성
│   ├── requestValidation()        ← PDF 검증 요청
│   └── requestSynthesis()         ← PDF 합성 요청
├── test.php                       ← 연동 테스트 페이지 (개발용)
├── ajax/
│   └── get_session_status.php     ← 세션 상태 조회 (폴링용)
└── proc/
    ├── complete_edit.php          ← 편집 완료 처리
    ├── validation_callback.php    ← PDF 검증 Webhook 수신
    └── synthesis_callback.php     ← PDF 합성 Webhook 수신
```

### 4.3 환경변수 설정 (Apache/Nginx)

```apache
# Apache httpd.conf 또는 .htaccess
SetEnv STORIGE_API_URL      "https://storige.yourdomain.com/api"
SetEnv STORIGE_API_KEY      "your-secure-api-key-here"
SetEnv STORIGE_EDITOR_JS    "https://cdn.yourdomain.com/editor-bundle.iife.js"
SetEnv STORIGE_EDITOR_CSS   "https://cdn.yourdomain.com/editor-bundle.css"
```

### 4.4 PHP 측 필수 변경사항 (Breaking Changes)

> 원본 PHP 연동안 기준으로 **반드시** 수정해야 하는 항목

| # | 항목 | 원본 (구) | 현재 (신) | 심각도 |
|---|------|-----------|-----------|--------|
| 1 | 주문 식별자 파라미터 | `productId` | `orderSeqno` (주문번호) | 🔴 Breaking |
| 2 | 페이지수 파라미터 | `pages` | `pageCount` (내지 기준) | 🔴 Breaking |
| 3 | Worker 인증 방식 | JWT Bearer | `X-API-Key` 헤더 | 🔴 Breaking |
| 4 | 완료 콜백 파일 경로 | URL 직접 반환 | `fileId` (UUID) 반환 → API로 조회 | 🔴 Breaking |
| 5 | 날개 파라미터 | `wingFront`, `wingBack` | 제거 → `paperType` + `bindingType` 코드 | 🔴 Deprecated |
| 6 | PDF 검증 API | 없음 | `POST /worker-jobs/validate/external` | 🟡 신규 |
| 7 | PDF 합성 API | 없음 | `POST /worker-jobs/synthesize/external` | 🟡 신규 |
| 8 | 합성 Webhook | 없음 | `synthesis.completed` / `synthesis.failed` | 🟡 신규 |
| 9 | 검증 Webhook | 없음 | `validation.completed` / `validation.fixable` / `validation.failed` | 🟡 신규 |
| 10 | 편집 모드 | 없음 | `mode`: `both` / `cover` / `content` | 🟡 신규 |
| 11 | 완료 후 URL | 없음 | `returnUrl` 파라미터 | 🟡 신규 |
| 12 | API 주소 | 암묵적 (하드코딩) | `apiBaseUrl` 명시적 전달 필수 | 🟡 변경 |

### 4.5 인쇄물 사이즈 전달 — 3가지 방법

| 방법 | 파라미터 | 동작 방식 | 비고 |
|------|----------|-----------|------|
| **A. templateSet 기반** | `template_set_id` | 템플릿셋에 사이즈 사전 등록 | 기본 방법 |
| **B. sizeNo 인덱스** | `template_set_id` + `size=0` | 상품의 `product_sizes[0]` 적용 | 사이즈 옵션 상품 |
| **C. 직접 입력** | `width=148` + `height=210` (mm) | 관리자에서 `allowCustomSize=true` 필요 | 자유 사이즈 상품 |

### 4.6 API 호출 코드 예시 (PHP)

```php
<?php
define('STORIGE_API_URL', getenv('STORIGE_API_URL'));
define('STORIGE_API_KEY', getenv('STORIGE_API_KEY'));

// ───────────────────────────────────────────────────────────────────────
// ① 편집기용 JWT 토큰 발급
// ───────────────────────────────────────────────────────────────────────
function getShopSessionToken(int $orderSeqno, int $memberSeqno, string $templateSetId): string {
    $ch = curl_init(STORIGE_API_URL . '/auth/shop-session');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-API-Key: ' . STORIGE_API_KEY,
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'orderSeqno'    => $orderSeqno,
            'memberSeqno'   => $memberSeqno,
            'templateSetId' => $templateSetId,
        ]),
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res['token'] ?? '';
}

// ───────────────────────────────────────────────────────────────────────
// ② PDF 파일 업로드 (표지/내지)
// ───────────────────────────────────────────────────────────────────────
function uploadPdfFile(string $filePath, string $fileType, int $orderSeqno): array {
    $ch = curl_init(STORIGE_API_URL . '/files/upload/external');
    $cFile = new CURLFile($filePath, 'application/pdf', basename($filePath));
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['X-API-Key: ' . STORIGE_API_KEY],
        CURLOPT_POSTFIELDS => [
            'file'       => $cFile,
            'type'       => $fileType,  // 'cover' 또는 'content'
            'orderSeqno' => $orderSeqno,
        ],
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res; // { id, fileUrl, fileSize, ... }
}

// ───────────────────────────────────────────────────────────────────────
// ③ PDF 검증 요청
// ───────────────────────────────────────────────────────────────────────
function requestValidation(
    string $fileId,
    string $fileType,
    array  $orderOptions,
    string $callbackUrl = ''
): array {
    $body = [
        'fileId'       => $fileId,
        'fileType'     => $fileType,
        'orderOptions' => $orderOptions,
    ];
    if ($callbackUrl) {
        $body['callbackUrl'] = $callbackUrl;
    }
    $ch = curl_init(STORIGE_API_URL . '/worker-jobs/validate/external');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-API-Key: ' . STORIGE_API_KEY,
        ],
        CURLOPT_POSTFIELDS => json_encode($body),
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res; // { id: jobId, status: 'PENDING', ... }
}

// ───────────────────────────────────────────────────────────────────────
// ④ 작업 상태 폴링
// ───────────────────────────────────────────────────────────────────────
function getJobStatus(string $jobId): array {
    $ch = curl_init(STORIGE_API_URL . '/worker-jobs/external/' . $jobId);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['X-API-Key: ' . STORIGE_API_KEY],
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res; // { id, status: 'COMPLETED'|'FIXABLE'|'FAILED', result }
}

// ───────────────────────────────────────────────────────────────────────
// ⑤ PDF 합성 요청 (주문 완료 시점)
// ───────────────────────────────────────────────────────────────────────
function requestSynthesis(
    string $coverFileId,
    string $contentFileId,
    float  $spineWidth,
    string $orderId,
    string $callbackUrl
): array {
    $ch = curl_init(STORIGE_API_URL . '/worker-jobs/synthesize/external');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-API-Key: ' . STORIGE_API_KEY,
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'coverFileId'   => $coverFileId,
            'contentFileId' => $contentFileId,
            'spineWidth'    => $spineWidth,
            'orderId'       => $orderId,
            'priority'      => 'high',
            'callbackUrl'   => $callbackUrl,
            'outputFormat'  => 'merged',
        ]),
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res; // { id: jobId, status: 'PENDING' }
}

// ───────────────────────────────────────────────────────────────────────
// ⑥ Webhook 수신 처리 (validation_callback.php)
// ───────────────────────────────────────────────────────────────────────
function handleValidationWebhook(): void {
    $payload = json_decode(file_get_contents('php://input'), true);
    $event   = $payload['event'] ?? '';
    $jobId   = $payload['jobId'] ?? '';
    $status  = $payload['status'] ?? '';

    switch ($event) {
        case 'validation.completed':
            // 검증 통과 → 주문 진행 허용
            updateOrderValidationStatus($jobId, 'PASS');
            break;
        case 'validation.fixable':
            // 자동수정 가능 → 수정 후 진행
            $errors = $payload['result']['errors'] ?? [];
            updateOrderValidationStatus($jobId, 'FIXABLE', $errors);
            break;
        case 'validation.failed':
            // 검증 실패 → 고객에게 재업로드 요청
            $errorMsg = $payload['errorMessage'] ?? '파일 오류';
            notifyCustomerValidationFailed($jobId, $errorMsg);
            break;
    }
    http_response_code(200);
    echo json_encode(['received' => true]);
}
```

### 4.7 edit.php 핵심 구조

```php
<?php
session_start();
$token         = getShopSessionToken($orderSeqno, $memberSeqno, $templateSetId);
$editorBundleJs  = getenv('STORIGE_EDITOR_JS');
$editorBundleCss = getenv('STORIGE_EDITOR_CSS');
$apiBaseUrl    = getenv('STORIGE_API_URL');
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <link rel="stylesheet" href="<?= $editorBundleCss ?>">
</head>
<body>
    <div id="storige-editor"></div>
    <script src="<?= $editorBundleJs ?>"></script>
    <script>
        window.StorigeEditor.init({
            container  : '#storige-editor',
            apiBaseUrl : '<?= $apiBaseUrl ?>',
            token      : '<?= $token ?>',
            orderSeqno : <?= intval($orderSeqno) ?>,
            templateSetId: '<?= htmlspecialchars($templateSetId) ?>',
            mode       : '<?= $mode ?>',          // 'both'|'cover'|'content'
            pageCount  : <?= intval($pageCount) ?>,
            paperType  : '<?= $paperType ?>',
            bindingType: '<?= $bindingType ?>',
            returnUrl  : '<?= htmlspecialchars($returnUrl) ?>',
            onComplete : function(result) {
                // result.sessionId, result.coverFileId, result.contentFileId
                fetch('/storige/proc/complete_edit.php', {
                    method : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body   : JSON.stringify(result),
                });
            }
        });
    </script>
</body>
</html>
```

---

## 5. PDF 파일 검증 세부 항목

### 5.1 검증 파이프라인 (15단계)

```
PDF 파일 수신
      │
 Step 1: 파일 다운로드/읽기
      │
 Step 2: 파일 크기 검증 (100MB 초과 → 즉시 FAILED)
      │
 Step 3: PDF 무결성 검증 (pdf-lib 로드)
      │
 Step 4: 메타데이터 추출 (페이지수, 크기 mm 변환)
      │
 Step 5: 페이지 수 검증 (제본 방식별 규칙)
      │
 Step 6: 페이지 크기 검증 (±1mm 허용 오차)
      │
 Step 7: 재단 여백(블리드) 검증 (3mm 기준)
      │
 Step 8: 책등 크기 검증 (표지 파일만, cover 타입)
      │
 Step 9: 가로형 페이지 감지
      │
 Step 10: 사철 제본 규칙 검증 (saddle 바인딩 시)
      │
 Step 11: 스프레드(펼침면) 감지 (점수 기반)
      │
 Step 12: CMYK 2단계 검증
      │    ├─ 1단계: PDF 구조 스캔 (빠름)
      │    └─ 2단계: Ghostscript inkcov (정확함, 타임아웃 5초)
      │
 Step 13: 별색(Spot Color) 감지 (PDF 바이너리 파싱)
      │
 Step 14: 투명도/오버프린트 감지 (ExtGState 분석)
      │
 Step 15: 이미지 해상도 감지 (XObject 분석, Effective DPI)
      │
최종 결과 반환: { isValid, errors[], warnings[], metadata }
```

### 5.2 에러 코드 (접수 차단)

| 코드 | 한국어 설명 | 원인 | 자동수정 |
|------|------------|------|---------|
| `FILE_TOO_LARGE` | 파일 크기 초과 (100MB) | 고해상도 이미지 과다 | ❌ |
| `FILE_CORRUPTED` | 손상된 PDF | 업로드 중단, 잘못된 PDF 구조 | ❌ |
| `UNSUPPORTED_FORMAT` | PDF가 아닌 파일 | 확장자만 .pdf인 다른 형식 | ❌ |
| `PAGE_COUNT_INVALID` | 페이지 수 오류 | 표지: 1/2/4 외, 내지: 제본 규칙 위반 | ✅ (빈 페이지 추가) |
| `PAGE_COUNT_EXCEEDED` | 페이지 수 초과 | 사철 64페이지 초과 | ❌ |
| `SIZE_MISMATCH` | 페이지 크기 불일치 | 주문 규격과 PDF 크기 다름 (±1mm 초과) | ✅ (패딩으로 조정) |
| `SPINE_SIZE_MISMATCH` | 책등 크기 불일치 | 표지 너비가 계산값과 다름 | ✅ (자동 조정) |
| `SADDLE_STITCH_INVALID` | 사철 규격 오류 | 페이지 수가 4의 배수 아님 | ❌ |
| `POST_PROCESS_CMYK` | 후가공 파일 CMYK 사용 | 후가공 파일에 프로세스 컬러 | ❌ |
| `SPREAD_SIZE_MISMATCH` | 스프레드 크기 불일치 | 펼침면 크기가 맞지 않음 | ❌ |

### 5.3 경고 코드 (접수 허용, 고객 안내)

| 코드 | 한국어 설명 | 영향 | 권장 조치 |
|------|------------|------|----------|
| `BLEED_MISSING` | 재단 여백 없음 | 재단 시 내용 잘릴 수 있음 | 3mm 여백 추가 |
| `RESOLUTION_LOW` | 이미지 해상도 낮음 (150DPI 미만) | 인쇄 흐림 | 300DPI 이상 이미지 교체 |
| `PAGE_COUNT_MISMATCH` | 주문 페이지수와 다름 | 추가 비용 발생 가능 | 고객 확인 |
| `LANDSCAPE_PAGE` | 가로형 페이지 포함 | 의도하지 않은 회전 | 의도 여부 확인 |
| `CENTER_OBJECT_CHECK` | 접지 부분 객체 있음 | 사철 제본 시 중앙 잘림 | 배치 확인 |
| `CMYK_STRUCTURE_DETECTED` | CMYK 색상 감지 | 화면색과 인쇄색 차이 가능 | RGB 변환 검토 |
| `TRANSPARENCY_DETECTED` | 투명도 효과 포함 | 인쇄 시 예상과 다를 수 있음 | Flatten 권장 |
| `OVERPRINT_DETECTED` | 오버프린트 설정 | 색상 혼합 가능 | 인쇄 결과 확인 |
| `MIXED_PDF` | 표지/내지 혼합 PDF | 분리 처리 필요 | 분리 업로드 권장 |

### 5.4 제본 방식별 검증 규칙

| 제본 방식 | 표지 페이지 수 | 내지 페이지 수 | 책등 | 최대 페이지 |
|-----------|--------------|--------------|------|------------|
| **무선 제본** (perfect) | 1 또는 4 (펼침) | 4의 배수 필수 | ✅ 필수 | 제한 없음 |
| **사철 제본** (saddle) | 1 또는 4 (펼침) | 4의 배수 필수 | ❌ 없음 | 64페이지 |
| **스프링 제본** (spring) | 1 | 제한 없음 | ❌ 없음 | 제한 없음 |

### 5.5 페이지 크기 검증 상세

```
주문 규격: width × height (mm)
블리드: bleed (mm, 기본 3mm)

검증 케이스:
  ① 블리드 포함 크기  = (width + bleed×2) × (height + bleed×2)
  ② 블리드 미포함 크기 = width × height

허용 오차: ±1mm

판정:
  - ① 일치 → 정상 (블리드 있음)
  - ② 일치 → BLEED_MISSING 경고 (블리드 없음)
  - 둘 다 불일치 → SIZE_MISMATCH 에러
```

### 5.6 책등(Spine) 크기 계산

```
책등 너비(mm) = 내지 페이지 수 × 종이 두께(mm/장)

표지 전체 너비 = 뒷표지 + 책등 + 앞표지
             = width + spineWidth + width

검증: |실제 PDF 너비 - 계산된 전체 너비| ≤ 1mm
```

### 5.7 CMYK 2단계 검증 상세

```
1단계: PDF 구조 스캔 (pdf-lib, 빠름)
  ↓
  /DeviceCMYK 또는 /ICCBased /N 4 존재?
  ├─ NO  → RGB 확정 (GS 생략)
  └─ YES → 2단계 진행
  ↓
2단계: Ghostscript inkcov 분석 (정확함)
  ↓
  페이지별 C, M, Y, K 잉크 커버리지 측정
  ↓
  CMY 중 하나라도 > 0.001?
  ├─ YES → CMYK 사용 확정 → 경고 또는 에러
  └─ NO  → K만 사용 (흑백) 또는 RGB 확정

타임아웃: 5초 (초과 시 구조 기반 추정으로 폴백)
최대 분석 페이지: 50페이지
```

### 5.8 이미지 해상도 계산 방식

```
Effective DPI = (이미지 픽셀 수 × 25.4) / 표시 크기(mm)

예시 A: 300 DPI (인쇄 권장)
  - 이미지: 2480 × 3508 픽셀
  - 표시: A4 (210 × 297mm)
  - Effective DPI: (2480 × 25.4) / 210 ≈ 300 DPI ✅

예시 B: 97 DPI (경고 발생)
  - 이미지: 800 × 600 픽셀
  - 표시: A4 (210 × 297mm)
  - Effective DPI: (800 × 25.4) / 210 ≈ 97 DPI ❌ RESOLUTION_LOW

해상도 기준:
  300+ DPI → 최상 (인쇄 권장)
  150~299 DPI → 양호 (경고 없음)
  72~149 DPI → RESOLUTION_LOW 경고
  72 미만 DPI → RESOLUTION_LOW 경고 (교체 권장)
```

### 5.9 스프레드(펼침면) 감지 기준

| 조건 | 점수 |
|------|------|
| 페이지 너비 = 단면 너비 × 2 (±1mm) | +60점 |
| 페이지 높이 일치 (±1mm) | +20점 |
| 가로/세로 비율 > 1.25 | +15점 |
| 전 페이지 크기 일관성 (표준편차 < 1mm) | +10점 |

- **70점 이상** → 스프레드로 판정
- **신뢰도**: 80점↑ = high / 60~79 = medium / 그 외 = low

---

## 6. 환경 변수 레퍼런스

### 6.1 Storige API (.env)

| 변수명 | 기본값 | 필수 | 설명 |
|--------|--------|------|------|
| `NODE_ENV` | development | ✅ | 실행 환경 |
| `PORT` | 4000 | | API 포트 |
| `JWT_SECRET` | - | ✅ | JWT 서명 키 (32자 이상) |
| `JWT_EXPIRES_IN` | 1h | | JWT 유효 시간 |
| `API_KEYS` | - | ✅ | 외부 API Key 목록 (쉼표 구분) |
| `DATABASE_HOST` | localhost | ✅ | MariaDB 호스트 |
| `DATABASE_PASSWORD` | - | ✅ | DB 패스워드 |
| `REDIS_HOST` | localhost | ✅ | Redis 호스트 |
| `CORS_ORIGIN` | * | ✅ | 허용 도메인 |
| `UPLOAD_PATH` | ./storage/uploads | | 업로드 경로 |

### 6.2 Storige Worker (.env)

| 변수명 | 기본값 | 필수 | 설명 |
|--------|--------|------|------|
| `API_BASE_URL` | http://localhost:4000/api | ✅ | API 서버 주소 |
| `WORKER_API_KEY` | test-api-key | ✅ | Worker→API 인증 키 |
| `WORKER_STORAGE_PATH` | /app | ✅ | 스토리지 루트 경로 |
| `GHOSTSCRIPT_PATH` | gs | | Ghostscript 실행 경로 |
| `REDIS_HOST` | localhost | ✅ | Redis 호스트 |
| `GS_TIMEOUT` | 5000 | | Ghostscript 타임아웃(ms) |
| `GS_MAX_PAGES` | 50 | | inkcov 최대 분석 페이지 |

---

## 7. 에러 코드 레퍼런스

### 7.1 HTTP 에러 응답 형식

```json
{
  "code": "FILE_TOO_LARGE",
  "message": "파일 크기가 100MB를 초과합니다.",
  "details": {
    "size": 157286400,
    "maxSize": 104857600
  }
}
```

### 7.2 Webhook 페이로드 형식

```json
// validation.completed
{
  "event": "validation.completed",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "fileType": "cover",
  "orderSeqno": 12345,
  "status": "completed",
  "result": {
    "isValid": true,
    "errors": [],
    "warnings": [
      { "code": "BLEED_MISSING", "message": "재단 여백이 없습니다." }
    ],
    "metadata": {
      "pageCount": 4,
      "pageSize": { "width": 216, "height": 303 },
      "colorMode": "RGB",
      "resolution": 300
    }
  },
  "timestamp": "2026-05-02T10:30:00.000Z"
}

// synthesis.completed
{
  "event": "synthesis.completed",
  "jobId": "550e8400-e29b-41d4-a716-446655440001",
  "orderId": "ORD-2026-12345",
  "status": "completed",
  "outputFileUrl": "/storage/outputs/550e.../merged.pdf",
  "timestamp": "2026-05-02T10:35:00.000Z"
}
```

---

> 이 문서는 `/Users/yohan/claude/Bookmoa Storige editor/storige/docs/SYSTEM_INTEGRATION_OVERVIEW.md`에 저장되었습니다.  
> 최신 API 스펙은 Storige API Swagger 문서 (`http://localhost:4000/api/docs`)를 참조하세요.
