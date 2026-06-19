# 파일 생명주기 무결성 — 실주문 무손실 + 고아 누적 방어 설계

> **작성**: 2026-06-19 · **원칙**: ① 어떤 경우에도 실주문 데이터 무손실 ② 미주문/고아 파일 무한누적 방어.
> 코드 감사(4영역) 근거. 확정분은 단정, 미검증은 "추정".

---

## 0. 한 줄 요약

현재 **실주문 파일은 "기본 영구보관(expires_at=NULL)"으로 사실상 안전**하지만 **단일 실수(잘못된 expiry SET)에 영구손실 위험**이 있고(P0), **고아 파일(미완 presigned·검증실패·재업로드 버려진 파일·에디터 사진)은 자동정리가 없어 무한 누적**한다. 해법은 **"참조 역조인 + grace" 기반 orphan 정리 cron**(참조되면 무조건 보존) + **softDelete 2단계 + dryRun 선행 + order 가드**.

---

## 1. 현재 상태 (코드 확정)

### ✅ 실주문 데이터 — 기본 안전
- 보존 cron(`file-retention.service.ts` `@Cron('17 * * * *')`)은 **`expires_at < now`인 파일만** 삭제(`files.service.ts:findExpired`). 기본 `expires_at=NULL`=영구 → 주문 파일 미삭제.
- bookmoa 외부 업로드는 `site.retentionDays` 설정 시에만 expiry(`files.controller.ts`) — 현재 미설정=영구.
- 테넌트 격리(P2c): 외부 호출 시 `file.siteId` 대조로 타 테넌트 파일 삭제 차단.

### ⚠️ P0 잠재 위험 — 단일 실수에 영구손실
- `findExpired`에 **status/order_seqno 필터가 없음**. 누군가 실수/버그로 주문 파일에 `expires_at`을 SET하면 cron이 **`hardDelete()`**(백엔드 객체 + DB 영구삭제, soft 아님) → **롤백 불가**.
- 모순: 엔티티에 `@DeleteDateColumn deleted_at` + `softDelete()`가 **이미 있는데** retention은 hardDelete 사용 → 소프트삭제 인프라 미활용.

### ❌ 고아 파일 — 무한 누적 (썸네일만 부분 정리)
| 고아 종류 | 자동정리 |
|---|---|
| presigned `pending`(complete 안 함) | ❌ 없음 |
| `failed`(abort/검증실패) — DB 레코드 잔존 | ❌ 없음 |
| 재업로드로 버려진 `ready` 파일 | ❌ 없음(추정) |
| **에디터 사진/에셋(uploads/designs)** — **files 테이블 레코드 자체가 없음**(정적 저장) | ❌ 없음 |
| 썸네일(thumbnails) | ✅ 매일 02:30, 24h grace, 미참조분 삭제 |
| 게스트세션 본체 | ✅ DB행만(1h) — **그러나 연결 파일은 CASCADE 없음 → 고아화** |
| R2 미완 멀티파트 parts | ❌ 없음(lifecycle rule 미구성) |

> 시나리오 검증: 주문 안 하고 창 닫기 / 다른 파일 반복 재업로드 / 검증실패 후 새 창 재접속 재업로드 → **전부 고아 누적**. 에디터 사진 200~300장 → files 레코드도 없어 추적·정리 불가(최악 수 GB 누적).

---

## 2. 무결성 보장 원칙 — "참조됨은 절대 삭제 안 됨"

### 안전 삭제 판정식 (AND 전부 만족할 때만 정리 후보)
```
삭제후보(file) :=
     file.orderSeqno IS NULL
 AND NOT EXISTS(edit_session 참조: cover_file_id/content_file_id/content_pdf_file_id = file.id)
 AND NOT EXISTS(worker_job 참조: file_id/output_file_id = file.id)
 AND file.metadata.locked IS NOT TRUE         -- 주문완료 잠금
 AND file.createdAt < now - GRACE
```
**참조가 하나라도 있으면 무조건 보존.** expires_at 기반 cron과 **별개로**, 이 "참조 역조인 + grace" orphan cron을 신설.

### 3중 안전장치 (오삭제 방지)
1. **dryRun 선행**: 신규 orphan cron을 **관찰모드(로그만)로 1~2주** 가동 → 실삭제 전환. (인프라 이미 존재: `FILE_RETENTION_DRY_RUN`)
2. **softDelete 2단계**: cron이 `hardDelete` 대신 **`softDelete()`(deleted_at)** → 별도 cron이 `deleted_at < now-48h`만 hard. **48h 복구창**.
3. **R2 lifecycle 백스톱**: 버킷에 `AbortIncompleteMultipartUpload(7d)` 규칙 → 앱 로직 실패해도 R2가 미완 parts 자동 정리.

### 상태별 grace(권장 기본)
| 대상 | grace | 비고 |
|---|---|---|
| pending(complete 안 함) | 24h | presign 시 expiresAt 자동 세팅, complete 시 해제 |
| failed(abort/검증실패) | 24h | |
| 재업로드 버려진 ready(미참조) | 7d | |
| 에디터 사진(미참조) | 세션삭제 + 7d | **선결: files 테이블 기록 net-new** |
| **주문/세션 참조 파일** | **∞ 절대보존** | 삭제 금지 |

