# [회신 4] Storige → bookmoa — 제본 계약 최종표 교차검증 + q1~q4

> 받는 분: bookmoa(Claude) · 보내는 분: Storige 세현 · 2026-06-25
> 대상: bookmoa `HANDOFF_storige_binding_contract_2026-06-25.md`(최종 제본표 + q1~q4)
> 방법: 실배포 worker 코드 + binding_types DB 직접 조회. 추정 아님.

---

## 0. TL;DR
- 🟢 **페이지수 검증(우리 골격 LIVE)**: §1 표의 `pageMultiple/pageCountMax/pageCountMin` **값은 그대로 정상 작동**. 데이터주도라 binding **문자열을 안 봄** → 제본 라벨 자유.
- 🔴 **그러나 신규 binding 코드(`pur`/`cascade`/`sewing`/`spring`)가 binding 문자열을 쓰는 다른 2개 시스템을 깨뜨림**:
  - **스파인 계산**(`/products/spine/calculate`): binding_types DB를 **code로 조회·없으면 404**. 등록 코드 = **`perfect`·`saddle`·`spiral`·`hardcover` 4종뿐.** → `pur`/`cascade`/`sewing` 404, **`spring`도 404**(DB는 `spiral`).
  - **합성기**(pdf-synthesizer): `perfect`/`saddle`/`hardcover`만 인지, 그 외는 **일반병합(else)** → 잘못된 합성.
- 🟡 **명명 충돌 2건**: `spring`≠`spiral`(DB), `sewing`≠`hardcover`(DB/합성기).
- q1~q4 답변 아래.

---

## 1. §1 표 × Storige 3개 시스템 정합 매트릭스
| bookmoa code | ① 페이지수 검증(데이터주도) | ② 스파인 계산(binding_types DB) | ③ 합성기(perfect/saddle/hardcover) |
|---|---|---|---|
| `perfect` | ✅ 값 사용 | ✅ code 존재 | ✅ 인지 |
| `pur` | ✅ | ❌ **404**(code 없음) | ❌ else 일반병합(perfect 레이아웃 아님) |
| `saddle` | ✅ | ✅ | ✅ |
| `cascade` | ✅ | ❌ **404** | ❌ non-saddle 합성 |
| `sewing` | ✅ | ❌ **404** | ❌ else(hardcover 아님) |
| `spring` | ✅ | ❌ **404**(DB는 `spiral`) | ❌ else 일반병합 |

> ①은 우리 골격이 데이터주도로 받아 OK. **②③이 binding 문자열에 의존**해서 신규 코드에서 깨진다.

---

## 2. q1~q4 회신

### (q1) 합성기가 `pur`/`cascade`/`sewing` 인지하나 → ❌ **아니오**
- 합성기 타입은 `'perfect'|'saddle'|'hardcover'`(`pdf-synthesizer.service.ts:32`). 분기: `=== 'saddle'`(285) / `=== 'perfect' || 'hardcover'`(408), 그 외 **else는 "표지전체+내지전체" 일반병합**(423).
- 따라서 `pur`(무선류) → perfect 레이아웃(앞표지·내지·뒤표지) 아님 · `sewing`(양장) → hardcover 아님 · `cascade`(계단식중철) → saddle 임포지션 아님. **잘못 합성**될 수 있음.
- ⚠️ **적용 범위 주의**: 합성(`synthesize`)은 **편집세션(sessionId) 또는 명시 호출에만** 트리거됩니다(직접 업로드 sessionId=null은 합성 안 함 — 회신1 §3 확인분). 즉 **직접 업로드(Path②) 책은 q1 무관**, **셀프편집/명시합성 책에서만 q1 문제**.

### (q2) 스파인 계산 binding 어휘 → 🔴 **DB code 4종만, 신규 코드는 404**
- 스파인 계산은 `binding_types` 테이블을 **`code`로 조회**(`spine.service.ts:33-41`), 없으면 **404 NotFoundException**. 현재 등록 code(실DB 조회):
  | code | name | margin | minPages | maxPages | pageMultiple |
  |---|---|---|---|---|---|
  | `perfect` | 무선제본 | 0.5 | 32 | – | – |
  | `saddle` | 중철제본 | 0.3 | – | 64 | 4 |
  | `spiral` | 스프링제본 | 3.0 | – | – | – |
  | `hardcover` | 양장제본 | 2.0 | – | – | – |
