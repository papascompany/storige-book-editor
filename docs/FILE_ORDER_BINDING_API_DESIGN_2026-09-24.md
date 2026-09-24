# 파일↔주문 결속 API 설계안 (File Order Binding) — v1.1 완결본

- 기준일: 2026-09-24. DB 시각은 UTC다.
- 근거 표기
  - `file:line`은 저장소 루트 `/Users/yohan/Developer/Bookmoa Storige editor/storige` 기준이다. `apps/api/src/` 접두는 생략했다.
  - †는 이번 개정에서 코드와 직접 대조한 근거다. 나머지 file:line은 선행 정찰(RECON)에서 인용했다.
  - "FACTS"는 프로덕션 실측과 파트너 확인으로 확정된 전제이며, 이 문서에서 재검증하지 않는다.
  - "추정"과 "가정"은 본문에 따로 표시했다.
- 공개 저장소 규칙
  - 시크릿, 키 값, 파트너 개별 file id는 적지 않았다. 건수만 쓴다.
  - 백필 대상 목록은 저장소 밖에서 주고받는다.

> **메인 세션 직접 검증 기록 (2026-09-24, 워크플로 결과 수령 후)** — 설계의 하중을 받는 주장을 코드·운영에서 다시 대조했다.
> - ✅ 파트너 worker 키 → `role='worker'` → `assertSiteAccess` 무조건 통과: `api-key.guard.ts` 의 editor 조회 실패 시 worker 조회·`role='worker'`, `files.service.ts:339` `caller.role === 'worker'` 즉시 return. **운영 노출 = 활성 사이트 3곳**(§1.5)
> - ✅ Partner API v1 운영 중: `app.module.ts:167` `PartnerApiModule` 마운트, 무인증 프로브 `GET /api/v1/books` → **401**(라우트 존재·인증 요구), 미존재 경로 → 404. 결속 경로는 아직 없음(404)
> - ✅ `restore()` 는 `deleted_at` 만 해제하고 `expires_at` 은 유지(`files.service.ts:490-507`) → 고아 강등 복구 파일은 다음 :17 sweep 에 재강등
> - ✅ 공개 저장소 점검: 전체 UUID 0건 · 파트너 개별 file id 0건 · 시크릿 키워드 0건
> - 워크플로 규모: 에이전트 9(정찰 3·설계 1·적대적 검토 4·개정 1), 검토 지적 41건(blocker 1·major 19·minor 21) → 반영 37·부분 반영 4·기각 0

---

## 0. 요약

1. Storige 안에 주문 결속 권위를 새로 둔다.
   - 저장소: 테이블 `file_order_bindings`. UNIQUE `file_id`, first-claim-wins 규칙.
   - 엔드포인트(Partner API v1): `POST /api/v1/files/{fileId}/order-binding`, `GET` 같은 경로, `POST …/order-binding/expiry`.
   - `files.order_seqno`는 재사용하지 않는다.
2. 테넌시는 엄격하게 판정한다.
   - editor 키만 허용하고, `file.site_id = caller.siteId`여야 한다.
   - NULL-site 파일은 결속할 수 없고, 스탬프도 바꾸지 않는다.
   - 호출자 사이트의 교차근거가 있을 때만 `422 SITE_UNSTAMPED`로 알리고, 그 밖에는 404로 존재를 숨긴다.
3. 결속이 막는 것은 고아 정리뿐이다.
   - 고아 후보 쿼리에서 결속 파일을 제외하고, 강등 직전에 행 잠금 상태에서 결속을 다시 확인한다.
   - 취소 후 보존은 새 결속 범위 만료 엔드포인트로 한다. 이 엔드포인트는 orderRef가 일치할 때만 만료를 건다.
4. (a)안은 전역으로 켜지 않는다.
   - 사이트별 모드(`off/dry/live`)를 두고, NULL-site를 명시적으로 배제하는 2-pass 쿼리로만 적용한다.
   - bookmoa는 결속 가동, 백필, 소급 결속, 장바구니 조건이 모두 갖춰질 때까지 `off`다.
5. 순서: 마이그레이션 → API 배포(OFF) → ON → 편집기 스탬프 수정 → bookmoa 호출 → 백필(재실측, 교차근거) → 소급 결속 → D6 → 기본 고아 정리 실가동(별도 결정) → 사이트별 (a)안.

---

## 1. 배경과 문제

### 1.1 고아 정리는 '주문됨'을 판정하지 못한다

- 후보 쿼리 `findOrphanCandidates`(files.service.ts:654-723†)의 조건은 다음과 같다.
  - `order_seqno IS NULL`
  - `deleted_at IS NULL`
  - status별 grace: pending·failed는 24h, ready는 30일
  - 편집세션 참조 없음
  - worker_jobs 참조 없음. 참조 방식은 id 3개 컬럼, url 2개 컬럼, options JSON 역참조다. status를 가리지 않으므로 VALIDATE 잡이 한 번이라도 붙은 파일은 영구히 제외된다.
- cron은 `'7 * * * *'`로 돈다(file-orphan.service.ts:53†).
  - `envDryRun`은 `FILE_ORPHAN_DRY_RUN`이 `'0'`이 아니면 참이다(:49†). env가 설정돼 있지 않아 기본값 `'1'`이 적용되고, 현재는 dry로 돈다.
  - 최종 판정은 `dryRun = envDryRun || retention.dryRun`이다(:68†).
  - FACTS상 `retention_dry_run=0`이므로 실삭제를 막고 있는 것은 env 하나뿐이다.
- (a)안은 종료된 VALIDATE 잡(COMPLETED·FAILED·FIXABLE)의 참조를 참조로 보지 않도록 조건을 완화하자는 제안이다. 현행 후보는 dry 기준 15건이다.

### 1.2 `order_seqno`를 쓸 수 없는 이유 (FACTS)

- **bookmoa는 이 값을 보내지 않는다.** 업로드(presigned complete)와 검증(`/api/storige/validate`) 어디에도 orderSeqno가 없다. 그래서 `order_seqno IS NULL`이 '주문되지 않음'을 뜻하지 않는다.
- **파트너마다 의미가 다르다.**
  - bookmoa의 세션값은 장바구니 항목 id(12~15자리)다.
  - printy의 값은 클라이언트가 발번한 13자리다.
  - 둘 다 당사의 주문 실체가 아니다.
  - order_seqno를 가진 파일 67건 중 60건은 세션값을 물려받은 것이다.
- **타입이 맞지 않는다.** `files.order_seqno`는 bigint(file.entity.ts:102-104)이고, `file_edit_sessions.order_seqno`는 bigint NOT NULL(edit-session.entity.ts:36,41)이다. 비숫자를 포함할 수 있는 문자열 orderRef를 담을 수 없다.
- **권위가 외부에 있다.** 주문↔파일 결속의 권위는 bookmoa DB의 `order_asset_claims(kind=file)`에만 있다.

### 1.3 보존해야 하는 집합과 (a)안의 즉시 피해 (FACTS, 2026-09-24)

| 항목 | 수치 |
|---|---|
| 보존 필수 집합 | 73건 = 주문 결속 70 + 회원 장바구니 참조 3. 전부 order_seqno NULL |
| 그중 NULL-site | 25건(주문 22 + 장바구니 3). R-149 스탬프 적용일(2026-08-28) 이전 업로드 |
| 그중 bookmoa site 스탬프 | 48건 |
| (a)안 첫 tick에 즉시 삭제 대상 | 25건 / 133MB / 최고령 89일 |
| bookmoa 미연결 풀(order_seqno NULL, 세션 미참조) | 96건 / 3.72GB. 2026-09-27부터 30일 grace 진입 |
| 현행 후보 | 15건(dry) |

### 1.4 정적 제외 목록이 금방 낡는 이유

- 3일 동안 결속 12건과 미주문 테스트 업로드 약 23건이 함께 생겼고, 당사 데이터만으로는 둘을 구분할 수 없다.
- 정적 목록은 파트너의 수동 통지 주기에 묶인다. 통지와 통지 사이에 생긴 결속은 보호받지 못한다.
- 양측 합의
  - (i) 결속 기록 API가 유일한 지속 해법이다.
  - (ii) 그 전까지 bookmoa site는 (a)안에서 전면 제외한다.
  - (a)안을 단독으로 채택하는 안은 기각한다.

### 1.5 인접 결함 (설계 제약)

- **NULL-site 통과.** `assertSiteAccess`는 `file.siteId`가 NULL이면 누구든 통과시킨다(files.service.ts:340†).
  - 그래서 fileId를 아는 활성 키라면 어느 것으로든 NULL-site 파일을 hardDelete(:453-460†)하거나 setExpiry(:513-522†)할 수 있다.
  - CONTRACT_FREEZE §4.3에 기록된 결함이다(docs/CONTRACT_FREEZE.md:212†).
- **파트너 worker 키에도 worker 역할이 붙는다.**
  - `ApiKeyGuard`는 editor 코드 조회에 실패하면 worker 코드로 조회해 `role='worker'`를 준다(api-key.guard.ts:31-37†). 내부 `WORKER_API_KEY`만 이렇게 되는 것이 아니다(:46-49†).
  - `role==='worker'` 우회는 최소 6개 파일에 있다: files.service.ts:339†, worker-jobs.service.ts:964†, :2407†, edit-sessions.service.ts:215†, :402†, :480†, presigned-upload.service.ts:349†, :424†.
  - 따라서 파트너 worker 키는 **다른 사이트의 파일**까지 다운로드, 삭제, 만료할 수 있다. §4.3보다 넓은 결함이다(§9 T4, 오너 결정 W1).
  - 🔴 **운영 노출 실측(2026-09-24, 키 값 미출력·일치 여부만 비교)**: 키 조회는 `status='active'` 사이트만 대상이다(sites.service.ts:83·90†).
    그중 editor 코드 ≠ worker 코드인 **활성 사이트는 3곳**이다 — **bookmoa(`b5aef7a9`)**, **100p Books**, **printy**.
    나머지 활성 사이트(Default Site 2·ShareSnap·북모아 메인(rot)·MD2Books)는 두 코드가 같아 editor 조회에서 먼저 매칭되므로 `role='editor'` 다.
    즉 위 3개 파트너가 자기 **worker 키**로 호출하면 지금 이 순간에도 테넌시 검사 없이 타사 파일에 접근할 수 있다. 실제 악용 흔적은 조사하지 않았다(fileId 는 UUIDv4 라 추측 불가 — 유출 경로가 있어야 악용 가능).
    → W1 은 이 결속 설계의 선행 조건이기 이전에 **독립된 보안 교정 과제**다(§16 W1 권고 참조).
  - ✅ **2026-09-25 교정 구현 완료**: `role='worker'` 를 내부 `WORKER_API_KEY` 에만 부여(`auth/api-key-role.ts` 단일 원천, 가드·전략 공용). 배포 상태는 RESUME §8-16 참조. CONTRACT_FREEZE v1.5 §4.4
- **`restore()`는 `deleted_at`만 되돌리고 `expires_at`은 그대로 둔다**(files.service.ts:490-507†).
  - 고아 강등은 `expires_at`과 `deleted_at`을 모두 NOW()로 설정한다(:740†).
  - 그래서 복구된 파일은 다음 :17 sweep에 다시 soft-delete된다.
- **purge는 `expires_at IS NOT NULL`만 본다**(files.service.ts:572-582†).
  - 미래 만료가 예약된 파일이 수동으로 soft-delete되면, 예약일이 아니라 48h 뒤에 영구 삭제된다.
- **`softDeleteWithExpiry`는 참조를 다시 확인하지 않는다**(files.service.ts:736-745†). 후보 SELECT와 UPDATE 사이에 경합 창이 있다.

---

## 2. 목표와 비목표

### 목표

