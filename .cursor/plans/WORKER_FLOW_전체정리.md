# Worker·PDF 파일 처리 전 구간 정리 (WORKER_FLOW)

> 📌 **전체 진입점은 [`00_MASTER_DEVELOPMENT_GUIDE.md`](./00_MASTER_DEVELOPMENT_GUIDE.md) §4.4**. 이 문서는 거기서 가리키는 **워커/PDF 파이프라인 상세 참조**입니다.
>
> **이 문서의 목적**: "북모아 쇼핑몰에서 PDF 첨부 → 주문 → Storige Worker 검증/변환/합성 → 사용자 피드백 → 결과 저장 → 관리자 파일 다운로드" 까지의 **전체 플로우 한 장에 조망**.
>
> 여러 기존 문서(`worker-ux-plan.md`, `PDF_VALIDATION_*`, `PDF분리_상세설계서_v1.1.4`, `BOOKMOA_INTEGRATION_GUIDE`)에 **파편화**되어 있는 내용을 실제 코드(`apps/worker`, `apps/api/worker-jobs`, `apps/api/webhook`, `apps/admin/pages/WorkerJobs`) 기준으로 **정합성 검증**한 뒤 하나로 묶은 것입니다.
>
> 작성 근거: 실제 소스 스캔(2026-04-16). 코드 위치는 본문에 `file:line` 형식으로 명시.
>
> 대상 독자: 인수자(도메인 지식 0 가정), 프론트/쇼핑몰/DBA 담당자.

---

## 0. 한 장 요약 — 전체 흐름

```
[ 쇼핑몰(북모아 PHP) ]              [ Storige API ]              [ Worker ]              [ Storage(공유 볼륨) ]
        │                                   │                         │                           │
① 파일 업로드 (multipart) ──POST /files/upload──▶│                         │                           │
                                            │── 저장 ─────────────────────────────────────────────▶│
                                            │◀─ fileId, fileUrl                                    │
② fileId를 주문DB에 저장                   │                         │                           │
                                            │                         │                           │
③ 주문 옵션과 함께 검증 요청               │                         │                           │
   POST /worker-jobs/validate/external ────▶│── Queue(Redis) ────────▶│                           │
   (X-API-Key)                              │                         │── 파일 읽기 ─────────────▶│
                                            │                         │── pdf-lib / Ghostscript    │
                                            │                         │    검증 실행               │
④ (방식 A) 2~3초 폴링                       │                         │── 결과 PATCH ────────────▶│
   GET /worker-jobs/external/:id ──────────▶│                         │                           │
   ◀── status, result ─────────────────────│                         │                           │
                                            │                         │                           │
   (방식 B) 웹훅 수신                        │                         │                           │
   POST callbackUrl ◀────────────────── webhook.sendCallback ────────│                           │
                                            │                         │                           │
⑤ 결과 분기                                 │                         │                           │
   ·isValid=true  → 주문 진행               │                         │                           │
   ·errors 자동수정가능 → /convert 요청      │                         │                           │
   ·errors 수정불가   → 재업로드 or 에디터    │                         │                           │
                                            │                         │                           │
⑥ (책/책자 주문 시) 병합/분리 합성 요청       │                         │                           │
   POST /worker-jobs/synthesize/external ──▶│── Queue ───────────────▶│── 표지+내지 merge          │
   (또는 /split-synthesize/external)        │                         │   또는 spread split 처리   │
                                            │                         │── 결과 PDF 저장 ──────────▶│ /storage/outputs/:id/*.pdf
                                            │                         │── 결과 PATCH ────────────▶│
                                            │                         │                           │
⑦ 관리자 콘솔                              │                         │                           │
   GET /worker-jobs (Admin 인증)   ─────────▶│                         │                           │
   ◀── 입력URL·출력URL 포함 목록 ─────────│                         │                           │
   [파일 보기] 링크 클릭 → resolveStorageUrl() 로 API 원본 프록시 다운로드                         │
```

※ 전체 단계 ①~⑦의 어디에 어느 코드가 매핑되는지는 §2~§7 에서 파일·라인 단위로 다시 연결합니다.

---

## 1. 시스템 역할 분리 — "누가 무엇을 책임지나"

`docs/worker-ux-plan.md §6-2`의 원칙을 코드 상태로 다시 정리:

| 시스템 | 담당 | 소유 상태 | 핵심 테이블/자원 |
|---|---|---|---|
| **북모아 쇼핑몰 (PHP)** | 주문 라이프사이클 전체 | 주문상태 (12단계 `110`…`021`) | 자체 DB `order_common`, `member`, `cate` |
| **Storige API** (`apps/api`) | 파일 저장, 편집 세션, Job 생성/상태 중계, 웹훅 송신 | 편집상태 `draft`/`complete`, Job ID | `files`, `edit_sessions`, `file_edit_sessions`, `worker_jobs` |
| **Storige Worker** (`apps/worker`) | PDF 검증 / 변환 / 합성 / 분리 | Job 상태 `PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`/`FIXABLE` | 직접 DB 쓰기 없음. API PATCH로만 전파 |
| **공유 Storage** | 실제 파일 바이너리 저장 | `/storage/uploads/*`, `/storage/outputs/:jobId/*`, `/storage/temp/*` | Docker volume |
| **관리자 콘솔** (`apps/admin`) | Job 모니터링·재시도·결과 PDF 다운로드 | 읽기 전용 | `/api/worker-jobs` |

### 1-1. 핵심 원칙 (어길 경우 버그의 근원)
1. **주문상태는 북모아만 변경**. Storige는 절대 주문 상태를 건드리지 않음.
2. **파일 저장은 Storige만**. 북모아는 fileId(UUID)만 보관.
3. **Worker는 DB에 직접 안 씀**. 반드시 `PATCH /api/worker-jobs/:id/status`로 API 경유.
4. **Storage 디렉터리는 북모아와 Storige가 같은 볼륨 공유**. 즉 "같은 서버·같은 디스크" 전제.

---

## 2. Worker 기능 정의 (processors 3종)

코드 위치: `apps/worker/src/processors/*.ts` — 총 **3개 Bull 큐**를 처리.

### 2-1. Validation (검증)
- **큐 이름**: `pdf-validation`
- **Job 핸들러**: `@Process('validate-pdf')` in `apps/worker/src/processors/validation.processor.ts:36`
- **목적**: 고객이 올린 PDF가 주문 옵션(크기·페이지수·제본·재단여백)과 맞는지 체크하고 피드백 객체 생성.
- **입력**(ValidationJobData):
  ```ts
  { jobId, fileUrl, fileId?, fileType:'cover'|'content',
    orderOptions:{ size:{width,height}, pages, binding:'perfect'|'saddle'|'spring',
                   bleed, paperThickness? } }
  ```
- **출력**: `ValidationResultDto` (isValid, errors[], warnings[], metadata)
- **결과 상태 전이** (`validation.processor.ts:56~75`):
  - 에러 0 → `COMPLETED`
  - 에러 있음 + 전부 autoFixable → `FIXABLE`
  - 에러 있음 + 하나라도 수정 불가 → `FAILED`

### 2-2. Conversion (자동 변환)
- **큐 이름**: `pdf-conversion`
- **Job 핸들러**: `apps/worker/src/processors/conversion.processor.ts:33`
- **목적**: 검증에서 `FIXABLE`로 잡힌 파일을 자동 교정 (빈페이지 추가 / bleed 연장 / 사이즈 리샘플 등).
- **입력**: `{ jobId, fileUrl, convertOptions:{ addPages, applyBleed, targetPages, bleed, targetSize? } }`
- **결과물 저장 위치**: `${STORAGE_PATH}/converted_<uuid>.pdf`
- **결과 URL 형식**: `/storage/temp/converted_<uuid>.pdf` (conversion.processor.ts:53)
- **후속**: 사용자가 Before/After 컨펌 → 승인 시 이 변환본으로 주문 진행.

### 2-3. Synthesis (합성/분리) — 3가지 모드
- **큐 이름**: `pdf-synthesis`
- **Job 핸들러**: `apps/worker/src/processors/synthesis.processor.ts:65`
- **mode 분기** (synthesis.processor.ts:66~78, 단일 진실 공급원: Queue payload의 `mode`):
  | mode | 설명 | 쓰는 상황 |
  |---|---|---|
  | `undefined`/`merge` | 표지PDF + 내지PDF → 1개 merged.pdf | 일반 주문, 납품용 단일 PDF |
  | `split` | 단일 PDF를 표지/내지로 분리 (v1.1.4 설계서) | 합본 업로드 고객 대응 |
  | `spread` | 스프레드(펼침) 편집 결과를 인쇄용으로 분리 (2026-02-06 설계) | 에디터 spread 모드 완료 |