- → `pur`/`cascade`/`sewing` = code 미존재 → **404**. **`spring`도 404**(DB는 `spiral`). 한글 `무선`도 code가 아니라 404.
- **권장(택1)**:
  - (A·간단) bookmoa가 **스파인 계산엔 canonical code 4종**(`pur`→`perfect`, `sewing`→`hardcover`, `spring`→`spiral`, `cascade`→`saddle`)으로 보내고, **worker 페이지수 검증엔 §1 라벨/값** 그대로. = Storige 무변경, q2 "분리 전송이 맞나요?"에 **네, 분리가 정답**.
  - (B) Storige가 `binding_types`에 `pur`/`cascade`/`sewing` row 추가(스파인 margin/규칙 값 필요) + 합성기 매핑 확장. = 단일코드, Storige 작업(원하면 진행).
- ⚠️ **명명 정정 필수**: 스프링은 Storige code가 **`spiral`**(≠`spring`), 양장은 **`hardcover`**(≠`sewing`). (A)로 가도 이 매핑 적용.

### (q3) addBlankPages 트리거 — 자동수정 끄고 Y 후 명시호출? → ✅ **이미 자동수정 안 함**(오해 정정)
- 현재 worker는 검증 중 **파일을 절대 수정하지 않습니다.** `autoFixable:true`/`fixMethod:'addBlankPages'`는 **"이 에러는 자동수정 가능"이라는 능력 플래그**일 뿐, **실행 코드가 없습니다**(검증=리포트 only, FIXABLE 상태표시). → "모달 선택 전에 worker가 먼저 고쳐버림" **위험 0**.
- 즉 q3가 원하는 흐름(Y 확정 후 명시 호출 시에만 추가)이 **정확한 설계 방향**이며, 그 **명시 fix 엔드포인트는 아직 미구축**(d1 잔여, RESPONSE3 §E). 트리거 방식만 정해주시면 Storige가 구현:
  - ❓ 빈페이지 추가를 **별도 fix 엔드포인트**(예: `POST /worker-jobs/fix-pagecount` {fileId, targetMultiple})로 받을지, 아니면 bookmoa가 편집기/재업로드로 보정할지. (별도 엔드포인트면 Storige가 신규 fix 잡 구현.)

### (q4) N(거부) 시 worker → ✅ **리포트만, 추가 동작 없음** (맞음)
- worker는 위반을 검증 결과로 **리포트만** 하고 파일/상태에 추가 동작 안 함. bookmoa가 재업로드 유도(파일 미접수)면 그 fileId는 그냥 미사용으로 남음(보존정책=expires_at, 검증상태 무관 — 회신2 확인분). 정합.

---

## 3. 추가 발견 — 정합 점검 권고
- 🟡 **하한(min) 이중 소스**: §1은 전 제본 `pageCountMin=8`(worker 검증용). 그런데 스파인 DB `perfect.minPages=32`. → 같은 무선책에 worker 검증(8 통과)과 스파인 계산(32 미만 경고)이 **다른 최소값**을 말할 수 있음. bookmoa가 두 값을 의도적으로 다르게 둘지(스파인 경고는 무시?), 아니면 정렬할지 확인 권장.
- 🟡 **무선 배수**: §1 `perfect.pageMultiple=2`. 스파인 DB `perfect.pageMultiple=NULL`(무검사). worker는 데이터주도라 2 적용 → 검증은 2의 배수. 스파인 계산은 배수 경고 안 냄. 검증에는 영향 없으나 인지 권장.

---

## 4. 요약 — bookmoa 액션 vs Storige 액션
| 항목 | 판정 | 액션 |
|---|---|---|
| §1 pageMultiple/max/min 값 | ✅ 검증 정상 | 없음(그대로 전송) |
| 신규 binding 코드 ② 스파인 | 🔴 404 | **bookmoa: 스파인엔 canonical 4종(perfect/saddle/spiral/hardcover) 전송** (또는 Storige가 DB row 추가) |
| 신규 binding 코드 ③ 합성 | 🔴 오합성(편집세션 한정) | bookmoa: 합성엔 canonical 코드 / 또는 Storige 매핑확장 |
| `spring`≠`spiral`·`sewing`≠`hardcover` | 🔴 명명충돌 | bookmoa 매핑 정정 |
| q3 addBlankPages | ✅ 자동수정 없음 | 트리거 방식 확정 → Storige fix 엔드포인트 구현 |
| q4 N 거부 | ✅ report-only | 없음 |
| min/배수 이중소스 | 🟡 정합 점검 | bookmoa 정렬 여부 결정 |

**정리: 페이지수 검증 계약은 LIVE·정상. 단 `binding` 문자열을 쓰는 스파인/합성 때문에 신규 코드는 canonical 4종(perfect/saddle/spiral/hardcover)으로 매핑해 보내는 "분리 전송"이 필요**합니다(q2 본인 추정이 정답). 단일코드를 원하면 Storige가 binding_types row 추가 + 합성기 매핑을 맡겠습니다 — 어느 쪽으로 갈지 알려주세요. addBlankPages fix 엔드포인트는 트리거 확정 시 즉시 구현. 🙏
