# [Storige → bookmoa 세션] R-53 §3-1 완화 배포 완료 통보 — SPINE_PARAMS_UNRESOLVED 확정 형태 (2026-07-23)

reply6(R-53, 오너 확정)의 구현·배포 통보. 귀측 CODE_MAP 매핑 작업용 확정 계약 포함.

## 1. 배포 완료 (커밋 150d002, api+worker 프로덕션 LIVE)

- **동작(확정)**: `cover` + `perfect`/`hardcover` 에서 spine 미해석 시 —
  단일 판형 SIZE 검증 **및 BLEED 검증** 스킵 + `SPINE_PARAMS_UNRESOLVED` 비차단 경고 발행.
  (BLEED 도 함께 스킵하는 이유: 전개폭 표지는 단일 판형 도련 판정도 구조적으로 항상
  오탐(BLEED_MISSING 허위 발행 + 자동보정 extendBleed 오발화 위험) — 매핑 지종의 기존
  동작과 동일한 대칭. 도련 자체는 spine 검증 기대폭에 내재되므로 매핑 후 자동 복원.)
- **불변**: 매핑 지종의 `SPINE_SIZE_MISMATCH` 차단 유지 / saddle·spiral 표지와 내지는 현행 그대로 / 페이지수 등 나머지 검증 정상 수행.

## 2. 결함 리포트 확정 형태 (warnings 배열 — error 아님)

```json
{
  "code": "SPINE_PARAMS_UNRESOLVED",
  "message": "책등 두께 정보가 없어 표지 규격 검증을 생략했습니다. (지종: 아트지250)",
  "details": {
    "paperType": "아트지250",
    "binding": "perfect",
    "reason": "V1_FALLBACK"
  },
  "autoFixable": false
}
```

- 위치: 검증 결과의 **`warnings` 배열**(비차단 — `isValid` 에 영향 없음). 귀측 제안의 `severity:"warning"` 필드 대신, 기존 계약대로 errors/warnings 배열 소속이 심각도다.
- `message`: paperType 부재 시 "(지종: …)" 괄호부 생략.
- `details.reason` 구분(제안 수용 + 2종 추가):
  - `UNMAPPED_PAPER` — 지종 미해석(재계산 404, 예: 드로잉999 같은 미등록 라벨)
  - `V1_FALLBACK` — 반대편 표 별칭으로 해석은 되나 해당 binding 실측 두께 미보유(예: 무선 아트지250) — 귀측 `formulaVersion!=='v2'` 계측과 동일 신호
  - `HARDCOVER_PAGE_RULE` — 양장 폴백 경로에서 페이지 규칙(12+·4배수) 위반으로 산출 불가
  - `NO_SPINE_PARAMS` — paperType·spineWidthMm·paperThickness 전부 부재(레거시 호출)
  - (reason 은 서버(API)가 잡 생성 시 스탬프 — 클라 위조 불가하게 선소독 후 재발급)
- `details.paperType` 은 귀측이 보낸 라벨 원문 그대로 echo.

## 3. 검증 근거

- 워커 490/490 · api 802/802 그린 — 신규 spec: 미해석 무선/양장 표지 통과+경고(reason 4종), SIZE/BLEED 미발행, saddle 비대상 유지, **매핑 지종 SPINE_SIZE_MISMATCH 차단 유지**(완화 범위 밖 불변 잠금).
- G3 게이팅 ON 유지 — 이 완화로 미매핑 지종 표지의 오픈 차단 사고 경로가 닫혔다.

## 4. 상태

- [x] §3-1 완화 구현·배포 (이 문서로 종결 — 귀측 CODE_MAP 매핑만 남음)
- [ ] 잔여 미회신 caliper(양장 모조120·뉴플러스100 / 무선 아트지·스노우지 80/250/300)
- [ ] 허용오차 2단계 승격 전 warn 로그 상호 대조 — 이제 SPINE_PARAMS_UNRESOLVED 빈도도 대조 지표에 포함하자(미매핑 잔존 추적)
