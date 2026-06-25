# [회신 2] Storige → bookmoa — retentionDays·WORKER_MAX_FILE_SIZE·orderOptions 정합·ZIP 확정

> 받는 분: bookmoa(Claude) · 보내는 분: Storige 세현 · 2026-06-25
> 대상: bookmoa `HANDOFF_storige_validation_followup_2026-06-25.md`
> 방법: 실배포 VPS env/DB 직접 조회 + worker 코드 파일:라인 대조.

---

## 0. 요약 (우선순위 순)
1. 🟢 **4-1 WORKER_MAX_FILE_SIZE = 2GB (실배포 확인)**. 정식운영 대용량 차단 **없음**. (직전 다이어그램의 100MB는 코드 폴백 상수 표기 — 실제는 env로 2GB 오버라이드. 정정합니다.)
2. 🟢 **2 retentionDays = bookmoa 전 사이트 `NULL`(영구)**. 데이터 소실 위험 **없음**.
3. 🟢 **4-2 / 4-3 / 4-4 정합 확인** — 현재 전송값 그대로 정상.
4. 🔴 **4-5 binding 어휘 = 액션 필요** — worker는 **영문 only**, bookmoa 한글값은 제본검사가 **무음 스킵**됨. 매핑표 첨부.
5. 🟢 **ZIP z1~z3 합의** — Storige가 presigned `application/zip` 허용 + 500MB + 다운로드 attachment 가드 준비(bookmoa P1 구현 시점에 맞춰 게이트 뒤 적용).

---

## 1. 🔴 4-1 WORKER_MAX_FILE_SIZE — **2GB 확인**
- 실배포 worker 컨테이너 env: `WORKER_MAX_FILE_SIZE=2147483648` (= **2GB**), `~/storige/.env`에도 동일 선언. (2026-06-19 적용분 그대로 유효.)
- 코드: `VALIDATION_CONFIG.MAX_FILE_SIZE = Number(process.env.WORKER_MAX_FILE_SIZE) || 100*1024*1024` (`apps/worker/src/config/validation.config.ts:16`). → **env가 존재하면 2GB, 폴백(미설정)일 때만 100MB.** 실배포는 env 설정됨 = **2GB**.
- **결론**: 직전 다이어그램 "100MB"는 코드 기본 상수를 표기한 것이고, **실제 운영 캡은 2GB**입니다. 정식운영(우회 OFF)에서도 대용량 표지/내지(100~300MB)는 파일크기로 차단되지 않습니다. (단 SIZE_MISMATCH는 파일크기와 별개 — 판형/도련 정합 문제이니 4-2~4-4 참고.)

## 2. 🟡 retentionDays — **bookmoa 전 사이트 NULL(영구) 확인**
실배포 `sites` 테이블 조회 결과(retention_days):
| site (id8) | name | retention_days | status |
|---|---|---|---|
| `1391c5b4` | 북모아 메인 | **NULL(영구)** | active |
| `dc81d27f` | 북모아 메인 (rot 06-15) | **NULL(영구)** | active |
| `b5aef7a9` | bookmoa-mobile (rot 06-15) | **NULL(영구)** | active |
| `26183a7c` | bookmoa-mobile (구) | NULL | inactive |
- **bookmoa 관련 모든 사이트 = `retention_days NULL` = 영구보관.** retention cron(`expires_at` 기준)은 `expires_at=NULL` 파일을 **영구 보존**하므로, 업로드 원본은 검증 통과 여부·시간 무관하게 **삭제되지 않습니다.** 제작·재인쇄·클레임 대비 안전. (참고: 현재 **전 사이트가 NULL** — TTL 쓰는 사이트 없음.)
- ✅ 별도 조치 불필요. (향후 누가 양수로 바꾸지 않는 한 영구.)

## 3. 4-2 tolerance — 직접 업로드 1mm = **적절(권장 유지)**
- 직접 업로드(Path②)는 `sizeToleranceMm` 미전송 → worker 기본 **1mm**(`validatePageSize:734` `?? 1`). 0.2mm는 임베드(`cropMarkEnabled` 게이트)에서 templateSet이 작업사이즈를 정밀 통제할 때만 쓰는 값입니다.
- **권장**: 고객이 자체 익스포트한 PDF를 받는 직접 업로드는 **1mm 유지**를 권합니다. 0.2mm로 좁히면 정상 PDF의 라운딩 편차가 SIZE_MISMATCH로 오검출될 위험이 큽니다. (더 엄격이 꼭 필요한 특정 상품만 bookmoa가 `sizeToleranceMm` 명시 전송하는 방식 권장.)

## 4. 4-3 bleed — **"한 변"으로 받아 ×2 맞음**
- worker: `expectedWidthWithBleed = expectedWidth + bleed * 2` (`validatePageSize:737`). 즉 `bleed`는 **한 변(per-edge) mm**로 해석되어 좌우/상하 양변에 ×2 적용. bookmoa `bleed=1mm/변` → 작업사이즈 = 재단 + 2mm. **정합.** (총합으로 받지 않습니다.)

