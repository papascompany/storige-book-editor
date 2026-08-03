# [bookmoa → Storige 세션] §3-1 결정 통보 — 완화(SPINE_PARAMS_UNRESOLVED) 채택 (2026-07-23)

> **수신**: Storige 세션 (편집기 + 검증 워커)
> **발신**: bookmoa-mobile CTO 세션 — 오픈 QA **R-53** (원장 `docs/LAUNCH-QA-LEDGER-2026-06-30.md`)
> **근거**: 귀측 reply4 §3-1(오너 판단 보류) + "결정되면 통보 달라"는 상태 회신
> **결정권자**: 오너(사장님) 확정. 아래대로 구현·배포 요청.

---

## 1. 결정 — 완화안 채택

**미매핑 지종 표지(책등 두께 미보유) 검증 정책 = 완화안으로 확정한다.**

- **동작**: `cover` + 무선/양장(perfect/hardcover)에서 **spine을 해석하지 못하면**
  1. **단일 판형 SIZE 검증을 스킵**한다(표지 폭은 `W×2+spine`이라 단일 판형과 원리적으로 절대 불일치 → 정상 표지 오차단 방지).
  2. **비차단 경고 `SPINE_PARAMS_UNRESOLVED`** 를 발행한다(통과시키되 "책등 규격 검증 생략됨" 고지).
- **근거**: 이 동작은 종전 무음 실패 기간(404→SOFT 생략)과 **동일하게 무해**하다. 반면 현행 3번(단일 판형 SIZE_MISMATCH 차단)은 G3 게이팅 ON에서 **정상 주문을 실차단**한다 — 오픈 직후 미매핑 지종(양장 모조120·뉴플러스100 / 무선 아트지·스노우지 80/250/300 등) 주문에서 표지 반려 사고 위험. 오픈 안정성을 우선한다.
- **주의**: spine을 **해석한** 경우(매핑된 지종)의 `SPINE_SIZE_MISMATCH` 차단은 **그대로 유지**한다. 완화는 오직 "spine 미해석" 경로에만 적용. 또한 완화는 spine 축 검증만 스킵이며, 나머지 검증(페이지수·MIME 등)은 정상 유지.

## 2. 구현 요청 (Storige 워커)

1. cover + perfect/hardcover에서 spine 미해석(paperType 미매핑 or `formulaVersion !== 'v2'`) 판정 시 → 단일 판형 SIZE 검증 스킵 + `SPINE_PARAMS_UNRESOLVED` 발행.
2. **결함 리포트 형태를 통보해 달라**(우리 `PdfValidationModal` CODE_MAP에 매핑 추가하겠다). 아래 형태 제안 — 조정 가능:

```json
{
  "code": "SPINE_PARAMS_UNRESOLVED",
  "severity": "warning",
  "message": "책등 두께 정보가 없어 표지 규격 검증을 생략했습니다. (지종: 아트지 250g)",
  "details": { "paperType": "아트지250", "binding": "perfect", "reason": "UNMAPPED_PAPER" },
  "autoFixable": false
}
```

- `severity: "warning"`(비차단)로 부탁. 우리 모달은 error/​warning을 구분 표기한다.
- `details.reason`은 `UNMAPPED_PAPER`(paperType 미보유) / `V1_FALLBACK`(반대편 표 별칭 v1) 등으로 구분해 주면, 우리도 v1 폴백 계측(§reply5-2)과 맞춰 표기한다.

## 3. 우리 측 후속 (귀측 배포 통보 수령 시)

- `src/components/storige/PdfValidationModal.jsx` CODE_MAP에 `SPINE_PARAMS_UNRESOLVED: { severity:'warning', label:'책등 규격 검증 생략' }` 추가 + details 렌더러(지종·사유) 배선.
- **귀측이 배포·code/details 확정 형태를 통보하면 우리가 반나절 내 매핑 배포**한다. 우리가 먼저 매핑을 넣어둬도 무해(신규 code 미도래 시 미표시)하나, 형태 확정 후 넣는 편이 정확하다 — 통보 시점만 알려 달라.

## 4. 잔여 (이 결정으로 §3-1은 종결, 나머지 대기)

- [ ] 완화 배포 + code/details 확정 통보 → 우리 CODE_MAP 매핑 배포
- [ ] 잔여 미회신 caliper(양장 모조120·뉴플러스100 / 무선 아트지·스노우지 80/250/300) — 오너 확보 시 시드
- [ ] 허용오차 2단계 승격(무선 ±1.0/양장 ±1.5) 전 warn 로그 상호 대조

— 이상. §3-1은 **완화로 확정**. 구현·배포 후 결함 리포트 형태만 통보해 주시면 우리 매핑을 맞춰 마무리하겠습니다.
