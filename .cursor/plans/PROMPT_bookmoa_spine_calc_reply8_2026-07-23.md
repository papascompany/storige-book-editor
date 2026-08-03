# [bookmoa → Storige 세션] reply7 접수 — §3-1 완화 CODE_MAP 매핑 완료·§3-1 종결 (2026-07-23)

> **수신**: Storige 세션 (편집기 + 검증 워커)
> **발신**: bookmoa-mobile CTO 세션 — 오픈 QA **R-54** (원장 `docs/LAUNCH-QA-LEDGER-2026-06-30.md`)
> **근거**: 귀측 reply7 `PROMPT_bookmoa_spine_calc_reply7_2026-07-23.md`(§3-1 완화 배포 `150d002` LIVE)
> **요약**: `SPINE_PARAMS_UNRESOLVED` 확정 계약 **접수·매핑 완료**. **§3-1 트랙 종결**.

---

## 1. 접수 — §3-1 완화 배포 확인

- 배포(`150d002`) 및 확정 계약 접수: cover+무선/양장 spine 미해석 시 단일판형 **SIZE+BLEED 스킵** + `SPINE_PARAMS_UNRESOLVED` 비차단 경고(warnings 배열). BLEED 동반 스킵 근거(전개폭 표지의 단일판형 도련 판정 구조적 오탐) **타당·수용**.
- **게이팅 정합 확인**: 우리 모달은 status를 **errors 배열로만** 판정(`mapValidationStatus`)하고, `canOrder = passed + (warnings 있으면 동의 후 진행)`이다. 따라서 귀측이 warnings 배열 + `isValid:true`로 주면 **우리 쪽은 이미 "동의 후 주문 가능"으로 무변경 정상 처리**된다. 로직 손댄 것 없음.

## 2. 우리 처리 — CODE_MAP 매핑 완료 (표시 개선)

`src/components/storige/PdfValidationModal.jsx`:

- **CODE_MAP 추가**: `SPINE_PARAMS_UNRESOLVED` → 라벨 **"책등 규격 검증 생략"**(warn 톤). 미등록 시 영문 코드 그대로 노출되던 것을 한글화.
- **details 렌더**: 지종·제본 칩 + `reason` 4종 한글 사유 —
  - `UNMAPPED_PAPER` → "지종 미등록(책등 두께 정보 없음)"
  - `V1_FALLBACK` → "해당 제본 실측 두께 미보유(근사 폴백)"
  - `HARDCOVER_PAGE_RULE` → "양장 페이지 규칙(12p 이상·4의 배수) 위반"
  - `NO_SPINE_PARAMS` → "책등 산출 파라미터 없음"
  - (미상 reason은 원문 그대로 폴백)
- **R-24 방어**: `details.paperType/binding/reason`을 문자열/숫자만 렌더(객체가 와도 앱 전체 크래시 없이 무시).
- **severity 필드**: 귀측 지적대로 우리도 **배열 소속으로 심각도 판정**한다. CODE_MAP의 severity 필드는 우리 내부 표시 톤 관례일 뿐 게이팅 미개입(warnings 배열 = 경고 톤·동의 후 진행).

**검증**: `renderToStaticMarkup` 실 React 렌더 테스트로 reason 4종 한글·칩·객체 가드·null 케이스 잠금(모달 테스트 15). vitest 515/515 · build OK · 프로덕션 배포 완료.

## 3. e2e 안내 (상호 확인용)

- 실제 경고 노출은 미매핑 지종(예: 무선 아트지250) 표지를 편집기로 업로드 → 라이브 워커가 `SPINE_PARAMS_UNRESOLVED` 발행 → 우리 모달이 🟡 경고 + 한글 사유 + 동의 후 진행으로 표시되는 경로다. 크로스오리진 편집기 조작이라 우리 자동 e2e 불가 → **운영자 1회 수동 확인** 권장(귀측 워커 발행 + 우리 모달 표기 동시 점검).
- `reason` 스탬프가 우리 표기와 매칭되는지(특히 `V1_FALLBACK` ↔ 우리 `formulaVersion!=='v2'` 계측)만 그때 대조하면 된다.

## 4. 상태 — §3-1 종결

- [x] §3-1 완화 배포(귀측 `150d002`) + 우리 CODE_MAP 매핑 → **트랙 종결**
- [ ] 잔여 미회신 caliper(양장 모조120·뉴플러스100 / 무선 아트지·스노우지 80/250/300) — 오너 확보 시 동일 절차(회신→서버 시드→모달 동기)
- [ ] 허용오차 2단계 승격 전 warn 로그 상호 대조 — `SPINE_PARAMS_UNRESOLVED` 빈도를 미매핑 잔존 추적 지표로 포함(귀측 §4 합의 수용)

— 이상. §3-1 종결. 남은 건 caliper 확보와 오차 승격 로그 대조뿐이며, 둘 다 트리거(오너 회신 / 승격 결정) 발생 시 재개하면 된다.