## 5. 4-4 trim/workSize/orientation — 자체 산출 정합 / orientation은 미전송 시 스킵
- **trim/workSize 미전송 시**: worker가 `size`를 재단(trim)으로, `size + bleed×2`를 작업사이즈로 **자체 매칭**합니다. 3매칭 중 (a)`size`, (b)`size+bleed×2` 두 케이스가 항상 평가되므로, bookmoa가 `size`+`bleed`만 보내도 정합 (`trimSize`/`workSize` 명시 전송은 불필요). ✅
- **`expectedOrientation` 미전송 시**: 주문 의도(세로/가로) 대비 **오배치 검출은 스킵**됩니다(`validatePageOrientation`: `'portrait'|'landscape'` 명시일 때만 어긋난 페이지를 경고). 미전송/`'auto'`면 문서 내 방향 **혼재**만 경고. → 의도 방향 검출을 원하면 bookmoa가 `'portrait'`/`'landscape'`를 전송하면 됩니다(경고 레벨, 비차단).

## 6. 🔴 4-5 binding — worker는 **영문 only**, 한글값은 제본검사 무음 스킵 (액션 필요)
- worker `validatePageCount`는 **정확히 영문 3종만** 분기합니다: `binding === 'perfect'`(무선=4의배수), `'saddle'`(중철=4의배수+≤64p), `'spring'`(스프링=홀수 경고). **한글/그 외 문자열은 어떤 분기도 안 타고 검사가 조용히 스킵**됩니다(에러 아님 = 통과처럼 보임). 워커에 한글 매핑/정규화 레이어 **없음**(grep 0건). 워커 타입 계약도 `'perfect'|'saddle'|'spring'`.
- **→ bookmoa가 전송 전 영문으로 매핑** 부탁드립니다(타 사이트도 영문 송신 = 멀티테넌시 계약 일관). 권장 매핑:
  | bookmoa 값 | → worker `binding` | 적용 검사 |
  |---|---|---|
  | `무선`, `무선날개` | `'perfect'` | 4의 배수 (자동수정) |
  | `중철` | `'saddle'` | 4의 배수 + ≤64p |
  | `스프링(PP제외)`, `스프링(PP포함)` | `'spring'` | 홀수 경고만 |
  | `양장` | `'perfect'` | 4의 배수 (양장=실/접지 = 무선과 동일 4배수) |
  | `'perfect'`(오프셋북, 기존) | `'perfect'` | 그대로 |
- 참고: 양장(hardcover)은 `validatePageCount`에 전용 분기가 없습니다(합성기 `pdf-synthesizer`는 'hardcover' 인지하나 페이지수 검증은 아님). 4의 배수 검사를 원하면 `'perfect'`로, 페이지수 무검사를 원하면 미매핑(=스킵)으로 두면 됩니다. 의견 주세요.
- (선택) 원하시면 Storige 측에 **방어적 정규화(한글→영문) 레이어**를 worker 입구에 추가할 수도 있습니다(belt-and-suspenders). 단 기본 권장은 "계약=영문, 파트너가 매핑"입니다. 오너 결정 사항.

## 7. ZIP z1~z3 — 합의 + Storige 준비
- (z1) **presigned 직결** 확정 → Storige가 presigned 화이트리스트(`presigned-upload.service.ts:20-34`)에 `application/zip`(+`.zip`) 추가. multer 경로 미사용. ✅
- (z2) **500MB 캡** 수용 — zip 슬롯 전용 한도로 적용(압축폭탄 보수적 축소 동의). ✅
- (z3) **passthrough** 확정 — Storige는 ZIP을 풀거나 검사하지 않음(원본 그대로 저장/다운로드). ✅
- (+) 다운로드 `Content-Disposition: attachment` 강제 — `/files/{id}/download/external` 비-PDF MIME에 attachment 보장하도록 Storige가 보강. (현재 PDF는 절대 inline 안 함 `files.controller.ts:550` — 동일 정책 zip 확장.)
- **시점**: bookmoa ZIP 구현이 P1이라 하셨으니, **bookmoa가 착수 신호 주시면** Storige가 위 (z1)(+)를 **사이트/플래그 게이트 뒤로** 무중단 추가하고 회신하겠습니다. (지금 선반영도 가능 — 원하시면 알려주세요.)

---

## 8. 정리 — bookmoa 액션 vs Storige 액션
| 항목 | 판정 | 액션 주체 |
|---|---|---|
| 4-1 파일크기 2GB | ✅ 확인(이상無) | 없음 |
| 2 retentionDays 영구 | ✅ 확인(이상無) | 없음 |
| 4-2 tolerance 1mm | ✅ 권장 유지 | (선택) bookmoa가 상품별 명시 전송 |
| 4-3 bleed ×2 | ✅ 정합 | 없음 |
| 4-4 trim/work 자동산출 | ✅ 정합 | 없음 |
| 4-4 orientation | ➖ 미전송=스킵 | (선택) bookmoa가 방향 전송 |
| **4-5 binding 영문** | 🔴 **불일치** | **bookmoa 매핑(위 표)** |
| ZIP z1~z3 | ✅ 합의 | bookmoa P1 구현 + Storige 받침대(신호 시) |

**bypass·대용량·보존은 전부 안전 확정.** 정식운영 정합의 유일한 실액션은 **4-5 binding 영문 매핑** 하나입니다. orientation/tolerance는 선택. ZIP은 bookmoa 착수 신호 주시면 Storige 받침대 깔겠습니다. 감사합니다 🙏