- **G1.** 파트너가 "이 파일은 이 주문에 쓰였다"를 서버 간 호출로 기록한다. 기록은 멱등, 불변, first-claim-wins다.
- **G2.** 결속된 파일을 고아 정리에서 원자적으로 보호한다. 경합 창이 없어야 한다.
- **G3.** *결속 API 표면에서* 다음을 차단한다: NULL-site 청구 위조, 교차 사이트 청구, 재바인딩 세탁, worker 키 사용.
  - 기존 레거시 파괴 경로(`DELETE`와 `expiry/external`)에서 파트너 worker 키가 테넌시를 우회하는 문제는 이 설계로 막히지 않는다.
  - 그 경로는 W1(§9 T4, §16)로 교정하며, 그 전까지는 잔여 위험으로 명시한다.
- **G4.** 자가치유 재호출이 무한 루프에 빠지지 않도록, 재시도 가능한 오류와 불가능한 오류를 errorCode로 구분한다.
- **G5.** (a)안을 사이트별로 안전하게 켤 수 있는 게이트를 둔다. 기본값은 전부 `off`이고, NULL-site 파일은 구조적으로 배제한다.
- **G6.** 기존 FROZEN 라우트의 동작은 바꾸지 않는다. W1은 별도의 MODIFY-TARGET 결정으로 다룬다.
- **G7.** 취소 보존 만료를 걸 때 서버가 orderRef 일치를 확인한다. 재사용된 파일이 다른 주문의 취소 때문에 지워지는 일을 막기 위해서다.

### 비목표

- **N1.** 파트너용 결속 해제(unbind) API는 두지 않는다. 운영자 정정 경로는 오너 결정 O11이다.
- **N2.** 장바구니 예약 결속(`cart_hold`)은 컬럼 자리만 예약하고 동작은 구현하지 않는다(O10).
- **N3.** 결속이 `files.site_id`를 채우지 않는다. 백필은 별도의 오너 승인 절차로 한다.
- **N4.** D6 게이트 자체와 W1 구현은 이 문서 범위 밖이다. 이 문서는 둘과의 순서 의존만 정의한다.
- **N5.** webhook `file.binding.*` 이벤트는 만들지 않는다. v2 옵트인 전용이라 bookmoa에 도달하지 않는다(webhook-v2.constants.ts:57-79).
- **N6.** soft-deleted 파일을 자동으로 복구하지 않는다. 운영 런북(§8.7)으로 처리한다.

---

## 3. 요구사항 추적표

| 요구 | 출처 | 설계 항목 |
|---|---|---|
| ⓐ 주문 생성 직후 best-effort 호출. 멱등 replay 경로에서 재호출. 장바구니 담기 시점에는 호출 안 함 | bookmoa | §6.2 POST, §6.7 멱등(같은 file와 orderRef면 200 no-op). 장바구니 공백은 §8.6 |
| ⓑ orderRef는 문자열 1~32자 `[A-Za-z0-9_-]`, 정수 파싱 금지. orderItemKey는 선택 | bookmoa | §5 `order_ref VARCHAR(32) ascii_bin` + CHECK. §6.2 DTO는 `@Matches`만 쓰고 `@IsNumber`·`@Type(Number)`는 쓰지 않는다(반례: upload-file.dto.ts:24-31). 동일성은 orderRef만으로 판정(§6.7) |
| ⓒ 같은 orderRef는 200 no-op. 다른 orderRef는 409이고 기존 결속 유지. 재바인딩 금지 | bookmoa | §5 UNIQUE(file_id), §7 잠금 후 비교, `409 ERR_FILE_ALREADY_BOUND` |
| ⓓ 취소 시 파일을 지우지 않고 만료를 취소+N일(기본 90)로 건다 | bookmoa | §6.4 결속 범위 만료(권고 경로). 레거시 `expiry/external`도 계속 허용(§8.4). N은 O5 |
| ⓔ 결속 실패가 주문을 막지 않음. 자가치유. 같은 (파일, orderRef)는 5분에 1회. 응답에 boundAt·orderRef 포함 | bookmoa | §6.3 응답, §6.6 에러표, §6.9 재시도 분류. 5분 제한은 파트너 측 |
| (ii) 결속 API 이전에는 bookmoa를 (a)안에서 전면 제외 | 합의 | §8.3 사이트 모드 기본 `off`, §14 S10 진입 조건 |
| (iii) 회원 장바구니 만료는 bookmoa 자체 트랙(R-190) | bookmoa | §8.6 옵트인 전제 조건으로 편입 |
| `/embed`에 parentOrigin 상시 지정. 편집 경로 파일은 편집기 완료가 만든다 | bookmoa | §10 편집기 산출물 스탬프 수정을 선행. NULL이면 세션 교차근거로 `SITE_UNSTAMPED` |
| printy: 자체 레지스트리와 파기 스크립트, editor 키 단일 사용, Storige 자산 0건 | printy | §6.1 editor 키만 허용. §15 호출은 선택. `retention_days` 설정 금지 방침 유지 |
| 미결 (1) 장바구니 공백 | 과제 | §8.6 |
| 미결 (2) NULL-site 결속 요청 | 과제 | §6.6 `SITE_UNSTAMPED`, §7 교차근거, §9 T1·T8, §10 |
| 미결 (3) 취소 후 만료와 결속의 관계 | 과제 | §8.4 |
| 미결 (4) 재주문·동일 파일 재사용 | 과제 | §6.4, §8.5 |
| 미결 (5) 표면 선택 | 과제 | §4 D1 |

---

## 4. 설계 결정 기록

| ID | 채택안 | 근거 | 기각안과 사유 |
|---|---|---|---|
| D1 표면 | **Partner API v1** | ① v1 가드는 기존 sites 키를 그대로 받는다(partner-api-key.guard.ts:64-79†). 신규 키 발급이 필요 없다. ② ErrV1 카탈로그로 오류를 구분할 수 있다(packages/types/src/index.ts:2355-2398†). ③ 감사, 레이트리밋, envelope를 `@PartnerV1Controller`에서 승계한다(partner-v1.decorator.ts:35-47†). ④ `@PartnerLiveOnly`로 test 키를 막는다. ⑤ v1 books가 교차 테넌트에 404를 주는 선례가 있다(books.service.ts:527-533†). ⑥ **결속 표면에서는** FROZEN 레거시 라우트를 고치지 않는다 | 레거시 `/files/:id/order-binding/external`. `{code,message}` 본문이라 카탈로그도 additive 규칙도 없다. 404가 부재·타 테넌트·(D6 후) NULL 세 가지 의미를 떠안는다. 멱등과 감사를 새로 만들어야 한다 |
| D2 저장 | 새 테이블 `file_order_bindings`, UNIQUE(`file_id`) | order_seqno는 bigint이고 의미도 파트너마다 다르다. files에 컬럼을 추가하면 대형 테이블 변경이 되고 이력을 남길 수 없다 | `files.order_ref` 컬럼: 감사 필드가 없다. `order_seqno` 재사용: FACTS가 금지한다 |
| D3 FK | **FK 없음.** 파일이 삭제돼도 결속 행은 tombstone으로 남는다 | `hardDeleteEntity`는 객체를 먼저 지우고 DB 행을 나중에 지운다(files.service.ts:467-481†). files에 FK를 걸지 않는 관례가 있다(20260617_b:48-51). 분쟁 대비 이력이 필요하고, GET으로 자사 tombstone을 조회할 수 있다(§6.5) | RESTRICT: 객체 없는 행이 남는다. CASCADE: 이력이 사라진다 |
| D4 멱등 | 도메인 멱등. 잠금 후 `(file_id, order_ref)`로 비교한다. `Idempotency-Key` 헤더는 **보내지 않는다** | v1 캐시는 status<500이면 전부 스냅샷으로 24h 재생한다. 코드로 확정된 동작이다(partner-idempotency.interceptor.ts:137-145†) | 헤더 캐시에 의존: 일시적인 409·422가 24h 동안 고정된다 |
| D5 재바인딩 | 금지. first-claim-wins이고 `order_ref`는 불변이다 | bookmoa `order_asset_claims`와 같은 모델이다. 재바인딩은 세탁 경로가 된다(R-97/R-100) | last-write-wins나 다중 결속: 세탁 경로가 생기고 만료 판단이 복잡해진다 |
| D6d 테넌시 | 전용 판정. `role==='editor'`, `file.site_id IS NOT NULL`, `file.site_id===caller.siteId`, `binding.site_id===caller.siteId`를 모두 요구한다 | `assertSiteAccess`는 NULL과 worker를 통과시킨다(files.service.ts:339-340†). 공유 헬퍼를 고치면 FROZEN 동작과 spec(files.service.spec.ts:84,:91)이 깨진다 | `assertSiteAccess` 재사용: 위조 경로가 된다 |
| D7 NULL-site | 결속 거부. 스탬프는 절대 바꾸지 않는다. **호출자 사이트의 교차근거가 있을 때만** `422 ERR_FILE_NOT_BINDABLE/SITE_UNSTAMPED`, 없으면 404 | T6 선례: 소급 스탬프는 하이재킹 벡터다(presigned-upload.service.ts:409-424†, presigned-complete-stamp.spec.ts:155). 교차근거로 제한해야 존재 오라클이 되지 않는다(§9 T8) | 호출자 사이트로 스탬프: 위조. NULL이면 무조건 422: 존재 오라클. 무조건 404: 자사 파일의 원인을 진단할 수 없다 |
| D8 결속과 명시 만료 | 결속은 **고아 정리만** 막는다. 소유 사이트의 레거시 `expiry/external`·`DELETE external`과 결속 범위 만료는 허용한다 | ⓓ는 파트너가 의도한 행위다. `findExpired`나 purge에 가드를 넣으면 ⓓ가 무력해진다 | 결속이 만료와 삭제를 차단: ⓓ와 충돌하고 FROZEN 의미가 바뀐다 |
| D9 (a)안 게이트 | `sites.orphan_terminal_validate_mode` (`off`/`dry`/`live`, 기본 `off`). 2-pass 쿼리(§8.3). 엔티티에 매핑하지 않고 raw SQL로 읽는다 | 사이트별 정책 컬럼 관례가 있다(site.entity.ts:58-94). 모드를 3값으로 두면 전역 env와 독립적으로 사이트 dry 검증을 할 수 있다. 엔티티 미매핑이라 컬럼이 없어도 인증 경로에 영향이 없다 | boolean + 전역 `DRY_RUN=0`: 전 사이트 기본 고아 정리가 함께 실가동된다. 엔티티 매핑: 컬럼이 없으면 `sites` 조회가 실패해 전 파트너 인증이 끊긴다(sites.service.ts:81-92) |
| D10 강등 경합 | 강등을 트랜잭션으로 처리한다. files 행 `FOR UPDATE` → 결속 `LOCK IN SHARE MODE` 재확인 → UPDATE. bind도 같은 순서로 잠근다 | 현행 UPDATE는 참조를 다시 확인하지 않는다(files.service.ts:736-745†) | SELECT 시점 필터만 사용: 배치 창 안의 경합을 막지 못한다 |
| D11 soft-deleted | 자동 복구하지 않는다. `expires_at`이 있으면 `422 PENDING_DELETION`, 없으면(수동 삭제) `422 SOFT_DELETED`. PENDING_DELETION은 Sentry warning으로 보낸다 | `restore()`가 `expires_at`을 되돌리지 않는다(:490-507†). purge 대상은 `expires_at IS NOT NULL`뿐이다(:572-582†) | 자동 복구와 결속: 경합과 감사를 다시 설계해야 한다 |
| D12 키 역할 | 결속 표면은 editor 키만 받는다. worker 역할(내부와 파트너 모두)은 403이다 | 파트너 worker 키에도 worker 역할이 붙는다(api-key.guard.ts:34-37†) | worker 허용: 테넌시 우회 |
| D13 가동 분리 | `ORDER_BINDING_ENABLED`는 `partner-api.config.ts`에서 파싱하고 기본값은 false다. 전환하려면 컨테이너 재생성과 nginx 재시작이 필요하다. S5 이후 롤백은 이미지 롤백이 아니라 플래그 OFF(503)로 한다 | env 검증 모듈은 따로 없고, v1 env는 여기서 중앙 파싱한다(partner-api.config.ts:5-12) | DROP 롤백: 권위 기록이 사라진다. 이미지 롤백: 라우트가 사라져 envelope 없는 404가 나고, 파트너가 이를 재시도 불가로 오판한다 |
| D14 결속 범위 만료 | `POST /api/v1/files/{fileId}/order-binding/expiry {orderRef, expiresAt|null}` | orderRef가 다르면 409를 내서 재사용 파일에 걸리는 오취소 만료를 서버가 막는다. 수명주기가 v1 안에서 닫혀 GUIDE의 혼용 금지와 충돌이 줄어든다 | 레거시 `expiry/external`만 사용: 주문 개념이 없고, 404가 과적재돼 있고, worker 우회가 적용된다 |
| D15 orderItemKey | 정보용 필드다. 동일성 판정에 쓰지 않는다. 저장값이 NULL이면 한 번만 채운다. 서로 다르면 200과 `orderItemKeyMismatch:true`를 돌려준다 | ⓒ는 orderRef만으로 no-op을 요구한다. 소급 결속 뒤 자가치유에서 거짓 409가 나지 않게 한다 | 불일치 409: 영구 거짓 충돌이 생긴다 |
| D16 W1 분리 | 파트너 worker 키 역할 교정은 별도 MODIFY-TARGET으로 다루고 S5 전 집행을 권고한다(오너 결정). 초안의 'O6(결속 파일만 404로 축소)'은 폐기한다 | O6의 404는 '404=성공' 계약(CONTRACT_FREEZE.md:46†)에서 삭제 실패를 성공으로 기록하게 만든다. 결속이 쌓이면 ADDITIVE 전제(소비자 불변)도 깨진다 | O6 유지: 조용한 실패가 생기고 계약 분류를 위반한다 |

