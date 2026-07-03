# PDF 골든 회귀 하네스

렌더·변환 파이프라인 변경이 **PDF 출력을 바꾸지 않았는지** 자동 판정하는 도구.
저장소에 골든/픽셀 diff 인프라가 없어 Phase 0(2026-07-03)에 신설. Track A(canvas-core 지연로딩)
검증이 첫 사용처이며, 이후 모든 PDF 렌더 변경(jspdf/svg2pdf/pdf-lib/합성)에 재사용한다.

## 무엇을 비교하나 (계층)
1. **페이지 수** (`qpdf --show-npages`) — 누락/추가 페이지. 버전 안정.
2. **정규화 콘텐츠 해시** (`qpdf --qdf --deterministic-id`) — 비결정 메타(/ID·/CreationDate·/ModDate·
   XMP 타임스탬프) 제거 후 sha256. **byte-identical(모듈로 메타) 이면 확실한 통과.** 지연로딩처럼
   "출력 로직 무변경" 을 표방하는 변경의 핵심 검증축.
   ⚠️ 트레일러 `/ID` 도 스크럽한다 — `--deterministic-id` 는 /ID 를 날짜 포함 전체 콘텐츠에서
   파생시키므로, 날짜 라인만 지우면 /ID 가 날짜 차이를 실어 날라 **같은 코드 2회 실행조차 FAIL**
   이 났다(2026-07-03 Track A 사후검증에서 실증·수정. 실제 콘텐츠 차이는 콘텐츠 라인 diff 로 여전히 잡힘).
3. **(옵션) 픽셀 diff** — `pdftoppm` 150dpi 래스터 + `pixelmatch`. 시각 회귀까지. 라이브러리 부재 시 건너뜀.

## 필수/옵션 도구
- 필수: `qpdf` (`brew install qpdf`). ⚠️ qpdf 는 경고 시 exit 3 → 엔진이 성공으로 취급.
- 옵션(픽셀 계층): `pdftoppm`(poppler) + `pixelmatch`+`pngjs`. 활성화: `pnpm add -Dw pixelmatch pngjs`.
- `gs` 불필요.

## 사용
```bash
# 두 PDF 비교 (exit 0=일치, 1=불일치, 2=실행오류)
node scripts/pdf-golden/compare.mjs <baseline.pdf> <candidate.pdf>
node scripts/pdf-golden/compare.mjs baseline/book.pdf candidate/book.pdf --pixel --threshold 0

# 엔진 자체 회귀 테스트
node --test scripts/pdf-golden/compare.test.mjs
```

## Track A 검증 결과 (ADR-1 — ✅ 2026-07-03 사후 PASS)
Track A 5커밋(b432ade/c853a37/38bca11/33d3b5a/7480fa1)은 정적 import→dynamic import 전환만으로
PDF 출력 무변경(byte-identical)이 의도. **골든으로 실증 완료**:
- 캡처: 아래 `fixture/` 자동 캡처(worktree 16c5e22 vs 7480fa1, 각 2회. 2p 벡터+바코드+QR+칼선, 150dpi).
- 판정: **결정성(같은 코드 2회) PASS ×2 · 골든 baseline≡candidate PASS** — 정규화 해시 일치
  + 픽셀 diff 0(150dpi) + 페이지 3=3. 유일한 원시 바이트 차이 = /CreationDate(및 그 파생 /ID).
- 증거 PDF: `baseline/book.pdf`(16c5e22) · `candidate/book.pdf`(7480fa1=live) 보관(git 미추적).
- 커버: 다페이지 svg2pdf ×2 · _addCutLinePage · jsbarcode/qr-code-styling dynamic 경로 · jspdf compress.
  미커버: effects 페이지(imagePlugin 필요)·outlines 칼선·svg2pdf 에러복구 경로(수동/후속).