- **결과물 저장 위치**: `${OUTPUTS_PATH}/<jobId>/*.pdf` (기본 `/app/storage/outputs/<jobId>/`)
- **outputFormat**:
  - `merged` (기본) — `outputFileUrl`만 반환
  - `separate` — `outputFiles: [{type:'cover',url},{type:'content',url}]` 추가 반환

### 2-4. 상태 전이 공통
모든 processor는 `updateJobStatus()` 헬퍼로 API PATCH. 헤더는 공통으로 `X-API-Key: ${WORKER_API_KEY}` 를 첨부하나, **호출 URL이 프로세서마다 다릅니다**.

| 프로세서 | 실제 호출 URL (소스 기준) | 서버 가드 | 실제 동작 |
|---|---|---|---|
| `ValidationProcessor` | `/worker-jobs/external/:id/status` (validation.processor.ts:119) | `@Public() + ApiKeyGuard` (controller:237~244) | ✅ 성공 |
| `ConversionProcessor` | `/worker-jobs/:id/status` (conversion.processor.ts:102) | 전역 `JwtAuthGuard` (auth.module.ts:42) | ❌ 401 위험 |
| `SynthesisProcessor` | `/worker-jobs/:id/status` (synthesis.processor.ts:854) | 동상 | ❌ 401 위험 |

→ Conversion/Synthesis 상태 PATCH는 현재 **운영에서 조용히 실패할 수 있습니다**. `WORKER_API_KEY`를 설정해도 JWT 게이트를 뚫지 못합니다. HANDOFF_GUIDE §8.2 참고.

```
PENDING ─▶ PROCESSING ─▶ COMPLETED
                     └─▶ FAILED
                     └─▶ FIXABLE  (validation 전용)
```

---

## 3. Validation 체크 로직 — 실제 검증 항목

코드: `apps/worker/src/services/pdf-validator.service.ts` (877 lines), DTO: `apps/worker/src/dto/validation-result.dto.ts`.

### 3-1. ErrorCode (10개) — 주문 진행 불가 또는 자동 수정 가능
> 소스 확정: `apps/worker/src/dto/validation-result.dto.ts:6~27` — 열거형 값 10개, 오타·중복 없음.
| 코드 | 메시지 | autoFixable | 수정 방법 |
|---|---|---|---|
| `UNSUPPORTED_FORMAT` | 지원하지 않는 파일 형식 | ❌ | 재업로드 |
| `FILE_CORRUPTED` | 파일 손상 | ❌ | 재업로드 |
| `FILE_TOO_LARGE` | 파일 크기 초과 | ❌ | 용량 축소 후 재업로드 |
| `PAGE_COUNT_INVALID` | 제본 방식에 맞지 않는 페이지수 | ⚠️ | `addBlankPages` |
| `PAGE_COUNT_EXCEEDED` | 페이지 수 초과 | ❌ | 분책 or 축소 |
| `SIZE_MISMATCH` | 페이지 크기 불일치 | ⚠️ | `resizeWithPadding` |
| `SPINE_SIZE_MISMATCH` | 책등(세네카) 크기 불일치 | ⚠️ | `adjustSpine` |
| `SADDLE_STITCH_INVALID` | 사철제본 4배수 위반 | ⚠️ | `addBlankPages` |
| `POST_PROCESS_CMYK` | 후가공 파일에 CMYK 사용 | ❌ | 고객 수정 필요 |
| `SPREAD_SIZE_MISMATCH` | 스프레드 사이즈 불일치 | ❌ | 에디터 재작업 |

