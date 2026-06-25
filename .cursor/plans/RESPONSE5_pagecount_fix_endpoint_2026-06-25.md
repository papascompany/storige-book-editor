# [회신 5] Storige → bookmoa — canonical 매핑 검증 통과 + fix-pagecount 계약 확정

> 받는 분: bookmoa(Claude) · 보내는 분: Storige 세현 · 2026-06-25
> 대상: bookmoa canonical 매핑 적용(커밋 `5bcaae4`) + fix-pagecount 엔드포인트 계약 요청
> 방법: 실배포 worker 코드(`6d0cb76`, 배포완료) + bookmoa 커밋 직접 대조. 추정 아님.

---

## 1. TL;DR
- 🟢 **bookmoa 적용분(`5bcaae4`) 검증 통과 — 정상.** canonical 4종 매핑 정확, orderOptions 페이로드가 worker 수신 필드와 정확히 일치, 스파인 트리거를 canonical binding으로 교정 → 한글 `무선` 404 무음실패 해소.
- 🟢 **fix-pagecount 계약 확정**(아래 §3). **비동기** — 호출 → `jobId` 반환 → `GET /worker-jobs/:id` 폴링 → `COMPLETED` + `outputFileId`(빈페이지 추가된 새 fileId). 원본 fileId 보존. 구현 중.
- 👉 bookmoa는 (a) 프론트 배포만 하면 데이터주도 검증이 즉시 작동, (b) 이 계약대로 모달(d1)/토스트(d2) + fix-pagecount 호출만 구현하면 됨.

---

## 2. 검증 결과 (bookmoa `5bcaae4` × Storige)

| 점검 항목 | bookmoa 위치 | 판정 |
|---|---|---|
| canonical 매핑 정확성 | `binding-rules.js` | 🟢 정상. 4종(`perfect`/`saddle`/`hardcover`/`spiral`) 전부 binding_types DB 존재 → **스파인 404 해소**. 양장→`hardcover`·스프링→`spiral` 명명충돌 교정. |
| orderOptions 페이로드 정합 | `StorigeFileUploadPanel.jsx:180-194` | 🟢 정상. `pageMultiple`/`pageCountMax`/`pageCountMin` 중첩이 worker 수신 필드와 **정확히 일치**. 미매칭 제본은 미전송 → 폴백(byte-identical). |
| 스파인 트리거 binding | `validate.js:38,46` | 🟢 정상. canonical binding으로 교정 → 한글 `무선` 404 **무음실패 해소**. |
| min 이중소스 | §1 min=8 vs 스파인 DB perfect.minPages=32 | 🟢 무해. bookmoa가 **8 유지·스파인 경고 무시** 결정 — 영향 없음. |

### 확정 매핑(bookmoa 라벨 → worker canonical, 참고)
- 무선/무선날개/PUR → **perfect** (mult 2, max 1000, min 8)
- 중철/계단식중철 → **saddle** (4, 64, 8)
- 양장/반양장 → **hardcover** (4, 1000, 8)
- 스프링(PP제외/포함)/벽걸이/양장스프링 → **spiral** (2, 500, 8)
- bookmoa 라벨 구분은 **bookmoa 주문기록에 유지**. worker로 보내는 binding만 canonical 4종, 페이지 규칙은 `pageMultiple` 값으로 구분(binding 문자열 무의존).

---

## 3. fix-pagecount 최종 계약 (구현 중)

### 3.1 엔드포인트
| 엔드포인트 | 인증 |
|---|---|
| `POST /worker-jobs/fix-pagecount` | 내부 RolesGuard |
| `POST /worker-jobs/fix-pagecount/external` | 외부 `@Public` + `ApiKeyGuard` + `CurrentSite` |

- **Body**: `{ fileId, targetMultiple }`

### 3.2 비동기 흐름 (반드시 폴링)
1. 호출 → **`WorkerJob(jobId)` 반환** (즉시, 처리 전).
2. 호출측은 **`GET /worker-jobs/:id`** 폴링.
3. `status === 'COMPLETED'` → 응답의 **`outputFileId`** = 빈페이지가 추가된 **새 fileId**.
4. **원본 fileId는 보존** (불변).

### 3.3 동작
- 원본 PDF 로드 → `targetPages = ceil(현재페이지수 / targetMultiple) * targetMultiple`
- **첫 페이지 크기**의 백지를 `(targetPages - 현재페이지수)`장 **맨 뒤에** 추가
- 새 파일 저장 → 새 fileId 등록(원본 **site/order 승계**)
- 구현은 기존 변환(pdf-conversion) 파이프라인 재사용(`addPages` + `registerExternalFile`). **외부 노출 계약은 위와 같음**(내부 구현은 무관).

### 3.4 d1 흐름 (bookmoa가 구현)
- 검증 결과 **FIXABLE(배수위반, `PAGE_COUNT_INVALID`, autoFixable=true)** →
  - 파트너 모달 **"N페이지로 빈페이지 추가? Y/N"**
    - **Y** → `fix-pagecount` 호출 → 폴링 → 반환된 **`outputFileId`로 주문**.
    - **N** → 호출 안 함(**재업로드 유도**, 자동수정 없음).

> 참고: worker는 검증 중 **파일을 절대 수정하지 않음**(회신4 §q3 확정). fix-pagecount는 **bookmoa가 Y 확정 후 명시 호출할 때만** 빈페이지를 추가. "모달 전에 worker가 먼저 고침" 위험 0.

---

## 4. (배경) 데이터주도 페이지수 검증 — LIVE (worker `6d0cb76`, 배포완료)

- orderOptions 신규 필드(전부 optional): `pageMultiple` · `pageCountMax` · `pageCountMin`.
- **하나라도 전송 시** worker가 binding 문자열 하드코딩 대신 그 값으로 검증. **셋 다 미전송 시** 기존 binding 폴백(byte-identical, 비파괴).
- 동작:
  - 배수위반 → `ErrorCode.PAGE_COUNT_INVALID` (autoFixable=true, fixMethod=`addBlankPages`, details=`{expected:올림배수, actual, pageMultiple}`)
  - 상한초과 → `ErrorCode.PAGE_COUNT_EXCEEDED`
  - 하한미만 → `WarningCode.PAGE_COUNT_BELOW_MIN` (신규·**비차단**, details=`{min, actual}`)
- 글로벌 안전상한 **1000p**(`options.maxPages`)는 별개 유지. 파일크기 상한 = `WORKER_MAX_FILE_SIZE=2GB`(실배포).

---

## 5. bookmoa 액션

| 액션 | 내용 | 상태 |
|---|---|---|
| (a) 프론트 배포 | `5bcaae4` 배포 시 **데이터주도 검증 즉시 작동** (Storige 추가 작업 없음) | bookmoa 배포만 |
| (b) fix-pagecount 연동 | §3 계약대로 **호출 + 폴링** + **모달(d1)/토스트(d2)** 구현 | Storige 엔드포인트 구현 중 → 준비되면 통지 |

**정리: bookmoa의 canonical 매핑 적용(`5bcaae4`)은 검증 통과·정상입니다. fix-pagecount는 §3 계약(비동기 `jobId` → 폴링 → `outputFileId`, 원본 보존)대로 확정했으니, bookmoa는 이 계약에 맞춰 모달+호출만 구현하시면 됩니다. 엔드포인트 배포 완료 시 별도 통지하겠습니다. 🙏**
