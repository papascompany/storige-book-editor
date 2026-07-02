# PDF 골든 회귀 하네스

렌더·변환 파이프라인 변경이 **PDF 출력을 바꾸지 않았는지** 자동 판정하는 도구.
저장소에 골든/픽셀 diff 인프라가 없어 Phase 0(2026-07-03)에 신설. Track A(canvas-core 지연로딩)
검증이 첫 사용처이며, 이후 모든 PDF 렌더 변경(jspdf/svg2pdf/pdf-lib/합성)에 재사용한다.

## 무엇을 비교하나 (계층)
1. **페이지 수** (`qpdf --show-npages`) — 누락/추가 페이지. 버전 안정.
2. **정규화 콘텐츠 해시** (`qpdf --qdf --deterministic-id`) — 비결정 메타(/ID·/CreationDate·/ModDate·
   XMP 타임스탬프) 제거 후 sha256. **byte-identical(모듈로 메타) 이면 확실한 통과.** 지연로딩처럼
   "출력 로직 무변경" 을 표방하는 변경의 핵심 검증축.
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

## Track A 검증 절차 (ADR-1)
Track A 5커밋(b432ade/c853a37/38bca11/33d3b5a/7480fa1)은 정적 import→dynamic import 전환만으로
PDF 출력 무변경(byte-identical)이 의도. 골든으로 실증한다.

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

## 캡처 자동화(후속 과제)
현재 편집기에는 **결정적 픽스처 로드 경로가 없어**(e2e 는 UI 상호작용 기반) 위 1)·2)의 PDF 캡처는
수동이다. 완전 자동화하려면 편집기에 '픽스처 세션(canvas JSON) 로드 + `ServicePlugin.saveMultiPagePDFAsBlob`
호출 → 바이트 저장' 하는 Playwright 스텝(또는 테스트 전용 라우트)이 필요하다. 이 하네스의 비교 엔진은
그 캡처가 생기면 그대로 소비한다(엔진↔캡처 분리 설계). 캡처 스텝 신설은 Phase 1 후속 항목.

## 디렉터리
- `compare.mjs` — 비교 엔진(CLI + `comparePdfs()` export).
- `compare.test.mjs` — 엔진 자체 회귀 테스트(node:test).
- `baseline/`, `candidate/` — 비교용 PDF(대용량이라 git 미추적; `.gitkeep` 만 유지).
