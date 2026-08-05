# RESUME PROMPT — 2026-08-04 (세션 정본 · S-E3 구현)

> **이 문서가 최신 정본이다.** 직전 정본: `RESUME_PROMPT_2026-08-03.md` (포토북 펼침면 트랙).
> 이번 세션: **[S-E3] 텍스트 프리셋 + 곡선 텍스트** (edicus 트랙 F5+F6) — **머지·프로덕션 배포 완료**.
> PR #12 → 머지 `18c4a2e` (ci+gitleaks success) → Vercel editor Production Ready →
> **라이브 실측**: editor.papascompany.co.kr 텍스트 패널에 스타일 3종+곡선 4종 표시 확인.

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

## 3. 머지 경과 (2026-08-04 오후)
- 커밋 3건: `206f2d7`(feat S-E3) · `f341558`(docs resume) · `6c43b74`(fix 식별자)
- **함정 재확인**: CI `check-source-exposure.mjs` + editor `postbuild`(dist 스캔)가 소스 내
  외부 벤치 식별자("edicus")를 DENY — 주석·테스트명도 걸린다. `.cursor/`·docs 는 스캔 제외.
- PR #12 전 체크 green → 머지 `18c4a2e`(관행: "Merge <브랜치> — 설명" 머지 커밋, 브랜치 삭제)
- 머지 시점 master 에 병행 세션 커밋 2건(`5e95a20` api lint 게이트, `d481728` 멀티테넌시 P3b) 선착 — 충돌 없음
- Vercel editor Production Ready(51s) · master ci+gitleaks success · 라이브 패널 실측 확인

## 4. 후속 완료 (2026-08-05 오전) — fe-qa + [S-E4]

### 4-1. fe-qa 3뷰포트 (S-E3 프리셋 UI, 프로덕션 실측)
모바일 375(드로어)·태블릿 768·데스크톱 1280 전부 통과 — 곡선 프리셋 2열 그리드 유지, 콘솔 에러 0.
⚠️ 브라우저 팬 함정: 팬 숨김 상태에서 computer 클릭이 30s 타임아웃 — `javascript_tool` 로
`button[title="…"]` 클릭 우회(도구 버튼 라벨은 aria-label 아닌 **title 속성**).

### 4-2. [S-E4] 사진 사용 횟수 배지 (PR #13 → 머지 `a2c5c1b` → 프로덕션 배포)
- **부분 기보유 정정**: 공유방(외부) 사진 '사용됨' 체크+'안 쓴 사진' 필터는 D1 기보유였다.
  실제 격차 = 횟수 표시 · '내 업로드' 탭 부재 · O(사진×객체) 집계 병목.
- `utils/photoUsage` 1패스 집계(그룹 중첩·이중 키 합산) · 양 탭 오렌지 배지+필터 ·
  undo/redo 구독+300ms 디바운스+늦은 페이지 재구독 · 구 `isPhotoUsed` @deprecated.
- 업로드 객체 `storagePhotoUrl` 링크(화면 전용·비직렬화) — 자동편집 채움(src=storage URL)과
  패널 dataURL 키 정합. **자동편집 실기(storage API 필요)는 미검증 잔여.**
- 검증: editor 565 green(신규 13·성능 가드) · dev 실기 DnD 주입으로 배지→필터→undo 전 사이클.

## 5. 오너 게이트 해소 + D-6b② 구현 (2026-08-05 오후)

### 5-1. 오너 결정 확정 (채팅 — OWNER_DECISIONS_2026-07-07.md §D-6 기입 완료)
- **D-6a = B(워커 오프로드) 확정** — Wave0 권고 A 기각. S-P2A는 worker 'cutout' 잡 아키텍처.
  인프라 비용(잡당 피크 0.5~1GB·concurrency 1) 수용.
- **D-6b②③ 모두 승인** — ② 픽셀 캡은 양 아키텍처 공통이라 즉시 구현(아래), ③ dataURL→storage는
  클라 선행 구현 없이 **워커 잡 설계에 통합**(B 확정에 따른 중복 방지 재정렬).

### 5-2. D-6b② 구현 — 머지 `4d1c2b1` (PR #14, ci+gitleaks success, 프로덕션 배포 완료)
- canvas-core `utils/inferenceCap`(순수 모듈, 장변 2560) + `getForeground` 캡·스케일 보상
  (미적용 시 기존과 동일식 — 불변식 테스트) + AppClipping 업로드 가드(유일 무가드 경로).