### 3-2. WarningCode (9개) — 주문은 가능하나 품질 주의
> 소스 확정: `apps/worker/src/dto/validation-result.dto.ts:33~52` — 열거형 값 9개.
| 코드 | 설명 | UI 표시 |
|---|---|---|
| `PAGE_COUNT_MISMATCH` | 주문 수량과 실제 수량 다름 | ⚠️ 배지 |
| `BLEED_MISSING` | 재단여백 없음 | ⚠️ 배지 |
| `RESOLUTION_LOW` | 해상도 낮음 (<300dpi) | ⚠️ 배지 |
| `LANDSCAPE_PAGE` | 가로형 페이지 섞임 | ⚠️ 배지 |
| `CENTER_OBJECT_CHECK` | 사철 중앙부 객체 확인 필요 | ⚠️ 배지 |
| `CMYK_STRUCTURE_DETECTED` | CMYK 구조 감지(GS 미확정) | ⚠️ 배지 |
| `MIXED_PDF` | 혼합 PDF(표지+내지 섞임) | ⚠️ 배지 |
| `TRANSPARENCY_DETECTED` | 투명도 사용 | ⚠️ 배지 |
| `OVERPRINT_DETECTED` | 오버프린트 사용 | ⚠️ 배지 |

### 3-3. 검증 실행 순서 (validate())
`pdf-validator.service.ts:38~` 에서 호출 순서대로:

1. **파일 다운로드** (로컬 경로면 read, 원격이면 axios로 get)
2. **파일 크기 검증** → 초과 시 FILE_TOO_LARGE로 **조기 종료**
3. **PDF 무결성 검증** (pdf-lib `PDFDocument.load`) → 실패 시 FILE_CORRUPTED로 **조기 종료**
4. **메타데이터 추출** (pageCount, pageSize mm, hasBleed, colorMode, resolution)
5. **페이지 수 검증** (주문 옵션 vs 실제)
6. **페이지 크기 검증** (주문 사이즈 vs 실제 사이즈, 허용 오차 포함)
7. **재단 여백 검증** (bleed)
8. **책등 크기 검증** (`fileType==='cover'`인 경우만)
9. **가로형 페이지 감지** (WBS 2.1)
10. **사철 제본 4배수 검증** (`binding==='saddle'`)
11. **스프레드(펼침) 감지** (WBS 2.3)
12. **Ghostscript 기반 고급 검증** (사용 가능 시): CMYK·별색·투명도·오버프린트·이미지 해상도

### 3-4. 고객 피드백 UX (사용자 노티 모드)
- 기획서: `docs/worker-ux-plan.md §5`
- 실제 UI 구현 위치: **아직 미구현** (쇼핑몰 측 작업). Storige는 Job 상태·result만 제공.
- **제공되는 JSON 형태** (고객 화면에서 그대로 렌더 가능):
  ```json
  {
    "isValid": false,
    "errors": [
      { "code":"SIZE_MISMATCH", "message":"표지 사이즈가 주문 옵션과 맞지 않습니다.",
        "details": { "expected":{"width":436,"height":303},
                     "actual":{"width":430,"height":300} },
        "autoFixable": true, "fixMethod":"resizeWithPadding" }
    ],
    "warnings": [ { "code":"BLEED_MISSING", "message":"재단 여백이 없습니다.", "autoFixable":true } ],
    "metadata": { "pageCount":100, "pageSize":{...}, "hasBleed":false, "colorMode":"RGB", "resolution":300 }
  }
  ```

---

## 4. 파일 업로드 & Storage 경로 설계

### 4-1. 업로드 엔드포인트
코드: `apps/api/src/files/files.controller.ts`
- `POST /api/files/upload` — multipart, `file: PDF`, `type: cover|content`, `orderId?`, `memberSeqno?`
- 응답: `{ id, fileName, fileUrl, fileSize, mimeType, createdAt }`
- `id` = `files` 테이블 PK (UUID). 쇼핑몰은 이 id 하나만 기억하면 됨.

### 4-2. Storage 디렉터리 규약
환경변수: `STORAGE_PATH` (Worker), Docker 볼륨 `/app/storage`.

```
/app/storage/
├─ uploads/               ← POST /files/upload 로 들어온 원본
│   └─ <uuid>.pdf
├─ temp/                  ← Conversion 결과물 (임시, 고객 컨펌 전)
│   └─ converted_<uuid>.pdf
└─ outputs/               ← Synthesis 최종 결과물 (주문 진행용)
    └─ <jobId>/
        ├─ merged.pdf     ← outputFormat='merged'
        ├─ cover.pdf      ← outputFormat='separate'
        └─ content.pdf
```

