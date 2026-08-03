# G-6 대조표 — 19741bdb(B 임시조치) vs 정식 파생본 (2026-07-24)

TRACK_C_IMPL_DESIGN §5 G-6 / §7-4. **읽기전용 대조·판정** (백필 실행은 오너 승인 게이트, 본 문서 범위 밖).

## 데이터 출처
- **원본** d765713a "A4하드커버 (세로)" 429.2×301mm, spec{coverW214, coverH301, spine1.2, wing off, dpi150}
- **B본** 19741bdb "A4하드커버 (가로)" 603.2×214mm — 2026-07-14 전체비율 근사(rW=1.4054·rH=0.7110) 주입 (프로덕션 DB 실조회)
- **정식 파생본** = d765713a.canvasData 에 `transformSpreadCanvasDataOrientation` 적용 → 603.2×214mm (util 실행 결과)

## 제목/저자 i-text scene 좌표 (px @150dpi, 중앙원점)
| 객체 | 정식 파생본(util) | 19741bdb B본 | Δx(px) | Δy(px) | Δ(mm) |
|---|---|---|---|---|---|
| 제목("제목을 넣어주세요") | (905.960, −359.425) | (906.668, −359.425) | 0.707 | 0.000 | **0.120** |
| 저자("저자명") | (929.803, 476.356) | (930.491, 476.356) | 0.688 | 0.000 | **0.117** |

Δ(mm) = Δpx × 25.4 / 150

## 오차 상한 판정 (정본 §5 G-6)
- 산식: 전체비율 근사 vs 면단위 차이는 spine·면경계 항에서만 발생 → spine 1.2mm 형상에서 **≲1mm** 이어야 정상.
- 실측: **Δx ≈ 0.12mm, Δy = 0** → 상한 1mm의 약 1/8. **정상 범위.**
- Δy=0 근거: 세로축(coverH 301→214)은 전체비율·면단위가 동일 스케일(spine 미관여).
- Δx 미소 근거: front cover 내 x 위치가 spine 1.2mm(얇음) 항만큼만 어긋남.

## 부수 발견 — IDML 잔재 치수라벨 (§7-3)
- **B본**: 치수라벨 3개 유지 — '301.0mm' / '1.2mm' / '301.0mm' (스왑된 값, oY=bottom text)
- **정식 파생본**: 치수라벨 3개 **전부 drop** (util 패턴 정리, spread-orientation-derive.util.ts:274-286)
- → 정식본 교체 시 IDML 잔재 자동 정리라는 부수 이득.

## 결론
1. **좌표 정합**: B본은 정식 파생본과 ≈0.12mm 차 — 상한 훨씬 이내. **B본 수용 가능**(오너 육안검증 통과 상태와 정합).
2. **교체 우선순위**: 개선(잔재 정리)이지 긴급 아님(§7-4). 실행 시 별도 1회 백필 스크립트 + 현행 B본 전체 롤백 JSON 선백업 + 오너 승인.
3. 본 대조는 **판정까지**. 백필 실행은 오너 결정 게이트.

## ✅ 오너 결정 (2026-08-01)

**결정 = A안(교체 안 함, 백필 불실행) — 확정.** RESUME_PROMPT_2026-08-01 §2 ⓔ 게이트 해소.

- 근거: Δ≈0.12mm(상한 1mm의 1/8) + 오너 육안검증 기통과 + B본 프로덕션 안정 운용 중.
- IDML 잔재 치수라벨 3개는 수용(표시 무해). 향후 19741bdb 를 재생성할 일이 생기면
  그때 정식 파생 util(`transformSpreadCanvasDataOrientation`)로 만들면 자동 정리됨.
- 백필 스크립트·롤백 JSON 선백업 절차(§결론 2)는 **불채택 종결** — 재론 시 본 문서 기준 재평가.

## 재현 (probe)
- util 시그니처: `transformSpreadCanvasDataOrientation(canvasData, spreadConfig) → { canvasData, spreadConfig }`
- 계산: apps/api 에서 jest 임시 spec 으로 fixture(canvasdata_cover_d765713a.json) 로드→util 적용→i-text 좌표 출력. (resolveJsonModule 미설정이라 `fs.readFileSync`+JSON.parse 로 픽스처 로드)
- 19741bdb 실좌표: 프로덕션 MariaDB `SELECT canvas_data FROM templates WHERE id='19741bdb-…'` (읽기).