- ⚠️ 로컬 함정 재확인: fabric import 테스트는 canvas.node 미빌드로 스위트 4개 죽음(§3-3 기준선,
  stash 전후 동일 실측) — 순수 모듈 분리(curveText 전례)로 회피. CI는 무관.

### 5-3. S-P2A-B 실행 계획 (다음 세션 — D-6a=B 반영 샤드)
1. worker 'cutout' Bull 잡 신설(4번째 타입) — node용 배경제거 스택 선정 스파이크
   (@imgly/background-removal-node vs onnxruntime-node+ISNet, 의존성 추가 = 오너 승인 대상),
   concurrency 1, 픽셀 캡 재사용(inferenceCap — canvas-core 배럴 export 완료)
2. API 엔드포인트(잡 생성/상태/결과 URL) + sites 기능 플래그 게이팅 + JWT/사이트 키 가드
3. 결과 마스크/합성 PNG → `/app/storage` 저장 + URL 반환(**=D-6b③ 통합 지점**)
4. 에디터: segmentImage 클라 추론 → 잡 요청/폴링 교체(플래그 뒤 점진 전환, 클라 폴백 유지 여부 결정)
5. 모달 보정 UX(브러쉬·표시모드 4종·모달 로컬 undo) — 기술설계 §3.5
6. 칼선 핸드오프([S-P2B] 입력 계약)

### 5-4. 프로덕션 배포 검증 (2026-08-05, 머지 `4d1c2b1` 직후)
- 배포 Ready(51s) · master ci(test 2m52s)+gitleaks success.
- **번들 실물 확인**(캡이 실제로 실렸는지): `canvas-core-CS6ZUXFI.js` 에 `const Dn=2560` +
  `getForeground` 내 배선 확인 — `Hn(naturalW,naturalH)` → `engaged` 시 canvas
  `drawImage`→`toDataURL` → `removeBackground(캡본)`. **소스 정합 증명 완료.**
- S-E4 배지 회귀 없음: 동일 자산 참조 썸네일 2개가 같은 값(2), 신규 1장은 1 — 자산 키 집계 정합.
- ⚠️ **실기 추론(캡 발동 런타임)은 여전히 미검증** — 아래 5-5 사유. 수식·불변식은 CI 단위 8건이 커버.

### 5-5. 실기 중 발견 — 모양컷 배경제거 진입 도달 불가 (기존 결함, 이번 변경과 무관)
`AppClipping.currentImage` 는 **컴포넌트 로컬 state**이고, 업로드 핸들러가 `hideSidePanel()` 로
패널을 닫아 언마운트시킨다. 재진입 시 복원 effect가 있으나 `id==='innerItem' &&
extensionType==='clipping'` 객체를 요구 — 책(BOOK) 템플릿에선 생성되지 않아 `currentImage`
가 null 로 남고 '효과(배경제거)' 클릭이 **무반응**(early return)이다. 프로덕션 실측:
12MP 합성 사진 업로드·렌더는 정상, 이후 효과 클릭 시 imgly 네트워크 요청 0건.
→ Wave0의 "모양컷=미완 플로우" 판정과 일치. **D-6a=B 로 S-P2A가 이 진입점을 재구축하므로
그 스코프에서 함께 해소**(별도 수정 안 함). 스티커/컷아웃 상품 세션에서는 재현 여부 재확인 필요.

### 5-6. S-P2A-B 샤드 1 완료 — 워커 스택 스파이크 (2026-08-05, 코드 변경 0)
정본: **`CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md`**. 정찰 4축 + 웹 조사 4축 + 적대검증(16 에이전트).

**결정 차단 사실 3건**
1. **musl 블로커(적대검증 2회 CONFIRMED)** — 워커가 node:24-alpine 인데 onnxruntime-node 는 1.24.3·최신
   1.27.0 모두 musl 프리빌드가 없고 glibc 링크다. npm `libc` 필드가 없어 **Alpine 설치는 성공하고 런타임
   import 에서 터진다**. CI 는 Docker 이미지를 빌드하지 않아(ci.yml docker 0건) **배포 시점에야 발견**된다.
   → 워커 내부 추론을 택하면 베이스 alpine→glibc 교체 + gs·qpdf·poppler 재검증이 딸려온다.