---

## 3. 책임 분담

| 우선순위 | 【storige (우리 세션)】 | 【bookmoa-mobile】 |
|---|---|---|
| **P0 무손실** | • `findExpired`/hardDelete에 **`order_seqno IS NULL` + 참조 가드** 추가 → 잘못된 expiry여도 주문 파일 미삭제<br>• retention/orphan을 **softDelete 2단계**로 전환(48h 복구창)<br>• 신규 orphan cron **dryRun=ON**으로 배포 | • 주문 생성/완료 시 **`order.storige_session_id`(또는 fileId) 반드시 기록** — 역링크 보장<br>• 주문 진입 시 **게스트→회원 `migrateGuestSessions`를 24h purge 전에** 호출(guest_token 해제→삭제대상 제외) |
| **P1 누적방어** | • presign 발급 시 **pending 24h TTL 자동 세팅**<br>• 신규 `cleanupOrphans()` cron(참조 역조인 + grace)<br>• 게스트 purge 시 연결 파일 soft delete 연동(migration 보강)<br>• **에디터 사진 → files 테이블 기록(net-new)** 후 정리대상화<br>• R2 lifecycle `AbortIncompleteMultipartUpload(7d)` | • 재업로드 시 **이전 fileId `multipart/abort` 또는 정리 신호**(선택, 안 해도 orphan cron이 커버)<br>• 미성립 주문 파일 정리를 storige 전역 grace에 위임할지 결정 |
| **P2 최적화** | • Admin "고아 파일 수" 카운터 + 수동정리<br>• 삭제 audit 로그<br>• nginx `/storage/*` → R2 Phase 2 | • 재인쇄/CS 시 원본 재생성 정책 정합 |

---

## 4. 데이터 손실 시나리오 ↔ 방지

| # | 시나리오 | 현재 위험(코드) | 방지책 | 책임 |
|---|---|---|---|---|
| S1 | 정리 잡이 실주문 파일 오삭제 | `findExpired` status/order 필터 없음 + hardDelete 영구 | order 가드 + softDelete + dryRun | storige(P0) |
| S2 | 주문↔fileId 링크 끊김 | 게스트 생성 시 orderSeqno=0, order.storigeSessionId 미기록 가능 | storige_session_id 필수 기록 + 게스트 대체 추적ID | **bookmoa**(P0) |
| S3 | 게스트 24h 삭제가 주문 직전 파일 삭제 | purge가 세션만 DELETE(파일 CASCADE 없음) | 주문 진입 즉시 migrateGuestSessions | **bookmoa**+storige(P0) |
| S4 | 워커 outputFileId 저장 실패로 결과 파일 단절 | best-effort catch(추정) | outputFileId 재시도 + job.metadata 이중기록 | storige(P1) |
| S5 | 오삭제 후 복구 불가 | hardDelete 즉시 영구 | deleted_at 48h 복구창 + (옵션)R2 버전닝 | storige(P1) |

> **무손실의 핵심**: 파일은 **주문/세션에 연결되는 순간부터 정리 대상에서 영구 제외**된다. 따라서 (a) bookmoa가 **링크를 견고히 기록**하고 (b) storige cron이 **참조를 존중**하면 실주문 데이터는 절대 사라지지 않는다. 정리는 오직 "어디에도 연결 안 된 + grace 경과" 파일만 건드린다.

---

## 5. 미결정 (오너 결정)

| 항목 | 권장 기본값 |
|---|---|
| retention 실보존(테넌트 expiry 후) | soft 48h 복구창 후 hard |
| orphan grace | pending/failed 24h, ready 7d, 사진 세션삭제+7d |
| 에디터 사진 보존 | 세션 soft delete + 7d |
| 재업로드 구파일 | 즉시 soft delete(미참조 한정) |
| R2 lifecycle/버전닝 | abort 7d 활성, 버전닝 검토 |

---

## 6. 근거 (file:line)
- `apps/api/src/files/files.service.ts:findExpired` — status/order 필터 부재(S1 근본)
- `apps/api/src/files/files.service.ts:hardDelete` — 영구삭제(soft 아님) / `softDelete`+`deleted_at` 인프라 존재하나 미활용
- `apps/api/src/files/file-retention.service.ts` — cron, dryRun 게이트
- `apps/api/src/files/presigned-upload.service.ts` — pending 생성 / abort는 failed 마킹만 / R2 abort 실패 warn only
- `apps/api/src/editor/thumbnail-cleanup.service.ts` — 참조+grace 기반 정리(좋은 모델)
- `apps/api/src/storage/storage.service.ts` — 에디터 사진은 정적 저장(files 레코드 없음)
- `apps/api/migrations/20260519_*.sql` — 게스트 purge 세션만 DELETE(파일 CASCADE 없음)
- `apps/api/src/bookmoa-entities/order.entity.ts` — `storige_session_id` 역링크 필드(기록 의존)
