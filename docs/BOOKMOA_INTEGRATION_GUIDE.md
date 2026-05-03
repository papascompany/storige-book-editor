# bookmoa 연동 가이드

이 문서는 bookmoa PHP 쇼핑몰과 storige 에디터의 연동 방법을 설명합니다.

> ## ⚠️ 2026-05-03 보안 패치 적용 — PHP 팀 통보
>
> Storige API에 사용자 격리 권한 검증을 강화했습니다. **기존 PHP 코드는 그대로 작동**하지만 1가지 endpoint 변경 + 점진적 보강이 권장됩니다.
>
> **반드시 확인하세요**:
> - 🔴 [`SECURITY_PATCH_PHP_NOTICE_2026-05-03.md`](./SECURITY_PATCH_PHP_NOTICE_2026-05-03.md) — PHP 팀 전용 통보 문서
> - 🟡 [`PHP_INTEGRATION_VERIFICATION.md`](./PHP_INTEGRATION_VERIFICATION.md) §11 — 보안 패치 PHP 측 작업 가이드
> - 🟢 [`USER_IDENTITY_AUDIT_2026-05-03.md`](./USER_IDENTITY_AUDIT_2026-05-03.md) — 결함 분석 + 패치 상세
>
> **핵심 변경**: `/files/:id/download` (이전 Public) → `/files/:id/download/external` (X-API-Key 인증) 신규 endpoint 사용 권장.

## 1. 개요

storige 에디터는 JavaScript 번들로 빌드되어 bookmoa 페이지에 임베딩됩니다.

```
┌─────────────────────────────────────────────────────────────┐
│                    bookmoa (PHP)                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  1. Shop Session API 호출 (JWT 토큰 발급)               │  │
│  │  2. 에디터 페이지 렌더링 (edit.php)                      │  │
│  │  3. JS 번들 로드 및 초기화                               │  │
│  └───────────────────────────────────────────────────────┘  │
│                              ↓                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Storige Editor (JS Bundle)                │  │
│  │  - Edit Session 생성/조회                               │  │
│  │  - 캔버스 편집                                          │  │
│  │  - 저장 및 완료 처리                                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
              ↓                          ↓
     ┌───────────────┐          ┌───────────────┐
     │  Storige API  │          │  bookmoa DB   │
     │  (NestJS)     │          │  (MySQL)      │
     └───────────────┘          └───────────────┘
```

## 2. 환경 설정

### 2.1 storige API 환경변수

```bash
# .env
# API Key 인증 (bookmoa 서버에서 사용)
API_KEYS=your-secure-api-key-1,your-secure-api-key-2

# CORS 설정 (bookmoa 도메인 허용)
CORS_ORIGIN=https://your-bookmoa-domain.com,http://localhost:8080

# JWT 설정
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=1h
```

### 2.2 bookmoa 환경변수

Apache httpd.conf 또는 .htaccess:
```apache
SetEnv STORIGE_API_URL "https://your-storige-api.com/api"
SetEnv STORIGE_API_KEY "your-secure-api-key-1"
SetEnv STORIGE_EDITOR_BUNDLE_URL "https://cdn.your-domain.com/editor-bundle.iife.js"
SetEnv STORIGE_EDITOR_CSS_URL "https://cdn.your-domain.com/editor-bundle.css"
```

Nginx fastcgi_params:
```nginx
fastcgi_param STORIGE_API_URL "https://your-storige-api.com/api";
fastcgi_param STORIGE_API_KEY "your-secure-api-key-1";
fastcgi_param STORIGE_EDITOR_BUNDLE_URL "https://cdn.your-domain.com/editor-bundle.iife.js";
fastcgi_param STORIGE_EDITOR_CSS_URL "https://cdn.your-domain.com/editor-bundle.css";
```

## 3. 에디터 번들 빌드 및 배포

### 3.1 번들 빌드

```bash
cd storige
pnpm install
pnpm --filter @storige/editor build:embed:prod
```

