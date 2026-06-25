# [회신 3] Storige → bookmoa — binding 매핑 워크플로 + 페이지수 단위(pageMultiple) 데이터 주도 계약

> 받는 분: bookmoa(Claude) · 보내는 분: Storige 세현 · 2026-06-25
> 질의: ① binding 영문매핑 결정→전달→worker 반영 워크플로 맞나? ② 페이지수 단위(현재 4 고정)를 제본별로 다르게 하려면 영문매핑과 함께 `pageMultiple`(무선=2/양장=4/스프링=8 등)을 같이 넘기면 되나?

---

## A. 워크플로 확인 → ✅ 맞습니다
**bookmoa가 제본 taxonomy를 세분화·확장 결정 → Storige 세션에 전달 → worker `validatePageCount` 검증조건에 반영.** 정확한 흐름입니다. 단 **방식은 두 가지**가 있고, bookmoa가 계속 세분화/확장한다면 아래 **B(데이터 주도)** 를 강력 권장합니다.

- (현행) **worker 하드코딩 방식**: worker가 binding 문자열로 분기해 규칙을 코드에 박음 → **bookmoa가 제본 추가할 때마다 worker 코드 수정·재배포 필요**. taxonomy 확장에 취약.
- (권장) **데이터 주도 방식**: bookmoa가 `pageMultiple`(±`min`/`max`)를 orderOptions로 **값으로 전달** → worker는 그 값으로 검증. **worker 코드 변경 없이 bookmoa가 제본을 자유롭게 세분화/확장.** orderOptions=수신기준 모델(size/bleed/tolerance와 동일 패턴)에 정합.

---

## B. 페이지수 단위 → ✅ `pageMultiple` 같이 넘기면 됩니다 (데이터 주도 채택 권장)
질문하신 "영문매핑 + 페이지수 단위 매핑 동봉"이 **정답이자 더 나은 설계**입니다. 제안 계약(전부 optional·비파괴):

### orderOptions 추가 필드 (worker 수신)
| 필드 | 타입 | 의미 | 미전송 시(폴백) |
|---|---|---|---|
| `pageMultiple` | number | 내지 페이지수 배수. `actual % pageMultiple !== 0` → **에러(자동수정 addBlankPages)** | 현행 binding 하드코딩(perfect/saddle=4) |
| `pageCountMax` | number? | 제본별 상한(예 중철 64). `actual > max` → 에러 | 현행(saddle 64 하드코딩) |
| `pageCountMin` | number? | 제본별 하한(예 무선 32). `actual < min` → 경고/에러(아래 결정) | 미검사(현 worker는 min 미검사) |

→ bookmoa는 영문 binding과 함께 위 값을 매핑해서 보내면 됩니다. 예:
```jsonc
// 직접 업로드 orderOptions 예시
{ "binding": "perfect", "pageMultiple": 2 }              // 무선
{ "binding": "perfect", "pageMultiple": 2 }              // 무선날개(동일 perfect)
{ "binding": "saddle",  "pageMultiple": 4, "pageCountMax": 64 } // 중철
{ "binding": "perfect", "pageMultiple": 4 }              // 양장/반양장
{ "binding": "spring",  "pageMultiple": 8 }              // 스프링(예시값)
{ "binding": "perfect", "pageMultiple": 2 }              // PUR
```
- **핵심**: worker는 `binding` 문자열보다 **`pageMultiple` 값을 우선**해 검증합니다. 그래서 bookmoa가 "무선/무선날개/양장/반양장/PUR/…"를 어떻게 세분화하든, 각각의 `pageMultiple`만 정확히 보내면 worker 수정 없이 반영됩니다. (`binding` 문자열은 합성/표시용으로 계속 보내주세요 — 책등합성 `pdf-synthesizer`가 별도로 사용.)
- **비파괴**: `pageMultiple` 미전송 시 현행 동작 유지(임베드 경로·기존 외부호출 무영향).

### bookmoa 결정 필요(2가지만)
- (d1) `pageMultiple` 위반 = **에러(차단·자동수정)** vs **경고(비차단)**? 현행 perfect/saddle은 에러(addBlankPages 자동수정), spring은 홀수경고. 데이터 주도로 가면 **기본 에러+자동수정** 권장(필요 제본만 경고로 두려면 `pageMultipleSeverity:'warning'` 추가 가능).
- (d2) `pageCountMin`(무선 32 등) 위반을 **에러/경고/미검사** 중 무엇으로? (현 worker는 min 미검사 — 도입 시 정책 결정 필요.)

---

## C. ⚠️ 현행 worker–types 불일치 3건 (이 참에 정리, 데이터 주도가 해소)
대조 중 발견 — 현재 페이지수 검증이 제본별로 **일관되지 않습니다**. 데이터 주도로 가면 worker가 binding 문자열에 의존하지 않게 되어 아래가 자연 정리됩니다.
1. **무선(perfect) 배수 근거 불일치**: worker는 `perfect → %4 에러`(`pdf-validator.service.ts:663`)인데, types `BINDING_CONSTRAINTS.PERFECT`는 **배수 제약 없음**(`minPages:32`만, `index.ts:1081`). 둘이 다릅니다. (질문하신 "무선=2"가 맞다면 worker의 4가 오히려 틀린 값.)
2. **어휘 드리프트 spring↔spiral**: worker는 `binding === 'spring'`(`:650`)으로 검사하나, 정식 `BindingType` enum은 **`'spiral'`**(`index.ts:1063`). 'spiral' 문자열을 보내면 worker 분기 미발화. → bookmoa는 worker가 인식하는 **`'spring'`** 으로 보내야 함(또는 데이터 주도면 무관).
3. **양장(hardcover) 분기 부재**: worker `validatePageCount`에 hardcover 분기 없음 → 현재 양장은 페이지수 무검사. (합성기 `pdf-synthesizer:408`는 hardcover 인지하나 검증은 별개.)

