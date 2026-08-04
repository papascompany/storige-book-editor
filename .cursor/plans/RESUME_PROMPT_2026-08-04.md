# RESUME PROMPT — 2026-08-04 (세션 정본 · S-E3 구현)

> **이 문서가 최신 정본이다.** 직전 정본: `RESUME_PROMPT_2026-08-03.md` (포토북 펼침면 트랙).
> 이번 세션: **[S-E3] 텍스트 프리셋 + 곡선 텍스트** (edicus 트랙 F5+F6) 구현 완료 — **커밋 대기**(오너 승인 게이트).

---

## 1. 완료 — [S-E3] (브랜치 `feat/s-e3-text-presets-curve`, 미커밋)

### 정찰 확정 사실 (프롬프트 정본 대비 스코프 축소 근거)
- **스파이크 불필요 판정**: 기보유 아크 곡선(TextEffect, 06-02)이 이미 fabric 5.5.2 text-on-path 기반 —
  편집기 렌더·SVG export(per-char tspan rotate)·toObject/fromObject 왕복 전부 프로덕션 검증 상태였다.
  **신규 커스텀 클래스 불필요** — 문자별 배치 대안(설계 §3.3 대안)도 불필요.
- fabric Text 는 `path`/`pathSide`/`pathAlign`/`pathStartOffset` 을 **additionalProps 로 항상 직렬화**
  (화이트리스트 불요). Flip = `pathSide: 'right'` (역순 순회 + 180° 회전 = 읽는 방향 유지).
- 워커는 fabric 렌더를 하지 않는다 — 인쇄 PDF 는 에디터 클라이언트(jsPDF+svg2pdf)가 생성.
  "워커 클래스 등재" 요건의 실체는 **toSVG 패리티**이며 per-char `<tspan x y rotate>` 로 충족.

### 변경 파일
| 파일 | 내용 |
|---|---|
| `packages/canvas-core/src/utils/curveText.ts` (신규) | 곡선 수식·적용 유틸 단일 정본 — `generateArcPathData`(기존 수식 이동·불변), `generateWavePathData`(신규), `applyCurveToText`, `removeCurveFromText`, `radiusForTextOnArc` |
| `packages/canvas-core/src/utils/canvas.ts` | `extendFabricOption` 에 **`curvePathType` 등재** (L7 침묵 소실 함정 가드) |
| `apps/editor/src/constants/textPresets.ts` (신규) | 선언적 프리셋 데이터 — 스타일 3종(제목/부제목/본문, sizeRatio 방식) + 곡선 4종(위/아래 아치·웨이브·원형) |
| `apps/editor/src/utils/insertTextPreset.ts` (신규) | 삽입 로직 — addText 규약 보존(워크스페이스 중앙·offHistory→완성→onHistory→add=1엔트리·FontPlugin 폴백). 스타일 프리셋은 enterEditing+selectAll(코어스 포인터 제외) |
| `apps/editor/src/tools/AppText.tsx` | '추천 콘텐츠' 빈 섹션 → 스타일/곡선 프리셋 섹션 (isCustomer 가드 제거 — 도구이므로 전 사용자) |
| `apps/editor/src/controls/TextEffect.tsx` | 웨이브 모양 + Flip(뒤집기) 후편집 추가, 패스 생성을 공유 유틸로 대체. **적용 순서를 set→onHistory 로 교정**(곡률 변경이 히스토리 1엔트리가 되도록 — 기존은 onHistory 뒤 set 이라 엔트리 누락) |
| 테스트 (신규 2) | `curveText.test.ts` 22건(수식 golden·직렬화 계약·화이트리스트 소스가드) + `textPresets.test.ts` 6건 |

### 검증 (실측)
- canvas-core 472 tests green + editor **552 tests green** (전량) · 두 패키지 typecheck green · 변경 파일 lint 0건
- 브라우저 실측(dev): 스타일 프리셋 삽입→즉시 편집→타이핑 대체 / 곡선 4종 삽입 렌더 /
  저장 왕복(속성+path 보존) / Flip 시각 확인 / toSVG per-char 방출 확인
- **실측 발견→수정**: 아치 반지름에 기존 -20 관행 적용 시 호 길이<텍스트 폭 → 글자 겹침.
  `radiusForTextOnArc × 1.05` 로 교정 후 재검증.

### 미검증 (한계 명시)
- 실물 IME 조합(브라우저 자동화 한계 — 기존 IText hiddenTextarea 경로 그대로라 회귀 위험 낮음)
- 워커 골든 픽셀 diff (에디터 SVG 경로가 곡선을 결정하므로 기보유 아크와 동일 리스크 수준)
- TextEffect UI 클릭 경유 웨이브/Flip 전환(아래 함정으로 UI 조작 제약 — 로직은 삽입 경로에서 동일 유틸 검증)

## 2. 함정 — 이 세션에서 확립
- **Claude 브라우저 팬에서 로컬 에디터 dev 는 zoom=0 초기화**(vt [0,0,0,0,...]) — 캔버스가 전혀 안 그려짐.
  fabric 인스턴스를 React fiber 로 찾아 `setViewportTransform([0.8,0,0,0.8,398,332])` 후 진행.
  requestRenderAll 도 지연됨 — 액션 후 명시적 `renderAll()` 필요. 셀렉션 스토어 갱신도 고착됨.
- API 없이 에디터 열기: `apps/editor/.env.local` 에 `VITE_DEFAULT_TEMPLATE_SET_ID=none` → 빈 캔버스 진입
  (검증 후 삭제함 — 남기면 로컬 기본 진입이 샘플 템플릿셋 대신 빈 캔버스가 됨).
- 기준선 결함(별건): `apps/editor/src/test/setup.ts` lint 에러 2건('Storage' no-undef) — editor `pnpm lint` 가 exit 1.

## 3. 다음 안전 행동
1. 오너 확인 후 커밋/push (PUBLIC 레포 — push 전 `gitleaks detect --log-opts="origin/master..HEAD"`)
2. fe-qa 3뷰포트(모바일 퍼스트) 실기 확인 — 프리셋 그리드가 좁은 패널에서 2열 유지 여부
3. 이후 타순: **[S-E4] 사진 사용 횟수 배지** (독립·선행 없음)

## 4. 상태 스냅샷
- 브랜치: `feat/s-e3-text-presets-curve` (origin/master=713cccc 기준, 미커밋 변경 7파일)
- 워킹트리 기존 잔재(이 세션 무관·보존): RESUME_PROMPT_2026-07-30.md 수정본, docs/SHOPIFY_* untracked 8건