### 4-3. URL 반환 규약
- DB(`files.file_url`, `worker_jobs.output_file_url`)에는 **상대경로만** 저장: `/storage/outputs/<jobId>/merged.pdf`
- 관리자/고객 UI가 받을 때 절대 URL로 변환: `apps/admin/src/lib/resolveStorageUrl.ts` (API base URL을 prefix 로 붙여 API 경유 다운로드 제공)
- 이렇게 하는 이유: 개발/운영 호스트가 달라도 URL 재작성 불필요. (최근 커밋 `9c1dab2`, `a31a75b` 로 보강됨)

---

## 5. 주문 → Worker 연동 플로우 (쇼핑몰 관점)

코드 근거:
- 외부 API: `apps/api/src/worker-jobs/worker-jobs.controller.ts:52, 99, 143, 177, 213, 237` (`/external` 엔드포인트, API Key 인증)
- 샘플 PHP: `test-php/php/*.php`, `docs/BOOKMOA_INTEGRATION_GUIDE.md`

### 5-1. 고객 유형별 분기 (worker-ux-plan §1)
| 유형 | 보유 파일 | 경로 |
|---|---|---|
| A. PDF 업로드 | 표지+내지 | **Worker 파일검증** |
| B. 표지 디자인 의뢰 | 내지만 | 관리자 컨펌 |
| C. 출판계약 | 내지만 | 관리자 컨펌 |
| D. 셀프 편집 | 내지만 | 에디터(표지 편집)+내지 PDF |
| E. 셀프 편집 | 없음 | 에디터(표지+내지 편집) |
| F. 디지털인쇄 | 작업파일 | **Worker 파일검증** |
| G. 디지털인쇄 | 없음 | 에디터(템플릿) |

### 5-2. Worker 경유 유형(A/F) 플로우 — 타임라인

| # | 주체 | 액션 | 엔드포인트 | 결과 |
|---|---|---|---|---|
| 1 | 쇼핑몰 | PDF multipart 업로드 | `POST /api/files/upload` | `fileId` 수령 |
| 2 | 쇼핑몰 | 주문DB에 fileId 저장 | — | — |
| 3 | 쇼핑몰 | 검증 요청 | `POST /api/worker-jobs/validate/external` (X-API-Key) | `jobId, status:PENDING` |
| 4 | API | Bull 큐에 job 등록 | (internal) | Redis에 enqueue |
| 5 | Worker | 큐 pickup → 검증 실행 | — | result DTO 생성 |
| 6 | Worker | API로 상태 PATCH | `PATCH /api/worker-jobs/external/:id/status` (※ validation만. conversion/synthesis는 비-external 경로라 §2-4 일관성 결함) | DB 업데이트 |
| 7-A | 쇼핑몰 (폴링) | 2~3초 간격 조회 | `GET /api/worker-jobs/external/:id` | status/result |
| 7-B | API (웹훅) | 고객이 callbackUrl 제공한 경우 | `POST ${callbackUrl}` | `{event:'synthesis.completed', outputFileUrl, ...}` |
| 8 | 쇼핑몰 | 결과 분기 UI | — | 주문 진행 / 자동변환 / 재업로드 / 에디터 |

### 5-3. 두 가지 결과 회신 방식 — 어느 쪽을 쓸까
코드: `apps/api/src/webhook/webhook.service.ts`

| 방식 | 장점 | 단점 | 권장 상황 |
|---|---|---|---|
| Polling | 구현 단순, 인프라 추가 X | 요청 빈도 ↑, 배터리/네트워크 낭비 | 같은 서버, 검증 수 초 이내 |
| Webhook 콜백 | 즉시성, 효율 | `callbackUrl` 노출·HMAC 검증 필요, 재시도 로직 필요 | 비동기가 긴 합성(Synthesis) |

**현재 구현 상태**:
- Polling: 바로 사용 가능 (`GET /worker-jobs/external/:id`)
- Webhook: `WebhookService.sendCallback()` 있음. 현재 시그니처는 base64 (TODO: HMAC-SHA256로 교체 권장 — `webhook.service.ts:80`).
- Worker → API 의 **내부 통신**은 X-API-Key 만 사용. 외부로 나가는 webhook은 `X-Storige-Event`, `X-Storige-Signature` 헤더 첨부.