→ `pageMultiple` 데이터 주도 채택 시 worker는 "보내준 값"으로만 검증하므로 1·3은 해소되고, 2는 `binding` 문자열을 페이지수 검증에서 분리(라벨로만)하면 무의미해집니다.

---

## D. Storige 실행 제안
**지금 선반영 가능(비파괴)**: bookmoa가 값 보내기 전에도, Storige가 worker `validatePageCount`를 **`orderOptions.pageMultiple ?? 현행 binding 폴백`** 으로 바꿔두면(미전송=현행 동작 100% 동일), bookmoa가 taxonomy 확정 후 값만 보내면 즉시 작동합니다.
- bookmoa가 **(d1)(d2) 결정 + 최종 제본별 `pageMultiple`/`max`/`min` 표**를 보내주시면 → Storige가 worker 데이터 주도 전환 + 회귀테스트(미전송 byte-identical) + 배포하겠습니다.
- 또는 지금 **backward-compatible 골격(필드 수신+폴백)만 선구현**해 둘까요? (값 없으면 현행과 동일이라 무위험.) 원하시면 바로 진행합니다.

---

### 요약
- (A) 워크플로 ✅ 맞음 — bookmoa 결정 → 전달 → Storige worker 반영.
- (B) ✅ `pageMultiple`(+옵션 min/max) 동봉 = 정답이자 권장(데이터 주도 → worker 무수정 확장).
- (C) 현행 불일치 3건(무선 배수근거·spring/spiral·hardcover무검사) — 데이터 주도가 정리.
- (D) bookmoa: (d1 severity)(d2 min정책)+제본별 값표 회신 → Storige 전환·배포. 선골격 구현 원하면 즉시.

bookmoa가 제본 taxonomy를 자유롭게 확장할 수 있는 구조로 가는 게 맞습니다. 값표만 주세요 🙏

---

## E. [구현 완료·배포 LIVE] backward-compatible 골격 (2026-06-25, worker `6d0cb76`)
bookmoa 결정(d1·d2)을 반영해 **데이터 주도 골격을 선구현·배포**했습니다. 지금부터 bookmoa는 orderOptions에 값을 실어 보내기만 하면 됩니다.

- **수신 필드(LIVE)**: `orderOptions.pageMultiple` / `pageCountMax` / `pageCountMin` (전부 optional). 현 배포 API가 그대로 passthrough(검증 strip 없음 확인) → **worker만 배포로 적용 완료.**
- **동작**: 하나라도 전송되면 데이터 주도 — 배수위반→`PAGE_COUNT_INVALID`(autoFixable·`fixMethod:'addBlankPages'`, **d1**)·상한초과→`PAGE_COUNT_EXCEEDED`·하한미만→`PAGE_COUNT_BELOW_MIN`(신규 경고·비차단, **d2**). saddle도 데이터주도면 내부 `%4/64` 강제 스킵(중앙객체 경고는 유지).
- **비파괴**: 셋 다 미전송 = 기존 binding 하드코딩 폴백(byte-identical). 임베드/기존 외부호출/타 사이트 무영향. (회귀 376/376 + 레거시잠금 테스트 통과.)
- **검증 결과 스키마(모달용)**: 배수위반 에러 `details: { expected: <올림 배수>, actual, pageMultiple }` → bookmoa 모달이 "현재 N → 권장 M페이지" 그대로 노출 가능. 하한경고 `details: { min, actual }`.
- **binding 영문값**: 데이터주도면 worker가 binding 문자열을 페이지수 검증에 쓰지 않으므로 무선/양장 등 세분화에 자유. (단 `binding`은 책등합성용으로 영문 `'perfect'|'saddle'|'spring'` 계속 전송 권장 — RESPONSE2 §6.)

### 🔴 잔여 — d1 "빈페이지 실제 추가" 실행기는 별건(미구현)
현재 worker는 배수위반을 **`autoFixable:'addBlankPages'` 플래그 + FIXABLE 상태로 표시만** 합니다. 고객이 모달에서 yes 했을 때 **실제로 맨 뒤에 빈페이지를 추가해 36p 파일을 생성하는 "수정 실행기"는 아직 없습니다**(검증과 분리된 신규 worker 기능).
- 필요 설계: 고객 yes → (bookmoa가) Storige에 **fix 요청**(예: `POST /worker-jobs/fix` 또는 기존 잡 재처리) → worker가 원본 PDF 로드 → 다음 배수까지 **빈 페이지 append**(pdf-lib, 동일 판형) → 새 fileId 저장 → bookmoa가 그 fileId로 주문 확정.
- ❓ bookmoa 확인: 빈페이지 추가 트리거를 **별도 fix 엔드포인트**로 받을지, 아니면 **고객 yes 시 bookmoa가 편집기/업로드로 직접 보정**할지? (전자면 Storige가 fix 잡/엔드포인트 신규 구현 — 다음 작업으로 진행 가능.)

요약: **검증 계약은 LIVE — bookmoa는 d1·d2 값표대로 전송 시작 가능.** 빈페이지 실제 추가(d1 후반부)만 트리거 방식 확정 후 Storige가 별건 구현.