빌드 결과:
- `apps/editor/dist-embed/editor-bundle.iife.js` - JS 번들 (~1.2MB gzip)
- `apps/editor/dist-embed/editor-bundle.css` - CSS 스타일 (~8KB gzip)

### 3.2 CDN 배포

번들 파일을 CDN이나 정적 파일 서버에 배포합니다:

```bash
# S3 예시
aws s3 cp apps/editor/dist-embed/editor-bundle.iife.js s3://your-cdn-bucket/storige/
aws s3 cp apps/editor/dist-embed/editor-bundle.css s3://your-cdn-bucket/storige/
```

## 4. bookmoa 파일 구조

```
bookmoa/front/storige/
├── edit.php                  # 에디터 임베딩 페이지
├── storige_common.php        # 공통 함수 라이브러리
├── test.php                  # 연동 테스트 페이지 (개발용)
├── ajax/
│   └── get_session_status.php    # 세션 상태 조회
└── proc/
    └── complete_edit.php     # 편집 완료 처리
```

## 5. 에디터 사용법

### 5.1 URL 파라미터

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| order_seqno | O | 주문 번호 |
| mode | O | 편집 모드 (cover, content, both) |
| template_set_id | O | 템플릿셋 ID |
| session_id | X | 기존 편집 세션 ID (재편집시) |
| cover_file_id | X | 표지 파일 ID |
| content_file_id | X | 내지 파일 ID |
| return_url | X | 편집 완료 후 리다이렉트 URL |
| pageCount | X | 내지 페이지 수 (예: `50`) |
| paperType | X | 용지 코드 (예: `mojo_80g`) |
| bindingType | X | 제본 코드 (예: `perfect`) |
| size | X | **(옵션 B)** product_sizes 의 sizeNo 인덱스 (예: `0`, `1`, `2`) |
| width | X | **(옵션 C)** 인쇄물 가로 (mm). `product.allowCustomSize=true` 일 때만 적용 |
| height | X | **(옵션 C)** 인쇄물 세로 (mm). `product.allowCustomSize=true` 일 때만 적용 |

### 5.1.1 인쇄물 사이즈 전달 — 3 가지 옵션

상품의 사이즈를 결정하는 방법은 다음 3가지 중 선택. 자세한 비교/PHP 예시: [`docs/BOOKMOA_INTEGRATION_DIFF.md`](./BOOKMOA_INTEGRATION_DIFF.md) §6.

| 옵션 | 사이즈 결정 | 사용 케이스 |
|---|---|---|
| **A** | `template_set_id` 가 사이즈를 보유 | 사이즈가 templateSet 별로 사전 등록 (기본) |
| **B** | `product_id + size` (sizeNo 인덱스) | 상품에 `product_sizes` 가 사전 등록되어 있고 폼에서 선택 |
| **C** | `product_id + width + height` (mm) | 자유 사이즈 입력 상품 — 관리자가 `allowCustomSize=true` 설정 필요 |

옵션 C 사용 시 **Storige Admin 의 상품 편집 폼**에서 "외부 쇼핑몰 사이즈 override 허용" Switch 를 활성화해야 합니다. 활성화 안 된 상품에는 width/height 가 무시됩니다 (보안: 임의 사이즈 강제 방지).

### 5.2 에디터 열기 예시

```php
<?php
require_once 'storige/storige_common.php';

// 에디터 URL 생성
$editorUrl = getEditorUrl(
    $orderSeqno,    // 주문 번호
    'both',         // 모드
    $templateSetId, // 템플릿셋 ID
    [
        'return_url' => '/mypage/order_detail.php',
    ]
);
?>
<a href="<?php echo htmlspecialchars($editorUrl); ?>">편집하기</a>
```

### 5.3 JavaScript API