---

## 5. 데이터 모델

### 5.1 `20260925_add_file_order_bindings.sql`

- 파일명의 날짜는 실제 커밋일로 바꾼다.
- 헤더 형식은 20260822_add_file_edit_session_versions.sql:1-43의 관례를 따른다.

```sql
-- =====================================================================
-- 20260925_add_file_order_bindings.sql
-- 파일↔주문 결속 레지스트리 (additive). 정본: 결속 설계서 §5.
-- 정책: file_id UNIQUE(first-claim-wins, order_ref 불변). FK 없음 — 파일 hardDelete 후 tombstone 보존.
--   order_ref/order_item_key 는 ascii_bin(대소문자 구분, 정수 파싱 금지).
-- ⚠️ 운영 적용 순서 (synchronize=false, app.module.ts:102):
--   1) 이 SQL 먼저 → 2) API 재배포(docker compose up -d --build api) + nginx 재시작.
--   역순이면 findOrphanCandidates 가 없는 테이블을 참조해 실패 → Sentry orphan-query-failed,
--   삭제는 일어나지 않는 방향(file-orphan.service.ts:77-90). 결속 API 는 500.
-- 사전 확인: SHOW CREATE TABLE files; SHOW CREATE TABLE sites;  -- id 문자셋/collation 을 file_id/site_id 에 일치
-- 멱등: CREATE TABLE IF NOT EXISTS.
-- 롤백: ① 이 테이블을 참조하는 API 이미지를 먼저 이전 버전으로 되돌리고(+nginx 재시작)
--       ② 결속 행이 0건일 때만 DROP TABLE file_order_bindings;
--       행이 1건이라도 생긴 뒤에는 DROP 금지(권위 기록 소실) — 기능 플래그 OFF 로만 중지.
-- =====================================================================
CREATE TABLE IF NOT EXISTS file_order_bindings (
  id                VARCHAR(36)  NOT NULL,
  file_id           VARCHAR(36)  NOT NULL,
  site_id           VARCHAR(36)  NOT NULL,
  kind              VARCHAR(16)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'order',
  order_ref         VARCHAR(32)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_item_key    VARCHAR(32)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  bound_key_source  VARCHAR(16)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,  -- 'sites' | 'partner'
  bound_key_fp      CHAR(16)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,  -- sha256(apiKey)[:16], 원문 비저장
  bound_api_key_id  VARCHAR(36)  NULL,       -- v1 partner_api_keys.id (sites 키면 NULL)
  bound_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fob_file (file_id),
  INDEX idx_fob_site_order (site_id, order_ref),
  CONSTRAINT chk_fob_kind      CHECK (kind IN ('order')),
  CONSTRAINT chk_fob_src       CHECK (bound_key_source IN ('sites','partner')),
  CONSTRAINT chk_fob_order_ref CHECK (order_ref REGEXP '^[A-Za-z0-9_-]{1,32}$'),
  CONSTRAINT chk_fob_item_key  CHECK (order_item_key IS NULL OR order_item_key REGEXP '^[A-Za-z0-9_-]{1,32}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- 적용 확인: SHOW CREATE TABLE file_order_bindings; SELECT COUNT(*) FROM file_order_bindings; -- 0
```

- **`kind`**: 향후 `cart_hold`(O10)를 위해 예약한 컬럼이다. 지금은 `'order'`만 허용한다.
- **`bound_key_fp`**: 키 지문(sha256 앞 16자)이다. v1 레이트리밋 트래커와 같은 방식으로 계산한다(partner-rate-limit.guard.ts:64-71†).
  - sites 키는 `bound_api_key_id`가 NULL이다(partner-api-key.guard.ts:77-78†).
  - 지문이 있어야 키를 회전한 뒤에도 유출 키가 만든 결속을 식별할 수 있다.
- **collation**
  - `order_ref`는 `ascii_bin`이다. 기본 `utf8mb4_unicode_ci`는 대소문자와 후행 공백을 같게 보므로 쓰지 않는다.
  - `file_id`와 `site_id`는 files·sites의 collation과 일치해야 인덱스 조인이 된다. files·sites의 실제 collation은 추정이므로 S1에서 확인한다.
- **CHECK 강제**: MariaDB 11.2(운영)는 CHECK 제약을 강제한다(추정, 10.2 이후 문서 기준). S1에서 CHECK 위반 INSERT가 거부되는지 확인한다.
- **엔티티**: `files/entities/file-order-binding.entity.ts`에 둔다. synchronize는 development에서만 동작하므로 운영 스키마의 정본은 위 SQL이다.

### 5.2 `20260925_b_add_sites_orphan_mode.sql`

```sql
-- 사이트별 (a)안 모드 게이트 (additive, 기본 'off' = 배포 직후 동작 불변).
-- ⚠️ 이 컬럼은 Site 엔티티에 매핑하지 않는다(raw SQL 로만 읽음) — 매핑하면 컬럼 부재 시
--    sites 전 컬럼 조회(sites.service.ts:81-92)가 실패해 레거시·v1 전 파트너 인증이 끊긴다.
-- 순서: 5.1 과 같은 배포 창에서 SQL 먼저. 멱등: IF NOT EXISTS.
-- 롤백: 이 컬럼을 읽는 API 이미지를 먼저 되돌린 뒤(+nginx 재시작)
--       ALTER TABLE sites DROP COLUMN IF EXISTS orphan_terminal_validate_mode;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS orphan_terminal_validate_mode
  VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'off'
  CHECK (orphan_terminal_validate_mode IN ('off','dry','live'));
-- 확인: SELECT orphan_terminal_validate_mode, COUNT(*) FROM sites GROUP BY 1;  -- off=전체
```

- 모드 전환은 처음에는 운영자 SQL로만 한다. 오너 승인 기록을 남기고, 관리 UI는 후속이다(§11).
- `migrations/README.md`도 갱신한다.
  - 목록에는 3건만 올라 있다.
  - synchronize 위치가 :55로 적혀 있지만 실제는 :102다.

---

## 6. API 명세 (Partner API v1)

### 6.1 공통

- **컨트롤러**: `@PartnerV1Controller('files')`.
  - 모든 핸들러에 `@PartnerLiveOnly()`와 `@HttpCode(200)`을 붙인다.
  - `@PartnerLiveOnly`는 이 컨트롤러가 첫 사용처다(partner-live-only.decorator.ts:14†).
- **인증**: **`X-API-Key`만 보낸다.**
  - v1 가드는 Bearer와 X-API-Key가 둘 다 오고 값이 다르면 401을 낸다(partner-api-key.guard.ts:52-57†).
  - 허용 키: sites editor 키(env=live로 스탬프됨, :75-78†)와 v1 live partner key.
  - v1 test 키는 `403 ERR_ENV_MISMATCH`를 받는다.
- **역할**: 파일 조회 전에 `req.user.role !== 'editor'`이면 `403 ERR_FORBIDDEN`(`errors[].code='EDITOR_KEY_REQUIRED'`)을 낸다.
  - 파일을 조회하기 전에 판정하므로 존재 여부가 드러나지 않는다.
- **기능 플래그**: `ORDER_BINDING_ENABLED`는 `partner-api.config.ts`에서 파싱하고 기본값은 false다.
  - false면 `503 ERR_SERVICE_UNAVAILABLE`을 낸다.
  - 값을 바꾸려면 env 수정 → `docker compose up -d api`(컨테이너 재생성) → **nginx 재시작** → 헬스 확인 순서를 밟는다.
- **envelope**
  - 성공: `{success:true, message, data}`.
  - 실패: `{success:false, errorCode, message, errors[{code,message}], fieldErrors, requestId}`. 필드는 6개로 고정돼 있다(packages/types/src/index.ts:2417-2425†).
  - 파트너는 `errorCode`와 `errors[].code`로만 분기한다(:2349-2350†).
- **레이트리밋**
  - v1 general 버킷: 키당 300/min.
  - 전역 IP `ThrottlerGuard`(300/60s)가 **중첩 적용된다.** 코드 주석으로 확정된 사실이다(partner-rate-limit.guard.ts:20-21†).
  - 파트너 서버 IP 하나가 다른 Storige 호출과 버킷을 공유한다. 그래서 소급 결속 스크립트는 클라이언트 측에서 **60/min 이하**로 제한한다.

### 6.2 `POST /api/v1/files/{fileId}/order-binding`

- path: `fileId`는 UUID다(`ParseUUIDPipe`).
- body: DTO 클래스 `CreateOrderBindingDto`.
  - 전역 ValidationPipe가 whitelist와 forbidNonWhitelisted로 동작한다(main.ts:171-175).

| 필드 | 타입 | 규칙 |
|---|---|---|
| `orderRef` | string, 필수 | `@IsString() @Matches(/^[A-Za-z0-9_-]{1,32}$/)`. trim, 대소문자 변환, 숫자 변환을 하지 않는다 |
| `orderItemKey` | string, 선택 | 같은 패턴. `@IsOptional()`. 정보용 필드(D15) |
| 그 밖의 필드(`siteId` 등) | — | 400 `ERR_VALIDATION_FAILED` |

- `Idempotency-Key` 헤더는 **보내지 않는다**(D4).

### 6.3 응답 `data` (POST 결속, GET 공통)

```json
{
  "fileId": "uuid",
  "created": true,
  "fileState": "active",
  "fileExpiresAt": null,
  "warnings": [],
  "orderItemKeyMismatch": false,
  "binding": {
    "kind": "order",
    "orderRef": "string",
    "orderItemKey": "string|null",
    "boundAt": "2026-09-24T01:23:45.000Z"
  }
}
```

- 상태코드는 신규 결속과 no-op 모두 **200**이다. `created`로 둘을 구분한다.
- `boundAt`은 UTC ISO 8601이다. no-op이면 최초 결속 시각을 돌려준다.
- `fileExpiresAt`이 NULL이 아니면 `warnings`에 `'EXPIRY_SCHEDULED'`가 들어간다.
  - 결속은 만료를 해제하지 않는다.
  - 보존하려면 파트너가 §6.4로 `expiresAt:null`을 호출해야 한다.
