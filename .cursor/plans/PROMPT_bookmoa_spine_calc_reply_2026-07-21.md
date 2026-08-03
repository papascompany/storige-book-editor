# [Storige → bookmoa 세션] R-44 책등(세네카) 계산 반영 회신 — §4-C 4항목 + 구현·배포 내역 (2026-07-21)

Storige가 `HANDOFF_storige_spine_calc_2026-07-21.md`(R-44) 요청에 회신한다.
아래 내용만으로 작업을 완결하라(자기완결 프롬프트 — 다른 대화 컨텍스트 불필요).

## 0. 요약

- **§1 공식·§2 두께표를 Storige에 전면 이식 완료**(무선 홀수+1보정·round2·무마진 / 양장 toFixed3→ceil+합지4+최소8, 지종 무선29+양장35종). 골든 14케이스 + AC 7항 스펙 잠금, 프로덕션 배포 완료(배포 상태 §6).
- **중요 발견(사과 겸 고지)**: 종전 `/products/spine/calculate`는 한글 지종명을 몰라서(코드표 8종 범용코드) 귀측 validate.js의 spine 보강 호출이 **404 → catch 무음 실패**하고 있었다. 즉 지금까지 표지 spine 검증은 사실상 생략 경로였다. 이번 배포로 한글 라벨("미색모조80"·"아르떼(UW)130" 등)이 별칭·정규화로 해석된다.
- **서버 재계산 원칙(§4-B-2) 채택**: cover 검증 잡 생성 시 `orderOptions.paperType`+`pages`+`binding`이 있으면 서버가 §1 공식으로 재산출해 `spineWidthMm`을 **무조건 덮어쓴다**(fail-closed, 원본은 `clientSpineWidthMm` 보존·대조 계측).

## 1. §4-C 회신

### C-1. 현재(구) 공식·코드표 + 매핑 SSOT

- **구 공식**(2026-07-21 이전): `max(0, (pageCount/2) × thickness + margin)` round2 — 지종 8종 범용코드(mojo_70g 0.09 / mojo_80g 0.10 / seokji_70g 0.10 / newsprint_45g 0.06 + 표지 4종), margin: perfect 0.5 / saddle 0.3 / spiral 3.0 / hardcover 2.0. → **§1과 불일치 확인, v2로 교체 배포**(구 공식은 legacy 8코드 한정 v1 폴백으로만 유지 — 하위호환).
- **신 공식(v2)**: §1 자구 이식. 응답에 `formulaVersion: 'v1'|'v2'`, `effPages`(무선), `pageThickMm`(양장), `resolvedPaperCode` 필드 additive 추가.
- **매핑 SSOT = Storige `paper_types` DB**(admin 관리) 제안 확정. 무선표는 정규 라벨을 code로("백모조 80g"…), 양장표도 원본 라벨 그대로("아르떼130"…), `aliases` 컬럼이 귀측 `productMeta.innerPaper` 라벨을 흡수(모조80→백모조/백색모조, 아르떼(UW/NW)N→아르떼N, 뉴플러스(백색)100→뉴플러스백색 100g, 공백·'g' 표기차는 정규화 자동 흡수). **귀측은 innerPaper 라벨을 현행 그대로 전송하면 된다(코드 변경 불필요).**
- **미매핑 지종(두께값 회신 요청 — D-6)**: 귀측 innerPapers 45종 중 §2 두께표 밖 품목.
  - 무선: 모조220 · 모조260 · 뉴플러스(백색)80 · 뉴플러스(미색)80 · 아트지80 · 아트지250 · 아트지300 · 스노우지80 · 스노우지250 · 스노우지300 · **아르떼 전계열(무선표에 아르떼 자체가 없음 — 무선+아르떼 주문이 실재하는지 확인 요청)**
  - 양장: 모조120 · 모조220 · 모조260 · 뉴플러스 4종 · 아르떼(UW/NW) 90·105·310
  - 미매핑 지종은 계산 시 404(계산기 API) 또는 잡 주입 생략(SOFT — 클라 값 유지)으로 처리된다. 두께값(mm/페이지·mm/장) 출처를 회신해 주면 시드에 추가한다.

### C-2. 양장 표지 산출물 정의 — **싸바리 전개 인쇄물로 판정**

- 근거: 하드커버 표지 사이즈 정본(책등+싸바리 포함, 오너 기확정 — HARDCOVER_COVER_VALIDATION_NOTES) + 기존 출력(CaseBind) 설계가 §1-B 전개 규격과 산술 동치(골든 484×345 재현 스펙 잠금).
- 따라서 **양장 표지 PDF 기대 규격 = `(W+8)×2 + spine + 40` × `(H+8) + 40`** (재단 W×H 기준, 도련 별도 가산 없음 — 전개 규격에 이미 포함). 재킷/커버지 별도 트랙은 없음.
- 무선 표지는 현행 유지: `W×2 + spine + 날개×2 + 도련×2` × `H + 도련×2`.
- 편집 화면 표시는 당분간 trim 기준(전개 캔버스 화면 표시는 후속 Track C — 표지 방향 파생과 통합).

### C-3. 허용오차·소수 정책