```bash
# 1) 기준선 생성 (Track A 직전)
git stash            # 또는 워크트리 분리
git checkout 16c5e22 # Track A 직전 커밋
pnpm --filter @storige/types build
pnpm --filter @storige/editor dev   # :3000
#  book/leaflet/photobook 각 대표 세션 1개씩(⚠️ svg2pdf 5개 async 경로·재단선·효과페이지·QR 포함)
#  편집기에서 'PDF 내보내기' → scripts/pdf-golden/baseline/{book,leaflet,photobook}.pdf 로 저장

# 2) 반영본 생성 (Track A 포함 master)
git checkout master   # (또는 feat/pod-modularization-track-a)
#  동일 빌드·동일 세션·동일 입력으로 재생성 → candidate/{...}.pdf

# 3) 비교
for k in book leaflet photobook; do
  node scripts/pdf-golden/compare.mjs baseline/$k.pdf candidate/$k.pdf --pixel || echo "❌ $k 회귀"
done
```
- **PASS(전부 exit 0)** → Track A 출력 불변 실증 → master push 승인 게이트 통과.
- **FAIL** → Track A 는 push 보류(로컬 master 유지, 프로덕션 무접촉). loadPdfDeps 캐시/지연로드
  경계면 회귀로 간주하고 원인 커밋을 이등분.

## 캡처 자동화 — `fixture/` (2026-07-03 신설, Track A 검증에 실사용)
편집기 앱 없이 **canvas-core 소스를 직접 임포트**해 실제 저장 경로
(`ServicePlugin.saveMultiPagePDFAsBlob` → svg2pdf/jspdf)를 결정적 입력으로 실행하고,
생성 PDF 를 로컬 수신 서버(:3199)로 POST 하는 브라우저 픽스처. 절차:

```bash
# 1) 비교 대상 커밋별 worktree 준비(현 체크아웃 무접촉)
git worktree add /tmp/golden/baseline  <직전커밋>
git worktree add /tmp/golden/candidate <검증커밋>
(cd /tmp/golden/baseline  && pnpm install --prefer-offline && pnpm --filter @storige/types build)
(cd /tmp/golden/candidate && pnpm install --prefer-offline && pnpm --filter @storige/types build)
# 2) 픽스처 복사(각 worktree 루트의 fixture-golden/ 으로)
cp scripts/pdf-golden/fixture/{index.html,main.ts,vite.golden.config.mts} /tmp/golden/baseline/fixture-golden/
cp scripts/pdf-golden/fixture/{index.html,main.ts,vite.golden.config.mts} /tmp/golden/candidate/fixture-golden/
# 3) 수신 서버 + vite (각 worktree 의 apps/editor vite 바이너리 사용)
node scripts/pdf-golden/fixture/receiver.mjs &   # :3199, out/<label>/<name>.pdf 저장
<worktree>/apps/editor/node_modules/.bin/vite --config <worktree>/fixture-golden/vite.golden.config.mts
# 4) 브라우저에서 http://localhost:3100/?label=baseline 열면 자동 캡처(제목 DONE-<label>)
#    같은 label 을 2회 캡처해 결정성(자기일치) 먼저 확인 후 baseline vs candidate 비교
```
- 결정성 원칙: 텍스트/폰트 미사용(로딩 비결정 회피)·고정 좌표/색·동일 브라우저.
- ⚠️ vite.golden.config.mts 는 'vite' 패키지를 임포트하지 않는다(worktree 루트에 vite 부재 —
  플레인 객체 export). 픽스처 확장 시에도 이 제약 유지.

## 디렉터리
- `compare.mjs` — 비교 엔진(CLI + `comparePdfs()` export).
- `compare.test.mjs` — 엔진 자체 회귀 테스트(node:test).
- `fixture/` — 자동 캡처 픽스처(index.html·main.ts·vite.golden.config.mts·receiver.mjs).
- `baseline/`, `candidate/` — 비교용 PDF(대용량이라 git 미추적; `.gitkeep` 만 유지).