- `fileState`는 `active`, `pending_deletion`, `soft_deleted`, `purged` 중 하나다. `purged`는 GET tombstone일 때만 나온다.

### 6.4 `POST /api/v1/files/{fileId}/order-binding/expiry` (결속 범위 만료, 권고 취소 경로)

- body DTO `SetBindingExpiryDto`
  - `orderRef`: 필수. §6.2와 같은 패턴.
  - `expiresAt`: ISO 8601 문자열 또는 `null`.
    - 미래 시각만 허용한다. 과거나 현재면 400이다.
    - `null`은 만료 해제다.
- 판정 순서
  1. 공통 판정: 역할, NULL-site, 사이트 일치(§7과 같다).
  2. 결속이 없으면 404 `ERR_NOT_FOUND/BINDING_NOT_FOUND`.
  3. `binding.site_id ≠ caller`이면 409 `ERR_FILE_ALREADY_BOUND/BINDING_SITE_MISMATCH`. 발생하면 안 되는 상태이므로 Sentry error로도 보낸다.
  4. `binding.order_ref ≠ 요청`이면 409 `ERR_FILE_ALREADY_BOUND/ORDER_REF_MISMATCH`.
  5. soft-deleted면 422 `PENDING_DELETION` 또는 `SOFT_DELETED`.
  6. 통과하면 `files.expires_at`을 설정한다.
- 응답 `data`: §6.3과 같은 모양이다(`created:false`, 갱신된 `fileExpiresAt`).
- 효과
  - :17 sweep이 만료된 파일을 softDelete하고, :47 purge가 48h 뒤 hardDelete한다(§8.4).
  - 결속 행은 tombstone으로 남는다.

### 6.5 `GET /api/v1/files/{fileId}/order-binding`

- 역할, NULL-site, 사이트 판정은 POST와 같다.
- 결속이 있으면 `binding.site_id === caller`도 요구한다.
- 파일 행이 없고(purge됨) 결속 행의 `site_id`가 호출자와 같으면 `200 fileState:'purged'`와 binding을 돌려준다. 이것이 tombstone 조회다.
- 그 외에는 404다.
- 결속이 없으면 `binding:null`이다.

### 6.6 상태코드와 에러코드 전체 표

- 신규 ErrV1 2종을 additive로 추가한다. 카탈로그 주석은 29종에서 31종으로 고친다.

| HTTP | errorCode | errors[].code | 조건 | 재시도 |
|---|---|---|---|---|
| 200 | — | — | 신규(`created:true`), no-op(`created:false`), 만료 설정 성공 | — |
| 400 | ERR_VALIDATION_FAILED | fieldErrors | 패턴 위반, 모르는 필드, UUID 오류, 과거 expiresAt | 불가 |
| 401 | ERR_UNAUTHORIZED | — | 키 없음·무효, Bearer와 X-API-Key 불일치 | 불가(키와 헤더 점검) |
| 403 | ERR_ENV_MISMATCH | — | v1 test 키 | 불가 |
| 403 | ERR_FORBIDDEN | EDITOR_KEY_REQUIRED | worker 역할 키 | 불가 |
| 404 | ERR_NOT_FOUND | FILE_NOT_FOUND | 파일 없음(hard-deleted 포함), 타 사이트 파일, 교차근거 없는 NULL-site 파일, soft-deleted NULL-site 파일 | 불가 |
| 404 | ERR_NOT_FOUND | BINDING_NOT_FOUND | (§6.4) 결속 없음 | 불가. 먼저 POST로 결속 |
| 409 | ERR_FILE_NOT_READY | FILE_PENDING_UPLOAD | `status='pending'` | 가능(유한, 3회 후 중단) |
| 409 | **ERR_FILE_ALREADY_BOUND**(신규) | ORDER_REF_MISMATCH | 이미 다른 orderRef로 결속됨. 기존 결속 유지 | 불가. GET으로 확인 |
| 409 | ERR_FILE_ALREADY_BOUND | BINDING_SITE_MISMATCH | 결속 사이트 ≠ 호출자(불변식 위반) | 불가. 운영 문의 |
| 409 | ERR_IDEMPOTENCY_IN_PROGRESS | — | 헤더를 보낸 경우에만 | 가능 |
| 422 | ERR_IDEMPOTENCY_KEY_MISMATCH | — | 헤더를 보낸 경우에만 | 불가 |
| 422 | **ERR_FILE_NOT_BINDABLE**(신규) | SITE_UNSTAMPED | NULL-site이면서 호출자 사이트의 교차근거가 있음 | 불가. 파트너 큐에 보관하고 백필 통지 후 재처리 |
| 422 | ERR_FILE_NOT_BINDABLE | PENDING_DELETION | 자사 파일이 soft-deleted이고 `expires_at` 있음(48h 안에 purge) | 불가. 즉시 운영 복구 요청(§8.7) |
| 422 | ERR_FILE_NOT_BINDABLE | SOFT_DELETED | 자사 파일이 soft-deleted이고 `expires_at` NULL(수동 삭제) | 불가 |
| 422 | ERR_FILE_NOT_BINDABLE | FILE_FAILED | `status='failed'` | 불가 |
| 429 | ERR_RATE_LIMITED | — | 키 버킷 초과(+Retry-After) 또는 전역 IP 버킷 초과 | 가능 |
| 500/503 | ERR_INTERNAL / ERR_SERVICE_UNAVAILABLE | — | 장애, 플래그 OFF | 가능(백오프) |

- 409 본문에는 기존 결속값을 싣지 않는다.
  - v1 오류 envelope는 필드 6개, `errors[]` 항목은 `{code,message}`로 고정돼 있어 구조화된 상세를 넣을 자리가 없다(index.ts:2417-2425†).
  - 기존 결속은 GET 한 번으로 확인한다.

### 6.7 멱등과 동시성

- **동일성 판정**: 결속 행이 있고, `site_id`가 호출자와 같고, `order_ref`가 요청값과 바이트 단위로 같으면 200 no-op이다.
  - `orderItemKey`는 판정에 쓰지 않는다(D15).
  - 저장값이 NULL이고 요청에 값이 있으면, 잠금 안에서 한 번만 채운다.
  - 저장값과 요청값이 둘 다 있고 다르면 `orderItemKeyMismatch:true`를 돌려주고 저장값은 바꾸지 않는다.
- **동시 요청**: files 행 `FOR UPDATE`로 직렬화한다.
  - 서로 다른 orderRef가 동시에 오면 정확히 1건만 `created:true`이고 나머지는 409다.
  - 같은 orderRef가 동시에 오면 1건은 `created:true`, 나머지는 `created:false`다.
- **Idempotency-Key**: 보내지 않는다. 보내면 404·409·422 같은 모든 4xx가 24h 동안 재생된다(partner-idempotency.interceptor.ts:137-145†). 가드 단계의 401/403은 인터셉터보다 먼저 던져지므로 캐시되지 않는다.

### 6.8 레이트리밋 요약

- 서버: 키 버킷 300/min과 IP 버킷 300/60s가 함께 적용된다.
- 파트너 측 권고
  - 같은 (파일, orderRef)는 5분에 1회.
  - 소급 결속은 60/min 이하.

### 6.9 파트너 재시도 분류 규칙 (GUIDE 명시)

- **재시도 불가** 판정은 `success:false`와 `errorCode`가 있는 v1 envelope를 받았을 때만 적용한다. 대상: 400, 401, 403, 404(FILE_NOT_FOUND·BINDING_NOT_FOUND), 409(ALREADY_BOUND), 422(NOT_BINDABLE).
- 다음은 전부 **재시도 가능**으로 처리한다.
  - envelope가 아니거나 `errorCode`가 없는 응답. 라우트 부재 시의 Nest 기본 404, nginx 502 HTML 등이 여기에 해당한다(추정: 전역 SentryExceptionFilter를 거친 기본 본문).
  - 5xx, 429, `ERR_SERVICE_UNAVAILABLE`.
- **404·409·422는 성공이 아니다.** 레거시 `DELETE external`의 '404=성공' 관례(CONTRACT_FREEZE.md:46†)를 이 API에 옮기지 않는다.

---

## 7. 서비스 로직

```ts
// FileOrderBindingService.bind(fileId, dto, caller)   caller = req.user
if (!cfg.orderBindingEnabled) throw v1(503, ERR_SERVICE_UNAVAILABLE)
if (caller.role !== 'editor') throw v1(403, ERR_FORBIDDEN, 'EDITOR_KEY_REQUIRED')      // ① 조회 전

// ② 비잠금 사전 판정 — 타 사이트·NULL 행에는 잠금을 걸지 않는다
const pre = await repo.createQueryBuilder('f').withDeleted().where('f.id = :id', { id: fileId }).getOne()
if (!pre) throw v1(404, ERR_NOT_FOUND, 'FILE_NOT_FOUND')
if (pre.siteId == null) {
  if (pre.deletedAt) throw v1(404, ERR_NOT_FOUND, 'FILE_NOT_FOUND')
  if (await hasSiteCorroboration(pre.id, caller.siteId))                                  // §7.1
       throw v1(422, ERR_FILE_NOT_BINDABLE, 'SITE_UNSTAMPED')
  throw v1(404, ERR_NOT_FOUND, 'FILE_NOT_FOUND')
}
if (pre.siteId !== caller.siteId) throw v1(404, ERR_NOT_FOUND, 'FILE_NOT_FOUND')

return dataSource.transaction(async (m) => {
  // ③ 자사 파일만 잠금(강등과 같은 순서: files → bindings)
  const f = await m.createQueryBuilder(FileEntity, 'f').withDeleted()
      .setLock('pessimistic_write').where('f.id = :id', { id: fileId }).getOne()
  if (!f || f.siteId !== caller.siteId) throw v1(404, ERR_NOT_FOUND, 'FILE_NOT_FOUND')   // 잠금 후 재확인
  if (f.deletedAt) throw v1(422, ERR_FILE_NOT_BINDABLE, f.expiresAt ? 'PENDING_DELETION' : 'SOFT_DELETED')
  if (f.status === 'failed')  throw v1(422, ERR_FILE_NOT_BINDABLE, 'FILE_FAILED')
  if (f.status === 'pending') throw v1(409, ERR_FILE_NOT_READY, 'FILE_PENDING_UPLOAD')
  // ④ 기존 결속(잠금 읽기)
  const b = await m.findOne(FileOrderBinding, { where: { fileId }, lock: { mode: 'pessimistic_write' } })
  if (b) return compareOrConflict(m, b, dto, caller, f)   // site 불일치 409+Sentry | ref 일치 200 noop(itemKey 1회 채움) | 409
  try {
    const nb = await m.save(FileOrderBinding, {
      fileId, siteId: caller.siteId, kind: 'order',
      orderRef: dto.orderRef, orderItemKey: dto.orderItemKey ?? null,
      boundKeySource: caller.apiKeyId ? 'partner' : 'sites',
      boundKeyFp: sha256(caller.apiKey).slice(0, 16), boundApiKeyId: caller.apiKeyId ?? null })
    log.info(`[binding] created site=${caller.siteId} ref=${dto.orderRef}`)
    return view(f, nb, true)
  } catch (e) {
    if (isDupEntry(e)) {                                   // ER_DUP_ENTRY 1062 — 방어적
      const again = await m.findOneOrFail(FileOrderBinding, { where: { fileId } })
      return compareOrConflict(m, again, dto, caller, f)
    }
    throw e
  }
})
```

### 7.1 교차근거 `hasSiteCorroboration(fileId, siteId)`

- NULL-site 파일이 호출자 사이트와 관련 있다는 근거를 **Storige 내부 데이터로만** 찾는다. 파트너가 제공한 값은 쓰지 않는다.