### 5-4. 자동 변환 승인 플로우 (FIXABLE 케이스)
```
Validation 결과: { errors: [SIZE_MISMATCH (autoFixable:true)], ... }
        │
        ▼
쇼핑몰 UI: "자동 변환 요청" 버튼
        │
        ▼
POST /api/worker-jobs/convert  { fileId, convertOptions: { applyBleed:true, targetSize:{...} } }
        │
        ▼
Conversion Job 생성 → Worker 처리 → /storage/temp/converted_<uuid>.pdf
        │
        ▼
쇼핑몰 UI: Before/After 미리보기 (worker-ux-plan §5-3)
        │
        ├─ 승인 → 변환 파일로 주문 진행
        └─ 거절 → 원본 삭제 후 에디터 / 재업로드
```

---

## 6. 에디터 경유 주문의 플로우 (유형 D/E/G)

### 6-1. 편집 세션 생명주기
테이블: `file_edit_sessions` (워커 파이프라인용) / `edit_sessions` (레거시 호환)

```
[북모아] POST /api/edit-sessions  { orderSeqno, memberSeqno, mode:'cover'|'content'|'both'|'spread', ... }
              ▼
        edit_sessions row created (status: 'draft')
              ▼
[에디터] 편집 진행 (자동 저장 — useWorkSave.ts)
              ▼
[에디터] 편집 완료 버튼 → PATCH /api/edit-sessions/:id/complete
              ▼
apps/api/src/edit-sessions/edit-sessions.service.ts:245 complete()
  - mode === 'spread' → metadata.spine / metadata.spread 스냅샷 하드 검증
  - status: draft → complete
  - createValidationJobs() 호출 → coverFileId / contentFileId 별로 validation job 자동 생성
              ▼
[Worker] 검증 → COMPLETED or FAILED
              ▼
[API] session.callbackUrl 있으면 웹훅 발송 ('session.validated' | 'session.failed')
              ▼
[북모아] 웹훅 수신 → 주문상태 110 → 210 (등) 전이
```

### 6-2. 합성(Synthesis) 트리거 시점
에디터 완료는 자동으로 **Validation**까지만 트리거. **Synthesis**는 별도:
- 북모아가 주문 진행 시점에 `POST /api/worker-jobs/synthesize/external` 호출
- 혹은 `/split-synthesize/external` (단일 PDF 분리 케이스)
- 스프레드 편집 완료 → `mode:'spread'` synthesis job 생성

---

## 7. 관리자 콘솔에서의 파일 처리 (apps/admin)

### 7-1. 제공 페이지
| 페이지 | 경로 | 쓰임 |
|---|---|---|
| Worker Jobs | `/worker-jobs` | Job 목록·상태·입출력 파일 다운로드 |
| Edit Sessions | `/edit-sessions` | 편집 세션 목록·상태 |
| Worker Test | `/worker-test` | 수동 파일 업로드 + Job 생성 (QA용) |

### 7-2. Job 목록 화면 — 파일 링크 제공 방식
코드: `apps/admin/src/pages/WorkerJobs/WorkerJobList.tsx:84~110`

컬럼:
- **입력 파일** (`inputFileUrl`) → `resolveStorageUrl(url)` 로 절대화 → 새 탭에서 열기
- **출력 파일** (`outputFileUrl`) → 동일 방식
- **에러 메시지** (`errorMessage`) → 빨간색 텍스트

`resolveStorageUrl()`은 `/storage/...` 상대 경로를 API base URL과 결합해서 **API 경유 다운로드 URL**로 변환 (커밋 `9c1dab2`). → 운영 환경에서 Storage 디렉터리가 외부 공개되지 않아도 관리자는 파일 확인 가능.

### 7-3. 관리자가 할 수 있는 작업
- **Job 조회/필터** (`GET /api/worker-jobs?status=&jobType=`)
- **Job 상세** (`GET /api/worker-jobs/:id`)
- **Job 통계** (`GET /api/worker-jobs/stats`)
- **상태 수동 갱신** (`PATCH /api/worker-jobs/:id/status` — 전역 `JwtAuthGuard`만 있고 `RolesGuard` 없음 → 로그인한 모든 사용자가 임의 Job 상태를 바꿀 수 있음. **⚠️ 권한 정비 필요**)
- **결과 PDF 다운로드** (위 §7-2)
- **재시도/재큐잉**은 현재 UI 없음 → 향후 `POST /api/worker-jobs/:id/retry` 추가 필요

