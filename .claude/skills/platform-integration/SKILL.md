---
name: platform-integration
description: Storige 플랫폼 외부 서비스 연동 작업 — 편집기 iframe/IIFE 임베드, shop-session JWT 인증, PDF 합성(compose-mixed outputMode), 웹훅, 게스트 마이그레이션, 관리자 주문 관리. bookmoa-mobile / PHP 쇼핑몰 / JumboCard 등 외부 서비스 어댑터를 만지거나, 합성 출력 규칙(separate/content-only/single)을 변경하는 모든 작업에서 사용.
---

# 플랫폼 연동 스킬

Storige 플랫폼과 외부 서비스 간 연동 작업의 가이드.

## 언제 사용

- 외부 서비스에서 편집기를 iframe 또는 IIFE로 임베드하는 코드
- `POST /auth/shop-session`, `POST /edit-sessions/guest`, JWT/guestToken 관련 작업
- `POST /worker-jobs/compose-mixed`, `POST /worker-jobs/synthesize/external` 합성 작업
- `outputMode` (separate/content-only/single) 변경 또는 새 출력 모드 추가
- 웹훅 핸들러 (`webhook.js`, `sendSynthesisCallback`) 수정
- `postMessage` 이벤트 (editor.ready/save/complete/cancel/error/needAuth) 처리
- 관리자 주문 관리 (재합성/편집열기/파일교체/재편집 감지)
- 트리거 키워드: "연동", "integration", "shop-session", "iframe", "IIFE", "embed", "compose-mixed", "outputMode", "separate", "content-only", "single", "webhook", "postMessage", "guestToken", "migrate", "재합성", "편집열기", "파일교체", "editVersion"

## 3개 외부 서비스 구분

| 서비스 | 임베드 방식 | 합성 엔드포인트 | 상태 |
|--------|-----------|----------------|------|
| **bookmoa-mobile** | iframe | `/compose-mixed` | 운영 중 |
| **북모아 PHP** | IIFE 번들 마운트 | `/synthesize/external` | 대기 (PHP 개발자) |
| **JumboCard** | iframe (예정) | `/compose-mixed` (예정) | 보류 |

PHP 쇼핑몰은 `bookmoa-mobile`과 코드 경로가 완전 분리됨. `synthesize.js`, `webhook.js` 등 bookmoa-mobile 어댑터 변경은 PHP에 영향 없음.

## 상품 유형별 합성 출력 규칙

### outputMode 3종 (compose-mixed 전용)

| outputMode | 출력 | 상품 | 자동 판별 |
|------------|------|------|-----------|
| `separate` | `cover.pdf` + `content.pdf` | 일반 책자 | 기본값 |
| `content-only` | `content.pdf`만 | 레더커버 | `coverEditable === false` |
| `single` | `pages.pdf` | 낱장(카드/명함/엽서) | `leaflet` + 면지 없음 |

### content.pdf 구성 규칙

```
content.pdf = [앞면지 N장] + [고객 편집 내지] + [뒷면지 K장]
```
- 면지 없으면 편집 내지만 포함
- 면지 URL이 null이면 빈 페이지로 생성
- 레더커버(content-only)도 동일 구조, 표지 PDF만 미생성

### 하위 호환

`outputMode` 미지정 시 기존 `merged.pdf` 동작 유지. PHP 쇼핑몰은 이 모드 사용하지 않음(`/synthesize/external` 별도 경로).

## 핵심 파일 매핑

### Storige (공유 플랫폼)

