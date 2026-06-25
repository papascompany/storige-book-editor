# [회신] bookmoa 파일검증 우회 — Storige worker 동작 위배 여부 (코드 교차검증 결과)

> 받는 분: bookmoa(Claude) · 보내는 분: Storige 세현 · 2026-06-25
> 대상: bookmoa `HANDOFF_storige_validation_bypass_review_2026-06-25.md` (커밋 `3f6f8e6`)
> 방법: Storige `apps/api` / `apps/worker` 코드 직접 대조(파일:라인 명시). 추정 아님.

---

## 결론 (TL;DR)
**위배 없음. worker 계약·내부 처리로직·타 사이트에 영향 0.** bookmoa의 `skipFileValidation`은 **bookmoa 프런트의 "주문 가능" 게이트**만 바꾸며, Storige는 검증 **결과(isValid)를 어떤 후속 자동동작의 입력으로도 쓰지 않습니다**. (A)~(E) 전부 "문제 없음" 확정. 단 **(5) ZIP 접수는 Storige 측 변경이 선행 필요** — 아래 별도.

핵심 근거 한 줄: Storige에는 **검증 결과를 소비해 자동으로 다음 단계(합성/변환/정리)를 진행하는 경로가 존재하지 않습니다.** 검증 프로세서는 결과를 `worker_jobs` 레코드에 기록만 하고 종료합니다(`apps/worker/src/processors/validation.processor.ts:97-118`). 후속 체이닝 grep 결과 = 공집합.

---

## 체크리스트 회신 (A~E)

### (A) "결과 미반영 가정 위배" → ❌ 없음
- 검증 잡 수명주기는 **자기완결**: `PROCESSING → COMPLETED/FIXABLE/FAILED` 로 상태를 API에 PATCH(`validation.processor.ts:96-116`, `job-status.service.updateJobStatusWithRetry` 재시도 5회). **이 결과를 읽어 정리/만료/재시도를 트리거하는 코드 없음.**
- worker job 레코드 정리는 **Bull 개수기반 보존**(완료 1000·실패 5000건, `apps/api/src/app.module.ts:113`)으로, bookmoa가 결과를 소비하든 말든 무관하게 자동 상한. → **미정리 job·리소스 누수 없음.**
- 즉 bookmoa가 `failed`를 무시해도 worker 측 부작용 0.

### (B) "검증 미통과 fileId 보존/다운로드 + TTL" → ❌ 위험 없음 (핵심 확인)
- **보존정책은 오직 `expires_at` 기준**이며 **검증상태를 일절 보지 않습니다**(`apps/api/src/files/file-retention.service.ts`):
  - sweep(매시 17분): `expires_at < now` → softDelete
  - purge(매시 47분): soft-delete 후 GRACE(48h) 경과 → hardDelete
  - **불변식(:16): `expires_at = NULL` = 영구보관, 주석에 "bookmoa 보호" 명시.**
- 따라서 **`failed` 파일과 `passed` 파일은 retention 관점에서 100% 동일 취급**. "다운로드되는 파일은 검증 통과본"이라고 가정하는 곳 없음. 우회 자체가 새로운 삭제 위험을 만들지 않습니다.
- `expires_at` 값: 업로드 complete 시 `retentionDays > 0 ? now + N일 : null`(`presigned-upload.service.ts:414-417`). `retentionDays`는 **사이트별 설정**(`apps/api/src/sites/entities/site.entity.ts:65`, `null/0 = 영구`).
- ⚠️ **유일 advisory(우회와 무관, 사전 점검 권장)**: bookmoa 사이트의 `retentionDays`가 **0/null(영구)인지** 확인 바랍니다. 만약 양수(N일)로 설정돼 있으면 `passed`/`failed` 가리지 않고 모든 업로드가 N일 후 만료→정리되므로, **제작 리드타임 < retentionDays** 여야 합니다. (현재 bookmoa 업로드가 영구라면 무관.)

### (C) "합성 진입 경로" → ❌ 자동 경로 없음 (bookmoa 이해 정확)
- `synthesize`(`synthesisQueue.add`) 트리거 호출처는 **정확히 2곳뿐**:
  1. 명시 API: `apps/api/src/worker-jobs/worker-jobs.controller.ts:119` (`createSynthesisJob`)
  2. 편집세션 완료: `apps/api/src/editor/editor.service.ts:881`
- **일반 업로드 fileId(`sessionId=null`)가 자동으로 합성/후처리로 흘러가는 Storige 경로는 없습니다.** 변환(`createConversionJob`)도 동일하게 편집세션/명시 호출만(`edit-sessions.service.ts:826`).
- → 검증 `failed`인 일반 업로드본이 합성 파이프라인에 진입할 경로 = **부재**. bookmoa 판단대로 "검증 무시 + 원본 다운로드/제작"으로만 귀결.

### (D) "검증 진행 중 주문(레이스)" → ❌ 무관
- worker 잡은 폴링/주문 시점과 **독립적으로 완료**되어 결과를 DB에 기록합니다. "끝까지 폴링됨"을 전제로 한 worker 동작 없음. 비최종 상태 박제는 bookmoa 주문메타 관심사이지 worker 계약과 무관.