```sql
SELECT EXISTS (
  SELECT 1 FROM worker_jobs w
  WHERE w.site_id = :siteId AND (w.file_id = :fid OR w.output_file_id = :fid OR w.pdf_file_id = :fid)
) OR EXISTS (
  SELECT 1 FROM file_edit_sessions s
  WHERE s.site_id = :siteId AND s.deleted_at IS NULL
    AND (s.cover_file_id = :fid OR s.content_file_id = :fid OR s.content_pdf_file_id = :fid)
) AS corroborated;
```

- 근거가 되는 컬럼
  - `worker_jobs.site_id`: X-API-Key 호출 시 자동 주입된다(worker-job.entity.ts:92-98†).
  - `file_edit_sessions.site_id`: 세션 생성 시점 스탬프는 정상이다(FACTS).
- 편집기 산출물은 세션 근거로 확인된다. 업로드 경로 파일은 `/api/storige/validate`가 bookmoa 키로 만든 VALIDATE 잡의 site_id로 확인된다(추정: 해당 잡의 site_id 스탬프 여부는 S6 사전 점검 쿼리로 확인).
- 같은 판정을 백필 교차검증에도 쓴다(§10).

### 7.2 기타 규칙

- **잠금 순서**: bind, 결속 범위 만료, 고아 강등 모두 files 행을 먼저 잠그고 결속 행을 그다음에 본다. 순서가 같으므로 교착 사이클이 생기지 않는다(설계 추론).
- **부작용 금지**
  - bind는 `files.site_id`, `order_seqno`, `expires_at`을 쓰지 않는다.
  - `expires_at`은 §6.4에서만 쓴다.
- **로그**: `[binding] created|noop|conflict|rejected(<errors.code>)`를 한 줄씩 남긴다. fileId는 로그에 싣지 않고 사이트와 코드만 남긴다.
- **Sentry**: 5xx, `BINDING_SITE_MISMATCH`(error), `PENDING_DELETION`(warning)만 보낸다.

---

## 8. 수명주기 통합

### 8.1 고아 후보 쿼리: 결속 가드 (항상 적용, (a)안과 무관)

- files.service.ts의 세션 NOT EXISTS 절 다음, worker_jobs 절 앞(:670-694† 사이)에 다음 한 절을 추가한다.

```sql
AND NOT EXISTS (SELECT 1 FROM file_order_bindings b WHERE b.file_id = f.id)
```

- 삭제를 줄이는 방향의 변경이다.
- 검증은 같은 tick에 가드 있는 쿼리와 없는 쿼리를 나란히 실행해서 한다.
  - 차집합이 결속 파일의 부분집합이어야 한다.
  - 서로 다른 tick의 절대 건수로 비교하지 않는다. 96건이 2026-09-27부터 grace에 들어가 후보 수가 자연히 변한다.

### 8.2 강등의 원자적 재확인

- `softDeleteWithExpiry`(:736-745†)를 트랜잭션으로 바꾼다.

```ts
await m.query('SELECT id FROM files WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id])   // 없으면 false
const bound = await m.query('SELECT 1 FROM file_order_bindings WHERE file_id = ? LOCK IN SHARE MODE', [id])
if (bound.length) return false                                                                // skipped(결속)
await m.query('UPDATE files SET expires_at = NOW(), deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id])
```

- 잠금 읽기는 REPEATABLE READ에서도 최신 커밋본을 본다(추정, InnoDB 문서 기준). 그래서 bind가 커밋한 직후 들어온 강등도 결속을 본다.
- dry 로그(file-orphan.service.ts:103-108†)에 `site=${f.siteId ?? 'null'}`과 `pass=1|2`를 추가한다.

### 8.3 (a)안 사이트별 게이트: 2-pass

- **pass 1**은 현행 쿼리에 §8.1 가드만 더한 것이다.
  - 사이트 조건이 없고, 실삭제 여부는 기존 전역 dryRun(`envDryRun || retention.dryRun`)을 따른다.
- **pass 2**는 모드가 `dry` 또는 `live`인 사이트가 있을 때만 실행한다.
  - 대상은 (a)안으로 **새로 적격이 되는 파일만**이다.
  - 사이트 목록이 비어 있으면 pass 2를 생략한다. MySQL에서 `IN ()`은 문법 오류이기 때문이다.

```sql
-- pass 2 (modeSites = SELECT id FROM sites WHERE status='active' AND orphan_terminal_validate_mode IN ('dry','live'))
SELECT f.* FROM files f
WHERE f.order_seqno IS NULL AND f.deleted_at IS NULL
  AND f.site_id IS NOT NULL AND f.site_id IN (:...modeSites)            -- NULL-site 명시 배제
  AND <pass 1 과 동일한 status별 grace>
  AND NOT EXISTS (<pass 1 과 동일한 세션 참조>)
  AND NOT EXISTS (SELECT 1 FROM file_order_bindings b WHERE b.file_id = f.id)
  AND EXISTS (SELECT 1 FROM worker_jobs w WHERE ( <기존 참조 OR 목록 전체> ))   -- pass 1 이 제외한 파일만
  AND NOT EXISTS (
        SELECT 1 FROM worker_jobs w
        WHERE ( <기존 참조 OR 목록 전체> )
          AND NOT ( COALESCE(w.job_type,'') = 'VALIDATE'
                    AND COALESCE(w.status,'') IN ('COMPLETED','FAILED','FIXABLE') ))
ORDER BY f.created_at ASC LIMIT :batch
```

- **3값 논리 안전성**
  - 면제 술어에는 `f.site_id`가 들어가지 않는다.
  - `COALESCE`를 쓰므로 `NOT(...)`의 결과는 항상 TRUE나 FALSE다.
  - NULL-site는 바깥 WHERE의 `f.site_id IS NOT NULL`에서 이미 빠진다.
  - 초안은 `NOT(... AND f.site_id IN (...))` 형태였다. 이 경우 NULL-site 파일에서 NOT(NULL)=NULL이 되어 참조 행이 서브쿼리 WHERE를 통과하지 못하고, NOT EXISTS가 TRUE가 되어 **후보가 된다.** 이번 개정에서 이 형태를 폐기했다.
- 기존 참조 OR 목록(:695-720†)은 최상위 괄호 없이 OR만 나열돼 있다. 반드시 괄호로 감싼 뒤 AND를 붙인다.
- **pass 2 후보 처리**
  - 사이트 모드가 `dry`면 로그만 남긴다.
  - 사이트 모드가 `live`면 **전역 dryRun이 false일 때만** §8.2로 강등한다. 전역 dryRun이 true면 로그만 남긴다.
- **장애 격리**: pass 2 쿼리가 실패하면(컬럼 부재 등) Sentry로 알리고 pass 2만 건너뛴다. pass 1은 계속 돈다.
- **사이트별 dry 검증**: 배치 한도와 상관없이 사이트별 COUNT를 따로 실행해서 한다. 로그는 배치 200건으로 잘리기 때문이다(files.service.ts:722-723†).

### 8.4 명시적 만료, 보존 sweep, DELETE external, purge와의 관계 (미결 3)

- **결속은 명시적 만료를 막지 않는다(D8).** `findExpired`(files.service.ts:540-560†)는 변경하지 않는다.
- **권고 취소 경로**: bookmoa는 취소가 확정되면 §6.4 `order-binding/expiry {orderRef, expiresAt: 취소+N일}`을 호출한다.
  - 레거시 `POST /api/files/:id/expiry/external`도 FROZEN이므로 계속 허용한다.
  - 다만 레거시 경로는 orderRef를 확인하지 않으므로 결속 파일에는 v1 경로를 쓰라고 GUIDE에 적는다.
- **보존 sweep의 전제**: 전 사이트 `retention_days`가 NULL이다(FACTS). 따라서 결속 파일의 `expires_at`은 파트너가 명시적으로 호출해야만 생긴다. printy에 `retention_days`를 설정하지 않는다는 방침은 유지한다.
- **purge 가드**: 넣지 않는다.
  - 고아 강등은 §8.2가 원천 차단한다.
  - 명시 만료로 soft-delete된 파일은 의도대로 purge돼야 한다.
- **잔여 경로**: 미래 만료가 예약된 결속 파일을 회원이나 staff가 `DELETE /files/:id`로 soft-delete하면, 48h 뒤 purge된다. purge가 `expires_at IS NOT NULL`만 보기 때문이다(:572-582†).
  - 소유자의 의사이므로 이번 범위에서는 허용한다.
  - purge 조건에 `expires_at <= deleted_at`을 추가하는 것은 후속 결정 O17이다.
- **DELETE external**: 소유 사이트 editor 키라면 결속 파일도 삭제할 수 있다(FROZEN).
  - 타 사이트 editor 키는 기존 규칙대로 404다.
  - 파트너 worker 키는 W1 전까지 우회가 가능하다(§9 T4).
  - NULL-site 파일은 D6 전까지 누구든 통과한다.

### 8.5 재주문과 동일 파일 재사용 (미결 4)

- first-claim-wins이므로 한 파일은 하나의 orderRef에만 결속된다. 두 번째 주문의 결속 요청은 `409 ORDER_REF_MISMATCH`다.
- **서버 측 차단**: 첫 주문 A가 취소될 때 §6.4는 결속 orderRef가 A와 일치해야만 만료를 건다.
  - 다음 순서의 사고는 막지 못한다: A 취소 만료가 먼저 걸림 → 같은 파일로 주문 B를 만듦 → 파일은 A 만료대로 삭제됨.
  - 그래서 bind 응답과 GET의 `fileExpiresAt`·`EXPIRY_SCHEDULED` 경고로 재사용 시점에 위험을 드러낸다.
- **파트너 규칙**
  - 재주문은 새 파일(사본 업로드나 새 편집 산출물)을 쓴다.
  - 재사용이 불가피하면 bind 응답의 `EXPIRY_SCHEDULED`를 확인하고, 기존 주문 기준으로 `expiresAt:null`을 호출해 만료를 해제한 뒤 진행한다.
  - 409를 받은 파일에는 자기 주문의 취소 만료를 걸지 않는다.
- bookmoa가 취소 시 `order_asset_claims`를 해제하는지는 파트너 확인 항목이다(O16). 해제한다면 위 재사용 경로가 실제로 생긴다.

### 8.6 장바구니 공백 (미결 1)

- 결속은 주문된 파일만 덮는다. 다음 파일들은 결속되지 않는다.
  - 회원 장바구니 파일: 만료 정책이 없다. Storige 파일을 담은 카트 7개 중 3개가 30일을 넘었고, 최장은 95일이다.
  - 게스트 localStorage 장바구니 파일.
- 현재 상태는 안전하다. 모드가 `off`인 동안 bookmoa 파일은 VALIDATE 참조 덕분에 고아 후보에서 빠진다.
- **사이트 모드를 `live`로 올리는 조건(D9)**: 다음 셋을 모두 문서로 확인해야 한다.
  1. 파트너 장바구니 최대 보유 기간(회원과 게스트 모두, 파일 업로드 시각부터 계산)이 `FILE_ORPHAN_GRACE_READY_DAYS`(기본 30일, file-orphan.service.ts:45-46†)보다 짧다.
  2. **이미 있는** 장바구니 가운데 참조 중이지만 결속되지 않은 파일이 0건이다. 파트너가 실측해서 확인한다.
  3. `dry` 모드에서 사이트별 pass 2 후보를 전수 검토했다.
- bookmoa는 R-190이 확정되고 기존 장바구니가 정리될 때까지 `off`를 유지한다.
- 백필하면 장바구니 3건에 bookmoa 스탬프가 붙는다. 결속은 없으므로 `live` 전환 후 삭제 대상이 될 수 있다. 조건 2가 이를 차단한다. 백필에 포함할지는 O13이다.
- **대안(O10)**: `kind='cart_hold'`와 `hold_expires_at`을 도입한다. hold에서 order로 승격하는 의미론이 필요하므로 이번 범위 밖이다.