- **1단계(현행 배포): 무선·양장 공통 ±2.0mm 유지** — 종전 하드코딩과 동일해 즉시 차단률 변화 0. 서버 재계산 주입으로 클라 vs 서버 spine 불일치가 warn 로그로 계측되므로, 관찰기간 후 **2단계에서 무선 ±1.0 / 양장 ±1.5로 env 강화**(코드 무변경 롤아웃: `SPINE_TOLERANCE_MM_PERFECT/_HARDCOVER`). 귀측 제안(±1.0)과 다르게 양장을 ±1.5로 둔 것은 싸바리 wrap 재단 공차 감안 — 이견 있으면 회신.
- 잡 단위 오버라이드도 열어뒀다: `orderOptions.spineToleranceMm`.
- **소수 정책**: 무선 소수 2자리 유지(16p → **0.77mm** 그대로, 정수화 안 함 — AC#3 스펙 잠금). 양장은 공식상 정수 mm.

### C-4. 가로형(landscape) 상호작용

- **spine 값 자체는 pageCount·지종만의 함수 — 방향 무관, 동일 공식 그대로 적용된다.**
- 단 표지는 "W↔H 스왑"이 아니라 전개 파생이다: 가로판은 가로 판형의 W·H를 그대로 산식에 대입하면 된다(무선 `W×2+spine…`, 양장 `(W+8)×2+spine+40…`). 내지 판형 방향은 templateSet이 결정(R-13 §3=A 계약 불변).
- 가로형 × 가변책등 표지 캔버스 파생은 Track C(표지 spread 방향 파생)에서 동일 산식 모듈(`@storige/types` spine-calc)로 통합 예정 — 귀측 변경 없음.

## 2. SPINE_MISMATCH 결함 리포트 계약 (§4-B-3)

신규 코드가 아니라 **기존 `SPINE_SIZE_MISMATCH` 재사용**(귀측 CODE_MAP에 이미 있으면 그대로). details에 요청한 평탄 3필드를 additive 추가:

```json
{
  "code": "SPINE_SIZE_MISMATCH",
  "message": "표지 크기가 싸바리 전개 규격과 맞지 않습니다. (예상: 484×345mm, 현재: 490×345mm)",
  "details": {
    "expectedMm": 484, "actualMm": 490, "toleranceMm": 2,
    "expected": { "totalWidth": 484, "totalHeight": 345, "spine": 8,
                  "spineSource": "server", "layout": "hardcover-wrap" },
    "actual": { "totalWidth": 490, "totalHeight": 345 }
  },
  "autoFixable": false, "fixMethod": "adjustSpine"
}
```

- `autoFixable`은 게이팅 ON(현재 프로덕션 ON) 기준 **false**(adjustSpine 실행기 미구현) — 고객에겐 "재업로드 안내"로 표기 권장.
- 폭·높이 어느 축이든 오차 밖이면 발행. 표지에 spine 기대치가 있으면 단일판형 SIZE_MISMATCH는 **중복 발행하지 않는다**(이중발행 해소 — 귀측 모달에서 표지 오류는 SPINE_SIZE_MISMATCH 하나만 뜬다).

## 3. 귀측 권장 작업 (선택 2건 — 없어도 동작)

1. **(권장) validate.js가 `orderOptions.paperType`에 innerPaper 라벨을 병기 전송** — 이러면 서버가 spine을 직접 재계산해 덮어쓰는 fail-closed 경로가 발화한다(§0). 미전송 시엔 귀측이 보강한 `spineWidthMm`(이번 배포로 정확해짐)을 사용.
2. (인지만) `/products/spine/calculate` 응답의 `formulaVersion`이 'v2'인지 확인하면 신 공식 적용 여부를 판별 가능. 'v1'이면 미매핑 지종(→ §1-C-1 목록 회신 요청).

## 4. AC 7항 상태

| # | 시나리오 | 상태 |
|---|---|---|
| 1 | 무선 200p 미색모조80 → 9.6mm | ✅ e2e 잠금(HTTP 레벨) |
| 2 | 무선 201p → 9.7mm(홀수보정) | ✅ e2e 잠금 |
| 3 | 무선 16p → 0.77mm 소수 유지 | ✅ e2e 잠금 |
| 4 | 양장 200p 미색모조80 → 14mm | ✅ e2e 잠금 |
| 5 | 양장 40p 아르떼130 → 8mm·전개 484×345 | ✅ 골든+워커 spec 잠금 |
| 6 | 오차 밖 표지 → SPINE_SIZE_MISMATCH(통과 금지) | ✅ 워커 spec 잠금(details 계약 포함) |
| 7 | 편집기 가변책등+가이드 | ✅ 무선 가변 파이프라인 기존재(서버 공식 교체로 자동 정합) / 책등 3mm 미만 텍스트 경고·세이프존 inset 2건은 Track C 통합 후속 |

## 5. Storige 측 잔여(귀측 무관)

- 표지 가이드 additive 2건(§4-A-3 일부)·양장 화면 전개 캔버스·가로형 표지 파생 = Track C 통합 트랙.
- 허용오차 2단계 승격(관찰 후 env), 미매핑 지종 시드(귀측 회신 대기).

## 6. 배포 상태

- 커밋: `b3e77b8`(master push 완료) — 적대검증 4렌즈 23발견 → CONFIRMED 16건 전량 수정 포함
- 마이그레이션: `apps/api/migrations/20260721_add_paper_type_spine_v2.sql` — **프로덕션 적용 완료**(paper_types v2 두께·aliases additive)
- VPS api·worker 재배포: 완료(하단 라이브 스모크 참조)
- 검증: 골든 파리티 21 + API 전체 790 + 워커 전체 486(48케이스 무스왑 계약 무접촉 green) + spine e2e 28 + 라이브 스모크(한글 라벨 → v2)
