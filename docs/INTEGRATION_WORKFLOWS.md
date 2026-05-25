# Storige 플랫폼 연동 워크플로우 전체 정리

> 2026-05-25 기준. 기능별 / 사용 유형별 / 연동 방식별 워크플로우 정의.

---

## 1. 서비스 아키텍처 개요

### 1.1 3개 외부 서비스

| 서비스 | 상태 | 편집기 임베드 방식 | 합성 엔드포인트 |
|--------|------|-------------------|----------------|
| **북모아 PHP 쇼핑몰** | 대기 (PHP 개발자 담당) | IIFE 번들 마운트 | `/synthesize/external` |
| **bookmoa-mobile** | 운영 중 | iframe embed | `/compose-mixed` |
| **JumboCard** | 보류 | iframe embed (예정) | `/compose-mixed` (예정) |

### 1.2 공유 플랫폼 (Storige)

| 서비스 | 역할 | 호스팅 |
|--------|------|--------|
| **Editor** | Fabric.js 캔버스 편집기 | Vercel (`editor.papascompany.co.kr`) |
| **API** | NestJS REST API + 인증 + 세션 | VPS Docker (`api.papascompany.co.kr`) |
| **Worker** | PDF 검증/변환/합성 (Bull queue) | VPS Docker (내부 :4001) |
| **Admin** | 템플릿/상품 관리 | Vercel (`admin.papascompany.co.kr`) |

---

## 2. 사용 유형별 워크플로우

### 2.1 일반 책자 (포토북/양장본)

```
[고객] → bookmoa-mobile 상품 선택
  → 결제 → 편집기 iframe 오픈
    → mode: both, editorMode: book
    → 표지 + 내지 편집
  → editor.complete 이벤트
  → 자동 합성 트리거 (outputMode: separate)
    → cover.pdf + content.pdf (면지 포함) 생성
  → 웹훅 → 주문 상태 갱신
```

**합성 출력**: `cover.pdf` (표지) + `content.pdf` (앞면지 + 편집 내지 + 뒷면지)

### 2.2 레더커버 책자

```
[고객] → 레더커버 상품 선택
  → 결제 → 편집기 iframe 오픈
    → coverEditable: false, coverPreviewImage 표시
    → 내지만 편집
  → editor.complete 이벤트
  → 자동 합성 트리거 (outputMode: content-only)
    → content.pdf만 생성 (표지 PDF 없음)
  → 웹훅 → 주문 상태 갱신
```

**합성 출력**: `content.pdf`만 (앞면지 + 편집 내지 + 뒷면지). 표지는 물리 소재로 별도 제작.

### 2.3 낱장 상품 (카드/명함/엽서/포스터/리플렛)

```
[고객] → 낱장 상품 선택 (N장, 앞뒤 편집)
  → 결제 → 편집기 iframe 오픈
    → mode: both, editorMode: single
    → 앞면 + 뒷면 × N장 편집
  → editor.complete 이벤트
  → 자동 합성 트리거 (outputMode: single)
    → pages.pdf (전체 편집 페이지 합본)
  → 웹훅 → 주문 상태 갱신
```

**합성 출력**: `pages.pdf` (편집한 모든 페이지 순차 합본)

### 2.4 PHP 쇼핑몰 (북모아 기존)

```
[고객] → PHP 사이트에서 상품 선택
  → IIFE 번들로 편집기 로드
    → window.StorigeEditor.create(config).mount('editor-root')
    → 콜백 함수(onComplete)로 통신
  → PHP 서버에서 /synthesize/external 직접 호출
    → merged.pdf 생성
  → 웹훅 → PHP 서버 수신
```

**합성 출력**: `merged.pdf` (표지+내지 단순 합본). outputMode 개념 없음.

---

## 3. 인증 워크플로우

### 3.1 회원 인증 (JWT)

```
[외부 사이트] → POST /auth/shop-session (X-API-Key)
  → { memberSeqno, memberId, memberName }
  → Storige API가 JWT 발급 (1시간 유효)
  → 편집기 iframe URL에 token= 파라미터로 전달
```

### 3.2 게스트 인증

```
[비로그인 고객] → POST /edit-sessions/guest
  → guestToken 발급 (UUID, 24시간 유효)
  → sessionStorage에 저장
  → 편집 완료 시 editor.needAuth 이벤트
    → 로그인 유도 모달
    → 로그인 후 POST /edit-sessions/guest/migrate
    → guestToken 세션 → 회원 세션으로 전환
```

### 3.3 관리자 인증

```
[관리자] → Admin.jsx에서 StorigeEditorHost 열기
  → adminMember prop으로 관리자 정보 전달
  → POST /auth/shop-session (관리자 memberId)
  → 고객 세션의 templateSetId + orderSeqno로 편집
  → 저장 시 lastEditedBy: 'admin'
```

---

## 4. 합성 워크플로우

### 4.1 자동 합성 트리거 (bookmoa-mobile)

```
editor.complete 이벤트 수신
  ↓
재편집 감지 (status가 completed/validated/fixable이면 editVersion+1)
  ↓
storige 업데이트 (sessionId, fileIds, status='edited')
  ↓
POST /api/storige/synthesize (outputMode 자동 판별)
  ↓
  ├─ coverEditable=false → content-only
  ├─ leaflet + 면지 없음 → single
  └─ 그 외 → separate
  ↓
status = 'synthesizing', synthesisJobId 저장
  ↓
5초 간격 폴링 (/api/storige/job-status?jobId=X)
  ↓
완료/실패 시 status 갱신 + 폴링 중지
  (또는 웹훅이 먼저 도착하여 갱신)
```