### 8.7 PENDING_DELETION 복구 런북 (운영, 오너 승인 DB 변경)

- `restore()`만 호출하면 `expires_at`(과거 시각)이 남아서 1시간 안에 다시 강등된다(:490-507†).
- 따라서 복구는 단일 UPDATE로 한다.
  - `UPDATE files SET deleted_at = NULL, expires_at = NULL WHERE id = ? AND deleted_at IS NOT NULL;`
  - 기대 affected는 1이다.
- 그다음 파트너에게 재결속을 요청한다.
- purge 주기가 48h이므로 `PENDING_DELETION` 경보에 대응하는 SLA는 24h 이내로 둔다.
- `restore()` 자체의 수정은 O18이다.

---

## 9. 보안과 위협 모델

| ID | 위협 | 통제 |
|---|---|---|
| T1 | NULL-site 청구 위조 | 결속을 거부하고 스탬프를 바꾸지 않는다(T6 선례). 백필은 교차근거를 요구하는 오너 승인 SQL로만 한다(§10) |
| T2 | 교차 사이트 결속·조회 | `file.site_id`와 `binding.site_id`가 모두 호출자와 같아야 한다. 불일치는 404로 숨긴다 |
| T3 | 재바인딩 세탁 | UNIQUE(file_id), `order_ref` 불변, 파트너용 해제 API 없음. **같은 사이트 안에서 고객 간 세탁은 Storige가 막을 수 없다.** 파트너가 최종 사용자의 소유를 확인한 뒤 호출한다(GUIDE 명시) |
| T4 | worker 키 우회 | 결속 표면은 editor 키만 받는다. **잔여 위험**: 레거시 download·DELETE·expiry와 worker-jobs·edit-sessions에서 파트너 worker 키가 테넌시를 우회한다(§1.5). 결속 파일도 예외가 아니다. W1(MODIFY-TARGET: `role==='worker'` 우회를 내부 `WORKER_API_KEY`로 한정)을 S5 전에 집행할 것을 권고한다. W1을 적용하면 타 사이트 파일은 editor 키와 똑같이 404가 된다(기존 은닉 의미). 새 404 거부는 생기지 않는다 |
| T5 | 내부 WORKER_API_KEY로 Default Site에 청구 | worker 역할이므로 403이다. NULL 거부가 2중 방어다 |
| T6' | test 키로 영구 결속 | `@PartnerLiveOnly`. 리플렉션 spec으로 고정한다(§12) |
| T7 | 열거 | fileId는 최종 사용자 이벤트(storige:completed)와 파트너 프런트에 노출되므로 비밀이 아니다. 통제 수단은 소유 판정, 키당 300/min 제한, 감사 로그(public-api-audit-log.entity.ts:11-49)다 |
| T8 | 존재 오라클 | `SITE_UNSTAMPED`는 호출자 사이트의 교차근거가 있을 때만 준다(§7.1). 그 밖의 NULL과 soft-deleted NULL은 404다. `PENDING_DELETION`·`SOFT_DELETED`·409는 자사 파일에만 나온다 |
| T9 | 강등과 결속의 경합 | §8.2 잠금 프로토콜 |
| T10 | 타 테넌트 행 잠금 간섭 | 비잠금 사전 판정을 통과한 자사 파일만 `FOR UPDATE`로 잠근다(§7 ②③) |
| T11 | 키 유출로 인한 결속 오염 | `bound_key_fp`와 `bound_key_source`로 유출 키가 만든 결속을 식별한다. 정정은 운영자 전용 감사 경로(O11)로 한다 |
| T12 | 문서 유출 | 설계서, GUIDE, 마이그레이션에 키 값과 파트너 file id를 적지 않는다 |

---

## 10. D6·백필과의 순서 의존

- **결속 API는 D6와 독립이다.** 신규 경로이고 자체 엄격 판정을 쓰기 때문이다.
- **편집기 산출물 스탬프 수정이 bookmoa 호출보다 먼저다.**
  - 대상 결함: 편집기 완료 파일과 세션완료 VALIDATE 잡이 site NULL로 저장된다(FACTS).
  - 이것을 먼저 고치지 않으면 새 주문 파일이 계속 `SITE_UNSTAMPED`가 되고, 백필 뒤에도 NULL이 계속 생긴다.
  - 수정이 늦어지면 bookmoa는 `SITE_UNSTAMPED` 파일을 큐에 보관하고, 백필 통지 뒤에 재처리한다(S5 진입 허용 조건).
- **NULL 생성은 편집기 경로만의 문제가 아니다.**
  - presigned complete는 shop-session이 없거나 위조됐거나 shop 토큰이 아니면 NULL로 저장한다(files.controller.ts:196-203†, :228-232†).
  - 게스트 compose-mixed와 render-pages 산출물도 NULL이다(CONTRACT_FREEZE.md:134†).
  - 사이트별 일일 신규 NULL 건수를 모니터링 지표로 둔다(§11).
- **백필(O3)**
  - 판정식: bookmoa가 넘긴 결속 목록 ∩ `site_id IS NULL` ∩ 교차근거(bookmoa)(§7.1).
  - **S6 직전에 재실측한다.** 2026-09-24 기준은 25건이다. CONTRACT_FREEZE.md:219†도 집행 전 재실측을 요구한다.
  - 교차근거가 없는 파일은 스탬프하지 않고 목록으로 보고한다. 오너가 개별 판단한다.
  - 편집기 산출물은 TENANCY §2-B'의 세션 역참조(파일 ← file_edit_sessions → session.site_id)로 함께 판정한다.
  - 실행은 단일 트랜잭션 UPDATE다. 조건은 `WHERE site_id IS NULL AND id IN (<재실측 목록>)`, 기대 affected는 재실측값이고 불일치하면 ROLLBACK한다.
  - 목록 스냅샷을 저장소 밖에 보관한다. 역UPDATE용이다.
  - 이 판정원(파트너 결속 목록 + 교차근거)은 TENANCY 문서 §2-B'(세션 역참조)와 다르다. 그래서 문서 보강이 필요하다. 문서의 실제 위치는 `.cursor/plans/TENANCY_S3_S4_DESIGN_2026-08-28.md:43-54`다(RECON; FACTS의 `docs/` 경로와 다르다).
  - 백필 직후 해당 파일은 bookmoa 키로만 조작할 수 있다(동 문서 :49-50).
- **소급 결속**
  - S5b: 이미 bookmoa로 스탬프된 결속 파일(2026-09-24 기준 48건)은 백필과 무관하게 먼저 결속한다.
  - S7: 백필 뒤 나머지 파일과 큐에 쌓인 `SITE_UNSTAMPED` 파일을 결속한다.
  - 대상은 고정 건수가 아니라 그 시점의 bookmoa 결속 목록 전체다. 장바구니 파일은 결속하지 않는다.
- **D6 게이트** 진입 조건
  1. bookmoa 결속 목록 가운데 NULL-site 0건.
  2. 게스트 compose-mixed NULL 산출물의 처리 방침을 오너가 결정.
  3. D6 거부 응답이 404가 아닌 구분 코드. '404=성공' 스크립트가 실패를 오기록하지 않게 하기 위해서다(FACTS). printy는 `notFoundUnconfirmed`로 완화했고, 100p·MD2Books는 미확인이다.

---

## 11. 관측, 감사, 관리자 가시성

- **감사**
  - v1 감사 로그는 요청 메타데이터와 `error_code` 단일 컬럼만 남긴다(public-api-audit-log.entity.ts:40-41). body와 `errors[].code`는 남지 않는다.
  - 결속의 증거는 테이블 자체가 보유한다: `site_id`, `order_ref`, `order_item_key`, `bound_key_source`, `bound_key_fp`, `bound_api_key_id`, `bound_at`.
  - 사유별 집계(SITE_UNSTAMPED, PENDING_DELETION 등)는 docker 로그의 `[binding] rejected(<code>)`로 한다.
- **운영 검증 SQL**(읽기 전용, 운영자 실행)
  - 분포: `SELECT site_id, COUNT(*) FROM file_order_bindings GROUP BY site_id;`
  - **경보(반드시 0)**, 결속 파일이 고아 강등된 경우: `SELECT COUNT(*) FROM file_order_bindings b JOIN files f ON f.id=b.file_id WHERE f.deleted_at IS NOT NULL AND f.expires_at = f.deleted_at;`
    - 고아 강등은 두 값을 같은 NOW()로 설정한다(:740†).
    - 명시 만료 sweep은 `deleted_at > expires_at`이 된다. 정확히 같은 타임스탬프가 우연히 나올 가능성은 무시한다(휴리스틱, O17에서 사유 컬럼으로 대체).
  - 명시 만료 대기: `… WHERE f.deleted_at IS NULL AND f.expires_at IS NOT NULL`
  - tombstone: `SELECT COUNT(*) FROM file_order_bindings b LEFT JOIN files f ON f.id=b.file_id WHERE f.id IS NULL;`
  - 신규 NULL 생성 추이: `SELECT DATE(created_at), COUNT(*) FROM files WHERE site_id IS NULL AND created_at >= ? GROUP BY 1;`
  - pass 2 사이트별 후보 수: §8.3 쿼리를 COUNT로 바꿔 실행.
- **Sentry**: 5xx, `BINDING_SITE_MISMATCH`(error), `PENDING_DELETION`(warning, 사이트와 건수만), `orphan-query-failed`(pass 1·2).
- **관리자(후속)**
  - admin 파일 상세에 결속 정보(orderRef, boundAt)를 보여 준다.
  - 사이트 모드 토글과 감사 로그를 추가한다(`sites/dto/site.dto.ts`는 이번에 읽지 않았으므로 미확인).
  - 파트너 쪽 '결속 누락' 표시는 파트너가 파생해서 만드는 값이다. 당사는 GET으로 확인을 지원한다.

---

## 12. 계약 동결 등재

- **v1 등록 게이트 4곳**
  1. `scripts/partner-openapi-surface.ts`의 컨트롤러 목록.
  2. 같은 파일의 provider stub.
  3. 같은 파일의 `REQUIRED_PATHS`.
  4. **`partner-v1-guarded.spec.ts`의 `V1_CONTROLLERS`**(:19-46†). 이 spec은 FS 전수 스캔 결과와 목록의 집합 일치를 단언하므로, 등재하지 않으면 red가 된다.
- **전용 리플렉션 단언**(guarded spec 확장 또는 §1-G 전용 spec)
  - 경로 `v1/files` + `:fileId/order-binding`, `:fileId/order-binding/expiry`.
  - 메서드.
  - `PARTNER_LIVE_ONLY_KEY=true`.
  - `@HttpCode(200)`.
  - 핸들러 존재.
- **ErrV1**: `ERR_FILE_ALREADY_BOUND`(409)와 `ERR_FILE_NOT_BINDABLE`(422)를 additive로 추가한다. 주석은 29종에서 31종으로 고친다(index.ts:2346†).
- **CONTRACT_FREEZE.md**
  - v1 절이 없으므로 **§1-G "Partner API v1 — file order binding"**을 신설한다.
  - 처음에는 ADDITIVE로 등재한다. bookmoa 가동 뒤 FROZEN으로 승격하되, **위 리플렉션 단언과 행동 spec을 게이트로 명시한다.**
  - 선례는 fix-bleed와 output-url이다(CONTRACT_FREEZE.md:136-138†). 두 선례는 contract-freeze.spec에 함께 등재됐다. v1은 그 spec의 import 대상이 아니므로 위 전용 단언으로 대신한다.
  - W1이 승인되면 §4.3에 파트너 worker 키 결함과 교정을 기록하고, MODIFY-TARGET 절차(소비처 근거, 파트너 4종 grep, 오너 승인; CONTRACT_FREEZE.md:17†)를 따른다.