### 7-4. 알려진 개선 여지 (관리자 관점)
1. Job 재시도 버튼 없음 → 실패 시 새 Job 수동 생성해야 함.
2. 결과 PDF 미리보기(썸네일) 없음 → 클릭해서 브라우저로 열어야 함. `GET /api/files/:id/thumbnail` (worker-ux-plan §12-3) **신규 개발** 필요.
3. 검증 오류 상세(`errors[].details`)가 문자열로만 들어와 사람이 읽기 어려움 → JSON을 표 형태로 expand 하는 UI 필요.

---

## 8. 데이터 모델 — 관련 테이블 요약

외부 DB 3개(`cate`, `member`, `order_common`)는 **북모아 소유** (읽기 전용).

Storige 자체 DB (관련 테이블만):
```
files
  id, file_name, file_url, thumbnail_url, file_size, mime_type,
  file_type, order_seqno, member_seqno, metadata, ...

edit_sessions           ← 캔버스 편집/검토/이력
  id, order_id, pages, status, canvas_data, template_id, ...

file_edit_sessions      ← ★ 워커 파이프라인 핵심
  id, order_seqno, member_seqno, status, mode,
  cover_file_id, content_file_id, template_set_id,
  canvas_data, metadata, completed_at,
  worker_status, worker_error, callback_url, ...

worker_jobs
  id, job_type, status, edit_session_id, file_id,
  input_file_url, output_file_url, output_file_id,
  options, result, error_message,
  session_id, pdf_file_id, request_id,       ← 멱등성 키 3개
  error_code, error_detail, created_at, completed_at
```

### 8-1. 멱등성(Idempotency) 키
`worker_jobs` 에는 `(session_id, pdf_file_id, request_id)` 복합 UNIQUE 키가 있음. 같은 요청이 재시도되어도 중복 Job이 생기지 않게 설계됨.

### 8-2. ⚠️ 주의 — init.sql 누락 테이블
`P0A_START_HERE_결정가이드.md` 참조. 이 표에서 **굵게 표시된 `file_edit_sessions`**가 현재 운영 `init.sql`에 **없음**. P0-A 단계를 먼저 완료하지 않으면 위 전체 플로우의 에디터 완료 → 검증 Job 자동 생성 체인이 `ER_NO_SUCH_TABLE`로 실패.

---

## 9. 실패·엣지 케이스 매트릭스

| 상황 | 어디서 발생 | 현재 처리 | 향후 보완 제안 |
|---|---|---|---|
| 파일 업로드 실패 (용량·네트워크) | POST /files/upload | 400 응답 | 청크 업로드 (tus) |
| 검증 중 Ghostscript 미설치 | Worker | CMYK_STRUCTURE_DETECTED warning만 | GS 필수화 or 이미지 기반 폴백 |
| Validation → FAILED | Worker | 상태만 FAILED. 자동 재시도 X | Bull retry 옵션 활성화 |
| Conversion 결과물 실사용자 거절 | 쇼핑몰 UI | 수동 재업로드 | temp 파일 자동 GC 잡 |
| Synthesis Merge 실패 | Worker | FAILED + errorMessage | 관리자 재시도 API |
| Webhook 송신 실패 | API | 1회 재시도 후 로그만 | 재시도 큐(에x. `webhook_retry_queue`) |
| Webhook 서명 검증 | 수신 측 | 현재 base64 (취약) | HMAC-SHA256 (webhook.service.ts:80) |
| Worker → API PATCH 실패 | Worker | 로그만 찍고 예외 미전파 | Bull backoff 재시도 / DLQ |
| 같은 주문에 job 중복 생성 | API | 멱등성 키로 차단 | 차단 시 409로 명시 |

---

## 10. 환경변수 — 한눈에

### Worker
```
API_BASE_URL=http://localhost:4000/api            # Worker가 API 콜할 베이스
WORKER_API_KEY=test-api-key                        # Worker→API PATCH 인증
STORAGE_PATH=/app/storage/temp                     # Conversion 결과물 경로
OUTPUTS_PATH=/app/storage/outputs                  # Synthesis 결과물 경로
REDIS_HOST=redis
REDIS_PORT=6379
```

### API
```
DATABASE_HOST / PORT / USER / PASSWORD / NAME
JWT_SECRET / JWT_EXPIRATION
WORKER_API_KEY=test-api-key                        # API Key 인증 게이트
STORAGE_PATH=/app/storage
```