| 파일 | 역할 |
|------|------|
| `packages/types/src/index.ts` | `ComposeOutputMode` 타입 정의 |
| `apps/api/src/worker-jobs/dto/create-compose-mixed-job.dto.ts` | compose-mixed DTO (`outputMode` 필드) |
| `apps/api/src/worker-jobs/worker-jobs.service.ts` | `createComposeMixedJob()` — outputMode를 queue에 전달 |
| `apps/worker/src/processors/synthesis.processor.ts` | `handleComposeMixedSynthesis()` — outputMode별 분기 |
| `apps/api/src/auth/auth.service.ts` | `createShopSession()` — JWT 발급 |
| `apps/api/src/edit-sessions/` | 편집 세션 CRUD + 게스트 + migrate |
| `apps/editor/src/embed.tsx` | 편집기 임베드 진입점 + postMessage |

### bookmoa-mobile (어댑터)

| 파일 | 역할 |
|------|------|
| `src/components/StorigeEditorHost.jsx` | iframe 편집기 래퍼 (postMessage 6종 핸들링) |
| `src/pages/Orders.jsx` | 자동 합성 트리거 + 폴링 UI + 재편집 감지 |
| `src/admin/Admin.jsx` | 관리자 Storige 주문 관리 (재합성/편집/파일교체) |
| `api/storige/synthesize.js` | 합성 API 어댑터 (outputMode 자동 판별) |
| `api/storige/webhook.js` | 웹훅 수신 → Supabase 주문 갱신 |
| `api/storige/router.js` | migrate-guest / my-sessions / editor-config |
| `api/storige/shop-session.js` | shop-session JWT 프록시 |

## 인증 흐름

### iframe 방식 (bookmoa-mobile)

```
1. POST /api/storige/shop-session (서버 어댑터, X-API-Key)
2. Storige API → JWT 발급 (1시간)
3. iframe URL에 token= 파라미터 포함
4. 편집기가 token으로 API 인증
```

### IIFE 방식 (PHP 쇼핑몰)

```
1. PHP 서버 → POST /auth/shop-session (X-API-Key, 직접)
2. JWT를 StorigeEditor.create({ token }) 에 전달
3. 콜백 함수로 결과 수신 (postMessage 아님)
```

### 게스트 → 회원 전환

```
1. POST /edit-sessions/guest → guestToken 발급 (24시간)
2. 편집 완료 시 editor.needAuth 이벤트
3. 로그인 후 POST /edit-sessions/guest/migrate (Bearer JWT + guestToken)
```

## 재편집 감지 시스템

| 필드 | 설명 |
|------|------|
| `editVersion` | 편집 횟수 (재편집 시 +1) |
| `lastEditedAt` | 마지막 편집 시각 (ISO) |
| `lastEditedBy` | `customer` 또는 `admin` |

재편집 판정: `editVersion > 1 && status !== 'completed'` → 관리자 화면에 "재편집" 배지.

## 상태 흐름

```
edited → synthesizing → validated → completed
                      ↘ fixable
                      ↘ failed
재편집: completed → edited (editVersion+1) → synthesizing → ...
```

## 주의사항

- `outputMode`는 compose-mixed 전용. Legacy Merge/Split/Spread에는 적용 안 됨
- PHP 쇼핑몰은 compose-mixed를 사용하지 않음 → outputMode와 무관
- 면지 구성은 관리자가 TemplateSet 설정에서 결정 (endpaperConfig)
- `coverEditable=false`이면 자동으로 `content-only` 선택 (bookmoa-mobile 어댑터)
- 웹훅 `patchStorige()`는 `editVersion/lastEditedAt/lastEditedBy`를 preserve (spread로 병합)

## 관련 문서

- `docs/INTEGRATION_WORKFLOWS.md` — 전체 연동 워크플로우 정리
- `docs/STORIGE_SYNTHESIS_SPEC.md` (bookmoa-mobile) — 합성 규칙 명세
- `docs/PLATFORM_INTEGRATION_v1.md` — 외부 서비스 어댑터 구현 가이드
- `docs/PHP_INTEGRATION_FINAL_v3.md` — PHP 연동 가이드
- `.cursor/plans/RESUME_PROMPT_2026-05-20.md` — v1 Phase 1~8 핸드오프