- **contract-freeze.spec.ts**: v1은 대상이 아니다(:24-28). 이 설계로 레거시 라우트 메타데이터가 바뀌지 않으므로 변경하지 않는다.
- **GUIDE**
  - §1.7과 §5.1 표에 추가하고, 표면 규모를 16경로/22오퍼레이션에서 **18경로/25오퍼레이션**으로 갱신한다(GUIDE:209†).
  - :207 혼용 금지에 예외를 명시한다: "fileId 참조 라우트는 레거시 업로드 fileId를 참조할 수 있다. 결속 파일의 만료는 v1 결속 범위 만료를 권고하며, 레거시 `expiry/external`을 쓸 경우 두 envelope를 모두 처리해야 한다."
  - §6.9 재시도 분류 규칙을 넣는다.
  - "404·409·422는 성공이 아니다", "X-API-Key만 보낸다", "Idempotency-Key를 보내지 않는다"를 명시한다.
  - :75-76과 :83의 낡은 서술(editor 코드와 worker 코드가 같다, 파트너 키는 항상 자사 스코프다)을 정정한다.
- 레거시 Swagger allowlist(`swagger-partner-routes.ts`)는 v1 표면이므로 대상이 아니다.

---

## 13. 테스트 계획

### 단위: `file-order-binding.service.spec.ts` (판정 순서 표 기반)

- worker 역할(내부, 파트너) → 403.
- 파일 부재 → 404.
- NULL-site
  - 교차근거 있음 → 422 `SITE_UNSTAMPED`, 스탬프가 바뀌지 않았음을 단언.
  - 교차근거 없음 → 404.
  - soft-deleted → 404.
- 타 사이트 → 404이고 **잠금 쿼리가 호출되지 않음**.
- soft-deleted
  - `expires_at` 있음 → `PENDING_DELETION`.
  - `expires_at` 없음 → `SOFT_DELETED`.
- 상태: failed → 422, pending → 409.
- 같은 orderRef → 200 `created:false`, 최초 boundAt 반환.
- orderItemKey 처리
  - 저장값 NULL → 한 번만 채움.
  - 값이 다름 → 200과 `orderItemKeyMismatch:true`.
- 다른 orderRef → 409, 기존 행 불변.
- `binding.site_id ≠ caller` → 409 `BINDING_SITE_MISMATCH`.
- `expires_at`이 있는 파일 → `EXPIRY_SCHEDULED`.
- ER_DUP_ENTRY → 재조회 후 비교.
- 결속 범위 만료
  - orderRef 불일치 → 409.
  - 결속 없음 → 404 `BINDING_NOT_FOUND`.
  - 과거 시각 → 400.
  - null → 만료 해제.
- GET tombstone: 자사 → `purged`, 타사 → 404.

### DTO

- `"000123"`이 그대로 보존되고 숫자로 변환되지 않는다.
- 33자, 공백, 한글, `.`은 400이다.
- 모르는 필드 `siteId`는 400이다.

### 컨트롤러와 v1: `file-order-binding.v1.spec.ts`

- test 키 → 403 `ERR_ENV_MISMATCH`.
- 신규 결속과 no-op 모두 상태코드 200.
- envelope와 errorCode.
- 플래그 OFF → 503.
- Bearer와 X-API-Key 불일치 → 401.
- `REQUIRED_PATHS`와 `V1_CONTROLLERS`에 포함.

### 동시성 (실 MariaDB 통합 테스트; 하네스 유무는 가정 A5)

- 같은 파일에 다른 orderRef 2건을 병렬로 보내면 정확히 1건만 성공한다.
- bind와 `softDeleteWithExpiry`를 병렬로 돌렸을 때, 결속이 커밋되면 강등은 false여야 한다.

### 고아 쿼리 (실 MariaDB 필수, mock 불가)

- 결속 파일은 pass 1과 pass 2 모두에서 빠진다.
- 모드 사이트 목록이 비면 pass 2를 실행하지 않고, pass 1 SQL은 현행에 가드 한 절만 더한 것과 같다(스냅샷).
- **S10 진입 게이트**: NULL-site 파일 + 종료 VALIDATE 1건 + 비어 있지 않은 모드 목록 → 후보 0건.
- `job_type`이나 `status`가 NULL인 참조 행은 계속 참조로 유지된다.
- 비종료 VALIDATE나 다른 잡이 참조하면 여전히 제외된다.
- 괄호 회귀.
- pass 2 쿼리가 실패해도 pass 1은 계속 돈다.
- 모드 `dry` 사이트는 로그만 남긴다. 모드 `live` 사이트는 전역 dryRun이 true일 때 로그만 남긴다.

### 회귀

- 기존 files.service.spec.ts:84와 :91(NULL 통과, worker 통과)이 그대로 통과해야 한다. 이 설계는 `assertSiteAccess`를 변경하지 않는다.

### 마이그레이션

- 로컬 MariaDB 11.2에 두 번 적용해 멱등성을 확인한다.
- CHECK 위반 INSERT가 거부되는지 확인한다.
- 5.2 컬럼이 없는 상태에서 새 이미지를 띄워도 인증이 정상이어야 한다(엔티티 미매핑 검증).

---

## 14. 롤아웃 (순서 고정)

- 모든 env 전환은 다음 순서를 따른다: env 수정 → `docker compose up -d api`(재생성) → **nginx 재시작**(리터럴 proxy_pass IP 고정) → 헬스 확인.

| 단계 | 내용 | 진입 조건 | 검증 | 롤백 |
|---|---|---|---|---|
| S0 | 오너 결정 O1~O5, O9, O12, O14 확정. W1 결정 | — | 결정 기록 | — |
| S1 | 마이그레이션 5.1, 5.2 수동 적용 | S0. `SHOW CREATE TABLE files/sites`로 collation 확인 | `SHOW CREATE TABLE file_order_bindings`. 모드 전부 `off` | S2 미배포이거나 S2 롤백이 끝난 뒤에만 DROP(행 0건) |
| S2 | API 배포(플래그 OFF): 결속 코드, pass 1 가드, 강등 재확인, pass 2 틀, 로그 `site=`·`pass=`. `docker compose up -d --build api` + nginx 재시작 | S1 | `orphan-query-failed` 0건. 같은 tick에서 가드 유무 SQL 결과가 동일(결속 0건). 결속 라우트 503 | 이전 이미지 + nginx 재시작(S5 전까지만 허용) |
| S3 | 플래그 ON. 내부 테스트 사이트로 스모크. **준비**: 테스트 사이트용 v1 test 키 발급, editor와 worker 코드를 분리한 테스트 사이트 | S2 24h 무사고 | test 키 → 403 ENV_MISMATCH. worker 키 → 403. 비존재 → 404. 결속 → 200. 반복 → `created:false`. 다른 ref → 409. 만료 v1 동작. 이후 test 키 폐기 | 플래그 OFF(재생성 + nginx) |
| S4 | 편집기 산출물 site 스탬프 수정 배포(O4). W1 승인 시 같은 창에서 배포(권고) | S3 | 신규 편집기 완료 파일의 NULL 0건 | 이전 버전 |
| S5 | bookmoa 신규 주문 호출과 자가치유 가동. **S5b**: 이미 bookmoa로 스탬프된 결속 파일을 소급 결속(60/min 이하) | S3, §15 통지 완료, bookmoa의 editor 키 사용 확인(A1). S4 권고 선행이며, 미완이면 bookmoa `SITE_UNSTAMPED` 큐잉이 필수 | 로그의 사유별 집계(created, noop, 409, 422 code별). bookmoa가 제공하는 기간별 주문 파일 수와 created+noop 대조. S5b 대상(48건 기준 재실측) 전부 결속 | 플래그 OFF → 503(재시도 가능). **이미지 롤백 금지.** 데이터 유지 |
| S6 | 백필(O3): 재실측, 교차근거 확인, 단일 트랜잭션, 기대 affected=재실측값 | S4 완료, O3 승인, 사전 점검 쿼리(교차근거 있음/없음 건수) | 대상 NULL 0건. 교차근거 없는 파일 목록 보고 | 스냅샷 목록으로 `site_id=NULL` 역UPDATE |
| S7 | 소급 결속: 백필 파일과 `SITE_UNSTAMPED` 큐 재처리 | S6 | bookmoa 결속 목록(장바구니 제외) 전부 결속. `SITE_UNSTAMPED` 0건 | —(불변 기록. 정정은 O11) |
| S8 | D6 게이트(별도 설계) | S7. bookmoa 결속 목록의 NULL 0건. 게스트 NULL 방침 결정. 404가 아닌 구분 코드. 100p·MD2Books 통지 | 별도 | 별도 |
| S9 | 기본 고아 정리 실가동: `FILE_ORPHAN_DRY_RUN=0`(O7, (a)안과 무관) | pass 1 후보를 사이트별로 전수 검토(COUNT 집계 첨부). §8.2 배포 완료 | 강등 건수와 경보 SQL 0건 | env `'1'` 복귀(재생성 + nginx). 48h 안에 §8.7 런북 |
| S10 | 사이트별 (a)안: `off` → `dry` → 전수 검토 → `live` | 사이트 X의 §8.6 조건 3가지. §13 NULL-site 실 DB 게이트 통과. S9 완료(`live`가 실효를 가지려면) | 사이트별 pass 2 COUNT와 강등 로그. 경보 SQL 0건 | 사이트 모드를 `off`로(SQL, 즉시 반영) |

---

## 15. 파트너 통지 요지

### bookmoa

- 엔드포인트 3개, DTO, 응답, 에러표(§6)를 전달한다.
- 호출 규칙
  - **editor 키만, X-API-Key 헤더만** 쓴다. Authorization 헤더를 함께 보내지 않는다.
  - **Idempotency-Key를 보내지 않는다.** 주문 replay 키를 파생해 쓰는 것도 금지한다. 보내면 4xx가 24h 재생된다.
  - orderRef는 문자열 그대로 보낸다. orderItemKey는 정보용이다.
- 재시도 분류(§6.9)
  - envelope의 errorCode가 있을 때만 재시도 불가로 판정한다.
  - 409는 기존 결속이 유지된다는 뜻이다. 기존 값은 GET으로 확인한다.
  - `SITE_UNSTAMPED`는 큐에 보관하고, 백필 통지 뒤 재처리한다.
  - `PENDING_DELETION`은 즉시 운영에 연락한다(48h).
  - `SOFT_DELETED`와 `FILE_FAILED`는 자가치유 대상에서 뺀다.
- 취소 보존은 `POST …/order-binding/expiry {orderRef, expiresAt: 취소+N일}`로 한다(N은 O5).
- 재사용
  - 재사용 전에 `EXPIRY_SCHEDULED`를 확인한다.
  - 409를 받은 파일에는 만료를 걸지 않는다.
  - 취소할 때 `order_asset_claims`를 해제하는지 회신을 부탁한다(O16).
- 소급 결속은 60/min 이하로 한다. 스탬프된 파일은 S5b에서, 나머지는 백필 통지 뒤 S7에서 처리한다.
- 결속은 사이트 단위 소유만 확인한다. 최종 사용자가 그 파일을 소유하는지는 bookmoa가 확인한 뒤 호출해야 한다.
- (a)안 `live` 전환은 R-190 확정과 기존 장바구니 정리가 끝난 뒤 협의한다.

### printy

- 현재 Storige 자산이 0건이므로 호출은 선택이다. 업로드를 시작하면 주문 뒤 결속 호출을 권고한다.
- worker 키로는 결속할 수 없다.
- `retention_days`를 설정하지 않는다는 방침은 유지한다.
- 키 유효성 확인 방식은 바뀌지 않는다.
- W1이 승인되면 worker 키의 타 사이트 접근이 막힌다. printy는 editor 키만 쓰므로 영향이 없다(추정).

### 미확인 파트너 (100p, MD2Books)

- 기존 계약 변경은 없다.
- 결속 API의 404는 성공이 아니다.
- (a)안은 기본 `off`다.
- W1과 D6에 따른 파괴 연산 응답 변경은 사전에 따로 통지한다.