```javascript
// 에디터 인스턴스 생성
const editor = window.StorigeEditor.create({
    mode: 'both',
    orderSeqno: 12345,
    templateSetId: 'ts-001',
    token: 'jwt-token',
    apiBaseUrl: 'https://api.example.com/api',

    onReady: function() {
        console.log('에디터 준비 완료');
    },
    onComplete: function(result) {
        console.log('편집 완료:', result);
        // result: { sessionId, orderSeqno, files, savedAt }
    },
    onSave: function(result) {
        console.log('저장 완료:', result);
    },
    onCancel: function() {
        console.log('편집 취소');
    },
    onError: function(error) {
        console.error('에러:', error);
        // error: { code, message }
        // code: AUTH_EXPIRED, NETWORK_ERROR, SAVE_FAILED, etc.
    }
});

// DOM에 마운트
editor.mount('editor-root');

// 메서드
editor.save();      // 저장
editor.complete();  // 완료
editor.cancel();    // 취소
editor.undo();      // 실행취소
editor.redo();      // 재실행
editor.getState();  // 상태 조회
editor.unmount();   // 언마운트
```

## 6. API 엔드포인트

### 6.1 인증

**Shop Session 생성** (bookmoa 서버 → storige API)
```
POST /api/auth/shop-session
Headers:
  X-API-Key: your-api-key

Body:
{
  "memberSeqno": 12345,
  "memberId": "user@example.com",
  "memberName": "홍길동"
}

Response:
{
  "success": true,
  "accessToken": "eyJhbG...",
  "expiresIn": 3600,
  "member": { "seqno": 12345, "id": "user@example.com", "name": "홍길동" }
}
```

### 6.2 Edit Sessions

**세션 생성**
```
POST /api/edit-sessions
Headers:
  Authorization: Bearer {accessToken}

Body:
{
  "orderSeqno": 99999,
  "mode": "both",
  "templateSetId": "ts-001"
}
```

**세션 조회**
```
GET /api/edit-sessions/{id}
```

**세션 업데이트**
```
PATCH /api/edit-sessions/{id}
Body: { "canvasData": {...}, "status": "editing" }
```

**세션 완료**
```
PATCH /api/edit-sessions/{id}/complete
```

## 7. 에러 코드

| 코드 | 설명 |
|------|------|
| AUTH_EXPIRED | JWT 토큰 만료 |
| NETWORK_ERROR | 네트워크 연결 오류 |
| SAVE_FAILED | 저장 실패 |
| INVALID_DATA | 잘못된 데이터 |
| SESSION_NOT_FOUND | 세션을 찾을 수 없음 |

## 8. 보안 고려사항

1. **API Key 관리**
   - API Key는 서버 사이드에서만 사용
   - 환경변수로 관리, 코드에 하드코딩 금지
   - 주기적으로 키 교체

2. **JWT 토큰**
   - 짧은 만료 시간 설정 (1시간 권장)
   - HttpOnly 쿠키 사용 권장

3. **CORS**
   - 허용된 도메인만 CORS_ORIGIN에 설정
   - 와일드카드(*) 사용 금지

4. **입력 검증**
   - 모든 파라미터 서버 사이드에서 검증
   - SQL Injection, XSS 방지

## 9. 문제 해결

### API 연결 실패
```bash
# 연결 테스트
curl -X GET "https://your-api.com/api/health"
```

### 인증 오류 (401)
- API_KEYS 환경변수 확인
- JWT_SECRET 일치 여부 확인

### CORS 오류
- CORS_ORIGIN에 bookmoa 도메인 추가
- 프로토콜(http/https) 포함 여부 확인

### 번들 로드 실패
- 브라우저 개발자 도구에서 네트워크 탭 확인
- STORIGE_EDITOR_BUNDLE_URL 경로 확인
- Content-Type 헤더 확인 (application/javascript)

## 10. 테스트

### 연동 테스트 스크립트
```bash
API_KEY=your-api-key ./scripts/test-bookmoa-integration.sh
```

### PHP 테스트 페이지
개발 환경에서 `/storige/test.php` 접속하여 연동 테스트 실행