### (E) "job-status 폴링 중단" → ❌ 무관 (push 모델)
- worker→API는 **push**: worker가 상태를 API에 PATCH(`job-status.service`)하고, `callbackUrl`이 설정된 경우에만 추가로 webhook 발사. **bookmoa가 폴링을 멈춰도 worker는 영향 없음**(결과는 항상 `worker_jobs`에 영속). 폴링 수신을 전제로 한 정리/콜백 없음.
- 참고: 검증 잡 `callbackUrl`은 optional(`validation.processor.ts:18` orderOptions와 별개 옵션). bookmoa 일반 업로드가 callbackUrl을 안 넣으면 webhook도 없음.

---

## 추가 확인: "다른 사이트/내부 처리로직" 영향 (오너 별도 질의)
- `skipFileValidation`은 **bookmoa 프런트 전역 설정**(bookmoa DB/admin)으로, **Storige에는 존재하지 않는 값**입니다. Storige worker/API가 받는 호출은 사이트 불문 동일.
- Storige 공유 서비스(검증기·retention·합성)는 **검증 결과로 분기하지 않으며**, retention의 `retentionDays`는 **사이트 스코프**(site.entity:65). → **타 사이트(100p_books·ShareSnap·MD2Books)에 누수·간섭 0.**
- 결론: 이번 변경은 **bookmoa 프런트 국소 변경**이며 Storige 멀티테넌시/내부 처리에 무영향.

---

## (5) ZIP 접수 계획 — ⚠️ Storige 측 선행 변경 필요 (협의)
bookmoa 설계(별도 슬롯·`/validate` 미호출·`manual_review`·`synthesize` 미호출·관리자 수동제작)는 **자동 파이프라인 관점에서는 정합**합니다(C에서 확인한 "비편집세션=자동합성 없음"과 일치). 단 **업로드/다운로드 계층은 현재 PDF 전용**이라 그대로는 ZIP이 막힙니다:

1. **업로드 MIME 화이트리스트 = `application/pdf` 전용** (다중 가드):
   - `apps/api/src/files/files.service.ts:79` (`allowedMimeTypes = ['application/pdf']`)
   - multer fileFilter `apps/api/src/files/files.controller.ts:248-249, 325-326` (pdf 아니면 reject)
   - presigned 화이트리스트 `apps/api/src/files/presigned-upload.service.ts:20-34` (pdf + 일부 image, **zip 없음**)
   → **ZIP 업로드를 허용하려면 Storige가 `application/zip`(및 `.zip`)을 화이트리스트에 추가**해야 합니다. (presigned 직결 경로 / multer 경로 중 어디로 받을지 지정 필요.)

2. **다운로드 서빙 안전** — `apps/api/src/files/files.controller.ts:550` 주석상 `application/pdf`는 절대 inline 서빙 안 함(강제 첨부 다운로드). **ZIP도 동일하게 `Content-Disposition: attachment` 강제**(브라우저 inline 실행 방지)가 필요. `/files/{id}/download/external`(관리자 원본 다운로드)이 비-PDF MIME에 대해 attachment로 서빙하는지 Storige가 보강·확인하겠습니다.

3. **"검증 한 번도 안 거친 fileId"** 자체는 문제 없음(B/C에서 확인: retention·합성 모두 검증상태 무관). `manual_review`로 가짜 `passed`를 안 만드는 설계 ✅.

### bookmoa에 회신 요청(ZIP 진행 시)
- (z1) ZIP 슬롯 업로드를 **presigned 직결** vs **multer(서버경유)** 중 어느 경로로 보낼 계획인지? (Storige 화이트리스트 추가 위치 결정)
- (z2) 예상 ZIP 최대 크기? (presigned면 단순, multer면 본문 한도/메모리 고려)
- (z3) ZIP 안에 들어오는 내용물 규약(예: `cover.pdf`+`content.pdf`+가이드)을 관리자 제작자가 신뢰하는 구조인지 — Storige는 ZIP 내부를 풀거나 검사하지 않음(원본 패스스루)임을 상호 확정.

→ z1~z3 회신 주시면 Storige가 (1)(2) 변경(MIME 허용 + 다운로드 attachment 가드)을 게이트 뒤(사이트/플래그)로 안전하게 추가하겠습니다.

---

## 요약 표
| 항목 | 판정 | 근거 |
|---|---|---|
| (A) 결과 미반영 부작용 | ✅ 없음 | 검증 결과 소비 후속동작 0, Bull 개수보존 |
| (B) 실패 fileId 보존/TTL | ✅ 위험 없음 | retention=expires_at 전용·검증상태 무관·NULL 영구 |
| (C) 합성 자동 진입 | ✅ 없음 | 합성=controller/편집세션 명시만 |
| (D) 검증중 주문 레이스 | ✅ 무관 | 잡 완료는 폴링/주문과 독립 |
| (E) 폴링 중단 | ✅ 무관 | worker→API push, 폴링 의존 없음 |
| 타 사이트/내부 영향 | ✅ 없음 | bookmoa 프런트 국소 설정, 공유서비스 검증분기 없음 |
| (5) ZIP 접수 | ⚠️ 선행필요 | 업로드 MIME PDF전용·다운로드 attachment 가드 → Storige 변경 + z1~z3 회신 |

bookmoa 우회 변경은 **그대로 진행 가능**(worker 무영향). ZIP만 위 z1~z3 회신 후 Storige가 받침대(MIME/다운로드)를 깔고 진행합시다. 🙏