---

## 16. 오너 결정 목록

| ID | 결정 | 선택지 | 권고 | 영향 |
|---|---|---|---|---|
| O1 | 결속 API 신설과 표면 | v1 / 레거시 | v1(D1) | 신규 키 불필요. GUIDE와 FREEZE 갱신 |
| O2 | (a)안 채택 방식 | 전역 / 사이트 모드 / 불채택 | 사이트 모드 2-pass(D9) | 전역 채택은 25건 즉시 삭제 |
| O3 | 백필 | 재실측 + 교차근거 / 고정 25 / 보류 | 재실측 + 교차근거 | D6 선행 조건. 교차근거 없는 파일은 개별 판단 |
| O4 | 편집기 산출물 스탬프 수정 | S5 전 / 후 | S5 전 | 새 NULL 생성 차단 |
| O5 | 취소 후 보존 N일 | 기본 90 / 기타 | 90 | 분쟁 대비 보존 비용 |
| W1 | 파트너 worker 키 역할 교정(MODIFY-TARGET) | S5 전 / D6와 묶음 / 보류 | S5 전 | 영향 지점 8곳 전수 검토. 결속 파일 보호의 잔여 위험 해소 |
| O7 | 기본 고아 정리 실가동(`DRY_RUN=0`) | 별도 승인 / 보류 | 별도 승인(S9) | 전 사이트 pass 1 실삭제 |
| O8 | soft-deleted 파일 자동 복구 | 런북 / 자동 | 런북(§8.7) | 자동 복구는 경합과 감사를 다시 설계해야 함 |
| O9 | NULL-site 노출 정책 | 교차근거 조건부 422 / 항상 404 / 항상 422 | 교차근거 조건부 | 오라클 차단과 진단 가능성의 균형 |
| O10 | `cart_hold` 예약 결속 | 보류 / 도입 | 보류(옵트인 전제로 대체) | 도입 시 승격 의미론 필요 |
| O11 | 운영자 결속 정정(unbind/rebind) | 운영자 전용 감사 경로 / 없음 | 운영자 전용, 후속 | 유출 키나 오류로 생긴 결속 정정 |
| O12 | 결속 FK | 없음 + tombstone / CASCADE | 없음 + tombstone | 분쟁 이력 보존 |
| O13 | 장바구니 3건 백필 포함 | 포함 / 제외 | 포함 + §8.6 조건 2 | 제외 시 NULL로 남음(D6 대상) |
| O14 | 결속 범위 만료를 같은 릴리스에 출시 | 동시 / 후속 | 동시 | 재사용 오취소 차단, v1 수명주기 완결 |
| O15 | CONTRACT_FREEZE §1-G 등재 등급 | ADDITIVE→FROZEN / 별도 문서 | ADDITIVE→FROZEN | 리플렉션과 행동 spec 게이트 |
| O16 | bookmoa 취소 시 claims 해제 여부(파트너 확인) | — | 확인 요청 | 재사용 경로 존재 여부 |
| O17 | purge에 `expires_at <= deleted_at` 조건 추가, 강등 사유 컬럼 | 후속 / 보류 | 후속 | 수동 삭제 + 미래 만료 파일의 조기 purge 방지 |
| O18 | `restore()`의 `expires_at` 초기화 결함 수정 | 후속 / 보류 | 후속(우선순위 높음) | 복구 뒤 재강등 방지 |

---

## 17. 미해결과 가정

- **A1(가정)**: bookmoa 서버는 editor 역할 키를 쓴다. worker 전용 키라면 S5 전에 키 정책을 조정해야 한다.
- **A2(추정)**: v1에 프로덕션 호출자가 있는지는 `public_api_audit_logs` 집계로만 알 수 있다. 권고에는 영향이 없고 §1-G 등재 등급에만 영향이 있다.
- **A3(확정, 초안의 추정을 정정)**
  - 전역 IP ThrottlerGuard가 v1에도 중첩 적용된다(partner-rate-limit.guard.ts:20-21†).
  - 모든 4xx는 멱등 스냅샷 대상이다(partner-idempotency.interceptor.ts:137-145†).
- **A4(추정)**: files·sites의 collation은 `utf8mb4_unicode_ci`로 추정한다. S1에서 확인한다.
- **A5(가정)**: 동시성과 고아 쿼리 검증용 실 DB 테스트 하네스가 있는지 모른다. 없으면 S10 게이트는 로컬 MariaDB 수동 검증 절차로 대체하고 결과를 기록한다.
- **A6(가정)**: bookmoa의 레거시 orderRef 50건(15자리 32 + 다른 길이 숫자 17 + 비숫자 1)이 모두 패턴에 맞는다. 맞지 않는 건은 bookmoa가 미리 보고한다.
- **A7(추정)**: 업로드 경로 NULL 파일의 VALIDATE 잡 `site_id`가 bookmoa로 스탬프돼 있어야 교차근거가 성립한다. S6 사전 점검에서 교차근거 없는 건수로 드러난다.
- **A8(추정)**: 라우트가 없을 때 Nest 기본 404 본문이 나온다(v1 필터는 컨트롤러 단위로 바인딩됨, partner-v1.decorator.ts:43†). §6.9 규칙이 이를 재시도 가능으로 흡수한다.
- **후속 보고 항목**(이번 범위 밖)
  - W1 파트너 worker 키 우회(보안, 최우선).
  - O17, O18.
  - `UploadFileDto.orderSeqno` 문서의 오해 소지(upload-file.dto.ts:24-31).
  - migrations/README 노후화.
  - GUIDE:75-83 낡은 서술.
  - 게스트 compose-mixed·render-pages NULL 스탬프.

---

## 부록 A. 검토 반영 기록

| 지적 id | 관점 | 심각도 | 처리 | 요지 |
|---|---|---|---|---|
| L1 | dataloss | blocker | applied | (a)안 게이트 SQL의 3값 논리 오류로 NULL-site가 후보가 되는 결함. 2-pass, `f.site_id IS NOT NULL`, COALESCE로 해소. 실 DB 게이트를 S10 진입 조건으로 둠(§8.3, §13) |
| SEC-1 | security | major | applied | G3를 결속 표면 한정으로 재서술. 레거시 worker 우회는 잔여 위험으로 명시하고 W1을 S5 전 집행 권고로 둠(§2, §9 T4, §16) |
| SEC-2 | security | major | applied | O6의 404 거부 폐기(D16). W1로 대체해 새 404 거부가 생기지 않음 |
| SEC-3 | security | major | applied | SITE_UNSTAMPED는 교차근거가 있을 때만, 그 외와 soft-deleted NULL은 404(§7.1, T8) |
| SEC-4 | security | major | applied | 백필 재실측, S4(스탬프 수정) 선행, 세션 역참조, 게스트 NULL을 S8 조건으로(§10, §14) |
| SEC-5 | security | minor | applied | 백필에 Storige 내부 교차근거 필수. 근거 없는 파일은 제외하고 보고(§10) |
| SEC-6 | security | minor | partially | 키 지문, 출처 컬럼, 동일 사이트 세탁 한계 명시는 반영. 운영자 unbind는 O11로 이관 |
| SEC-7 | security | minor | applied | 비잠금 사전 판정 후 자사 파일만 FOR UPDATE(§7 ②③, T10) |
| SEC-8 | security | minor | applied | A3 확정으로 정정. S7 60/min, Idempotency-Key 금지 |
| SEC-9 | security | minor | applied | GET과 no-op에서 `binding.site_id` 재확인, BINDING_SITE_MISMATCH 추가 |
| L2 | dataloss | major | partially | 응답에 `fileExpiresAt`·`EXPIRY_SCHEDULED` 추가, §8.7 런북(expires_at=NULL 포함). `restore()` 코드 수정은 O18로 이관 |
| L3 | dataloss | major | applied | 결속 범위 만료를 권고 경로로 승격(D14). claims 해제 여부 확인(O16). 재사용 절차 명시 |
| L4 | dataloss | major | applied | 모드 off/dry/live로 전역 env와 분리. 기본 고아 실가동은 S9·O7로 분리. 사이트별 COUNT 검증 |
| L5 | dataloss | major | applied | 옵트인 조건에 '기존 장바구니 미결속 0건' 추가. 장바구니 3건 백필 포함 여부는 O13 |
| L6 | dataloss | major | applied | 스탬프 수정을 bookmoa 호출 앞으로, 백필 재실측, 큐 재처리(S4~S7) |
| L7 | dataloss | minor | applied | 경보 SQL을 `expires_at = deleted_at`으로 교정(§11) |
| L8 | dataloss | minor | partially | bind에서 PENDING_DELETION과 SOFT_DELETED 구분은 반영. purge 조건 보강은 O17로 이관 |
| L9 | dataloss | minor | applied | S2 검증을 같은 tick의 가드 유무 SQL 비교로 교체 |
| L10 | dataloss | minor | applied | GET에서 자사 tombstone을 `fileState:'purged'`로 조회 |
| F1 | contract | major | applied | O6 폐기. W1은 MODIFY-TARGET으로 재분류. D1 ⑥ 표현을 결속 표면 한정으로 정정 |
| F2 | contract | major | applied | env 전환마다 재생성과 nginx 재시작 명시(§14 머리말, D13) |
| F3 | contract | major | applied | `DRY_RUN=0`을 S9로 분리하고 사이트 모드와 독립 |
| F4 | contract | major | applied | 모드 컬럼은 엔티티 미매핑(raw SQL). 롤백은 API 먼저, DROP 나중 |
| F5 | contract | major | applied | §6.9 envelope 기반 재시도 분류. S5 이후 이미지 롤백 금지 |
| F6 | contract | major | applied | 백필 기대치는 S6 재실측값. S7 대상은 목록 전체 |
| F7 | contract | major | applied | partner-v1-guarded.spec 등재, LiveOnly·HttpCode 리플렉션 단언 추가(§12) |
| F8 | contract | minor | applied | S2 검증을 쿼리 오류 0 + 같은 tick 비교로. 가드 효과 검증은 S5 이후 |
| F9 | contract | minor | applied | 사유별 집계는 로그, 주문 수는 bookmoa 제공값으로 명시(§11, §14) |
| F10 | contract | minor | applied | 스냅샷 동작 확정, Idempotency-Key 금지로 격상 |
| F11 | contract | minor | applied | 플래그 파싱 위치를 `partner-api.config.ts`로 지정 |
| F12 | contract | minor | applied | 결속 범위 만료로 v1 수명주기 완결, GUIDE 예외 범위 명시 |
| F1 | partner | major | applied | orderItemKey를 동일성에서 제외, NULL은 1회 채움, 불일치는 플래그(D15) |
| F2 | partner | major | applied | O6 폐기, W1 대체(SEC-2와 동일) |
| F3 | partner | major | applied | presigned NULL 경로 명시, 반복 가능한 백필 판정식, 422 큐잉, D6 진입 조건, NULL 모니터링 |
| F4 | partner | minor | applied | A3 확정. replay 키 재사용 금지 통지 |
| F5 | partner | minor | partially | T8의 오판 근거는 정정. v1 오류 envelope가 6필드·`{code,message}`로 고정돼(index.ts:2417-2425) 409에 구조화된 기존 결속을 넣을 수 없어 GET 1회 유지 |
| F6 | partner | minor | applied | `@HttpCode(200)` 명시와 상태코드 spec |
| F7 | partner | minor | applied | S5b(스탬프분, S3 이후)와 S7(백필분)로 분리 |
| F8 | partner | minor | applied | PENDING_DELETION을 Sentry warning으로, 24h SLA 런북 |
| F9 | partner | minor | applied | X-API-Key만 사용하도록 통지·GUIDE 명시 |
| F10 | partner | minor | applied | S3 준비에 v1 test 키 발급·폐기, 분리 키 테스트 사이트 추가 |