### 4.2 관리자 재합성

```
관리자 주문 탭 → 주문 행 확장 → 아이템 상세
  ↓
  ├─ [재합성] 버튼 → POST /api/storige/synthesize (기존 fileIds)
  ├─ [편집 열기] 버튼 → StorigeEditorHost(admin 모드) → 저장 → 자동 합성
  └─ [파일 교체] 버튼 → PDF 업로드 → fileId 교체 → 자동 합성
  ↓
lastEditedBy = 'admin', editVersion+1
```

### 4.3 합성 모드 비교

| 모드 | 엔드포인트 | outputMode | 출력 | 사용처 |
|------|-----------|-----------|------|--------|
| Compose-Mixed | `/compose-mixed` | `separate` | cover.pdf + content.pdf | 일반 책자 |
| Compose-Mixed | `/compose-mixed` | `content-only` | content.pdf | 레더커버 |
| Compose-Mixed | `/compose-mixed` | `single` | pages.pdf | 낱장 상품 |
| Legacy Merge | `/synthesize/external` | - | merged.pdf | PHP 쇼핑몰 |
| Split | `/split-synthesize` | - | cover.pdf + content.pdf | 단일 PDF 분리 |
| Spread | `/synthesize` (mode=spread) | - | cover.pdf + content.pdf | book 모드 |

---

## 5. PDF 검증 워크플로우

```
파일 업로드 → POST /worker-jobs/validate/external
  ↓
Worker 검증 큐 처리
  ├─ 파일 형식/크기 검사
  ├─ 페이지 수/크기 검증
  ├─ DPI/색상 공간 분석 (Ghostscript)
  ├─ 재단선(bleed) 확인
  └─ 제본 호환성 검사
  ↓
  ├─ COMPLETED: 에러 0건 → 합성 가능
  ├─ FIXABLE: 자동 보정 가능 (빈 페이지 추가, 여백 확장 등)
  └─ FAILED: 보정 불가 → 재업로드 필요
  ↓
웹훅 → validation.completed/fixable/failed
```

---

## 6. 웹훅 워크플로우

### 6.1 Storige → bookmoa-mobile

```
Storige Worker 완료
  → POST {callbackUrl} (X-Storige-Signature 헤더)
  ↓
bookmoa-mobile /api/storige/webhook.js
  → 서명 검증 (Base64)
  → 주문 매칭 (sessionId/jobId/orderSeqno)
  → storige 상태 업데이트 (Supabase app_config)
  → outputFileUrl/outputFiles 저장
```

### 6.2 이벤트 → 상태 매핑

| 이벤트 | storige.status |
|--------|---------------|
| `validation.completed` | `validated` |
| `validation.fixable` | `fixable` |
| `validation.failed` | `failed` |
| `synthesis.completed` | `completed` |
| `synthesis.failed` | `failed` |

### 6.3 웹훅 응답 (outputMode별)

#### separate
```json
{ "outputFiles": [
    { "type": "cover", "url": "/storage/outputs/{jobId}/cover.pdf" },
    { "type": "content", "url": "/storage/outputs/{jobId}/content.pdf" }
  ], "outputMode": "separate" }
```

#### content-only
```json
{ "outputFiles": [
    { "type": "content", "url": "/storage/outputs/{jobId}/content.pdf" }
  ], "outputMode": "content-only" }
```

#### single
```json
{ "outputFiles": [
    { "type": "pages", "url": "/storage/outputs/{jobId}/pages.pdf" }
  ], "outputMode": "single" }
```

---

## 7. 관리자 워크플로우

### 7.1 템플릿 설정 (Storige Admin)

```
Admin → 카테고리 등록 (선택)
  → 템플릿 낱장 생성 (cover/page/spine/endpaper 등)
  → 템플릿셋 구성 (템플릿 조합 + 편집 설정)
    - editorMode: single/book
    - enabledMenus 화이트리스트
    - pageCountRange
    - endpaperConfig (면지)
    - coverEditable (레더커버)
  → 상품-템플릿셋 연결 (sortcode 매핑)
```

### 7.2 주문 관리 (bookmoa-mobile Admin)

```
Admin 주문 탭
  → Storige 상태 컬럼: worst-case 상태 배지
  → 재편집 배지: editVersion > 1 이면 주황색 표시
  → Storige 상태 필터 드롭다운
  → 주문 행 클릭 → 아이템별 상세 확장
    - 상태 배지 + editVersion + lastEditedBy
    - [재합성] [편집 열기] [파일 교체] 버튼
```

---

## 8. 상태 흐름 전체

```
edited → synthesizing → validated → completed
                      ↘ fixable
                      ↘ failed

재편집 시: completed/validated/fixable → edited (editVersion +1) → synthesizing → ...
```

---

## 9. 변경 이력

| 일시 | 변경 |
|------|------|
| 2026-05-25 | 초판 — 3개 서비스 연동 워크플로우 + outputMode 3종 + 관리자 워크플로우 통합 정리 |