### 쇼핑몰(샘플 PHP)
```
STORIGE_API_URL=https://api.storige.com/api
STORIGE_API_KEY=bookmoa-shared-api-key             # /external 엔드포인트용
STORIGE_WEBHOOK_SECRET=...                         # HMAC 서명 검증
```

---

## 11. 엔드투엔드 확인 체크리스트 (운영 전 smoke test)

- [ ] `POST /api/files/upload` → fileId 발급
- [ ] `POST /api/worker-jobs/validate/external` → PENDING Job 생성
- [ ] `GET /api/worker-jobs/external/:id` → 2~5초 내 COMPLETED/FAILED/FIXABLE 중 하나
- [ ] FIXABLE 케이스 → `POST /api/worker-jobs/convert` → `/storage/temp/converted_*.pdf` 생성
- [ ] 표지+내지 두 파일에 대해 `POST /api/worker-jobs/synthesize/external` → `/storage/outputs/<jobId>/merged.pdf` 생성
- [ ] 관리자 `/worker-jobs` 화면에서 [입력 파일]·[출력 파일] 링크 클릭 시 브라우저에서 PDF 열림
- [ ] `POST /api/edit-sessions` → 편집 → `PATCH /.../complete` → 검증 Job 자동 생성 확인
- [ ] 에디터 완료 후 session.callbackUrl 있으면 웹훅 POST 수신 확인 (`test-php/php/webhook.php` 로그 기록)
- [ ] `worker_jobs` 테이블의 멱등성 유닉 키 동작 확인 (같은 요청 2회 → 409 또는 동일 Job id 반환)

---

## 12. 지금 당장 해야 할 것 vs 나중 과제 — 우선순위

### 즉시 (P0 — 0~1일)
| # | 항목 | 왜 시급한가 | 담당 |
|---|---|---|---|
| P0-A | `init.sql`에 `file_edit_sessions` 포함한 누락 13개 테이블 추가 | 이 안 풀리면 **편집 완료→검증** 체인 전체가 500 | Storige 인수자 |
| P0-B | `WORKER_API_KEY` 강력한 값으로 교체 | 디폴트 `test-api-key`로 운영 배포 시 외부 스팸 | DevOps |
| P0-C | 관리자 `PATCH /worker-jobs/:id/status` 에 RolesGuard 추가 | 현재 인증만 있고 역할 체크 없음 | API |

### 단기 (P1 — 1주)
| # | 항목 | 설명 |
|---|---|---|
| P1-A | Webhook 서명 HMAC-SHA256화 | 현재 base64, 변조 탐지 불가 |
| P1-B | Job 재시도 API 및 Admin 버튼 | 수동 재작업 비용 감소 |
| P1-C | Storage GC 배치 (temp, outputs 오래된 파일) | 디스크 고갈 방지 |
| P1-D | 썸네일 API (`/files/:id/thumbnail`) 구현 | 고객 UI·관리자 UI 공통 필요 |

### 중기 (P2 — 1달)
- Ghostscript 필수화 + 컨테이너 이미지 정리
- 검증 결과 UI 컴포넌트 (쇼핑몰 배포용) 라이브러리화
- 워커 오토스케일 (큐 길이 기반)
- PDF 미리보기 PDF.js Viewer 내장

---

## 13. 이 문서에서 다루지 않은 것

- **PDF 분리 상세 알고리즘** → `docs/PDF분리_상세설계서_v1.1.4.md`
- **스프레드 편집 상세** → `docs/스프레드편집_상세설계서_20260206.md`
- **북모아 통합 가이드(PHP 샘플 전체)** → `docs/BOOKMOA_INTEGRATION_GUIDE.md`
- **쇼핑몰 에디터 임베드 방식(번들 로딩)** → `docs/PHP_EDITOR_INTEGRATION_PLAN.md`

이 문서는 그것들을 **연결하는 조감도** 역할입니다.

---

## 14. 마지막 한 줄

> 이 문서 하나를 숙지하면, "쇼핑몰 PDF 주문이 Storige에 어떻게 들어와서, 어떻게 검증되고, 어디에 저장되며, 관리자가 어떤 경로로 결과 파일을 받는지" 전체 그림이 머릿속에 그려져야 합니다.
> 흐름 중 어느 단계든 버그가 생기면, 먼저 §0 한 장 요약을 보고 "어느 화살표에서 끊겼는지"를 찾은 뒤, 해당 절(§2~§7)의 `file:line` 을 펼치세요.