2. **라이선스** — BRIA(RMBG-1.4/2.0)는 자체호스팅 상업 사용 불가(별도 계약). 깨끗한 대안은
   U2Net(Apache-2.0)·BEN2(MIT)·BiRefNet(MIT)이나 다수가 DIS5K 학습데이터 비상업 회색지대를 공유 —
   얽힘 최소는 **U2Net**. (1차 조사의 "RMBG=평가 전용" 주장은 적대검증에서 **REFUTED** — 결론만 유효)
3. **메모리** — worker mem_limit 4g·힙 3072MB 지만 **ONNX 아레나는 V8 힙 밖**이라 cgroup OOM 직격.
   단일 워커 공유라 추론 피크가 **인쇄 파이프라인을 동반 실패**시킬 수 있다(VPS 8GB 공유).

**권고 = C안: rembg 사이드카 컨테이너 + U2Net** (워커 베이스 무접촉 → 인쇄 회귀 위험 0, 모델 런타임 교체,
GPU 이전 경로). 차선 A(워커 내장+베이스 교체), 조건부 F(SaaS $0.018~0.02/장, 단 국외이전 동의 선행).
**배제**: imgly-node(AGPL+2.5년 정체) · BRIA 자체호스팅 · Playwright · Cloudinary(애드온 폐기).

**별건 발견 ★**: **레포에 LICENSE 파일이 없어 imgly(AGPL-3.0) 의무를 현재도 미충족**(적대검증 발견 —
임베드 IIFE 는 이미 스텁 치환이라 파트너 배포물엔 AGPL 코드 없음, SPA `/embed` 는 스텁 미적용).

### 5-7. D-12 오너 결정 완료 (2026-08-05) — 샤드 2 게이트 해제
- **D-12a = C(rembg 사이드카)** 권고 수용. 조건: rembg **2.0.75+ 고정**(CVE-2026-40086) · 내부망 전용
  바인딩 · `*_custom` 세션 차단. 컨테이너 5→6개, 상주 RAM 0.7~1.5GB 수용.
- **D-12b = BEN2(품질 우선)** — **권고(U2Net) 기각**. ⚠️ **수용된 리스크**: BEN2는 카드 원문에 DIS5K
  학습이 명시돼 '비상업 데이터셋 약관의 가중치 전이' 미해결 영역을 떠안는다(코드·가중치는 MIT로 명확).
  **완화 설계 의무**: 모델명을 하드코딩·문서화하고 **U2Net(Apache-2.0) 폴백을 런타임 파라미터 1개로
  전환 가능하게** 만들 것.
- **D-12d = imgly 제거로 해소** 권고 수용. ⚠️ 제거 완료 전까지 **SPA `/embed` AGPL 노출 지속** —
  샤드 2~3에서 반드시 완주.
- D-12c(국외이전)는 자체호스팅 확정으로 소멸.

## 6. 다음 안전 행동 — 샤드 2 착수 가능
1. **샤드 2**: `CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md` §5 구현 계약 12항 순서대로.
   첫 스텝 = rembg 사이드카 compose 서비스 + `image-cutout` 큐/`WorkerJobType.CUTOUT` 배선
   (DB 마이그레이션 불필요 — job_type varchar(30))
2. 착수 직후 **BEN2 vs 현행 imgly 20장 품질 실측 1회** — BEN2 선택이 DIS5K 리스크를 감수할 만한지
   근거를 남기고, 미달 시 U2Net 폴백 스위치로 즉시 전환
3. S-E4 잔여(경미): 자동편집 채움 배지 정합 — 포토북 템플릿셋 세션에서 1회 실기
4. 캡 실기: 워커 전환 시 서버측에서 자연히 검증됨(클라 경로는 그때 교체)

## 7. 상태 스냅샷 (2026-08-05 오후)
- master = **`4d1c2b1`**(D-6b② 머지) · Vercel editor Production Ready · 전 서비스 LIVE
- 작업 브랜치 3개(s-e3·s-e4·d6b2) 전부 머지·삭제 완료 — **코드 잔여 0**
- ⚠️ 세션 중 모델 전환(→ claude-opus-5). 커밋 trailer 는 전환 이후 `Claude Opus 5` 사용
- 워킹트리 기존 잔재(이 세션 무관·보존): RESUME_PROMPT_2026-07-30.md 수정본, docs/SHOPIFY_* untracked 8건
