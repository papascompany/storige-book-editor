# RESUME PROMPT — 2026-08-11 (세션 정본 · 업계표준 트랙 완결 + 내지 PDF 편집기 트랙 개시)

> **이 문서가 최신 날짜 정본이다.** 직전 정본 `RESUME_PROMPT_2026-08-07.md`(컷아웃 트랙)는 참조용.
> 업계표준 트랙 상세 정본 = `EDITOR_PDF_STANDARD_AUDIT_2026-08-09.md` (R1~R10 상태·GWG 분류표).
> 작성 2026-08-11 · 기준 master `31c001f`(해시를 믿지 말고 `git fetch`).

---

## 0. 착수 전 확인 (순서 고정)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git status -sb && git log --oneline -8
ssh-add -l | head -1          # 비면: ssh-add ~/.ssh/id_ed25519
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool | head -8
```
- `CLAUDE.local.md`(gitignored) 먼저 — SSH/Vercel/키/레시피 실값.
- 로컬 테스트 Node 22: `PATH="/opt/homebrew/opt/node@22/bin:$PATH"`. canvas.node 는 이 Mac 에서
  네이티브 재빌드 완료(canvas-core 52스위트 전green — 기준선 4스위트 실패는 소멸).
- ⚠️ **워커 배포 함정(08-11 실증)**: `docker compose build worker` 가 캐시로 신규 커밋을 안 태울
  수 있다 — 배포 후 반드시 `docker exec storige-worker grep -c <신규문자열> dist/...` 역검증,
  스테일이면 `--no-cache` 재빌드. api 재배포 시 nginx 재시작 별도 함정 유지.

## 1. 이 세션 완결 상태 (2026-08-09~11, 전부 프로덕션 LIVE)

| 트랙 | 내용 | 검증 |
|---|---|---|
| 게스트 401 | registerUploadedPhoto → /storage/upload-public 전환(+평면 응답 결함 동시 수정) | 라이브 401→201 실증 |
| R1 | /embed 재단·안전영역 경고 토스트 배선 | editor 596 |
| R2 | poppler 프리플라이트 승격(pdffonts·pdfimages 실배치 DPI, 정규식 폴백화) | 컨테이너 e2e |
| R3 | TAC 잉크총량 warn(ink_cov — **% 스케일 함정**, 한계 주입 자리+env+320%) | 349.8% 실측 |
| R4a | 주석/폼 검출+재증류 자동 제거(-dPreserveAnnots=false 4경로) | 왕복 1→0 |
| R4b | **화이트 오버프린트 정밀 검출**(QDF 연산자 스캔)+기하 이상(UserUnit/Rotate/CropBox) | 흰 도형+OP 검출 |
| R5 | 최종 산출 정규화(X-1a: CMYK+OutputIntent+선택 평탄화) — **다크 배포(PRINT_NORMALIZE=false)** | `1 0 0 rg`→`0 .965 .906 0 k`·별색 보존 |
| Wave1 | R7 cv레거시 pureContour 이식(모양틀 최초 실동작)·R8 DPI 경고·R9 **곡선텍스트 벡터화 개통**(침묵실패 적발) | 각 머지 게이트 |

- 기준선(로컬): editor 48/596 · canvas-core 52/615 · worker 23/570 · api 66/930 · tsc/lint 0err.
- 오너 게이트 대기: **R5 ON**(실주문 골든 육안→.env PRINT_NORMALIZE=true+워커 재기동, 롤백=플래그 제거).
- 실기 확인 대기: 곡선텍스트 골든·모양틀 칼선·DPI 토스트 각 1회.
- 업계표준 잔여(후순위): R6 칼선 CutContour 별색·R10 마스크 브러시·R3b API 지종 TAC 주입·R4b 제거실행기.

## 2. ★ 신규 우선 트랙 — 표지·내지 편집기 / 템플릿 제작 / PDF 내지 편집기 로딩

> 오너 지시(08-11): "표지·내지 편집기 구동, 템플릿 제작, 편집 기능, **PDF 내지 첨부 시 편집기로
> 로딩해 페이지에 앉혀 보여주고 작업**하는 프로세스를 우선 작업". 아래는 3에이전트 코드 실물
> 정찰(08-11) 결과 — 문서 아닌 코드 기준.

### 2-1. 이미 구동되는 것 (재구현 금지)

- **표지 편집 코어 완비**: SpreadPlugin(펼침 표지+책등 가변+conversionMode 3종+regionScope),
  표지↔내지 전환(BookNavigation·navPosition), 판형은 templateSet 이 결정.
- **내지 편집 완비**: BOOK=표지 스프레드 캔버스[0]+단면 내지[1..N] / PHOTOBOOK 내지=별도 세트
  캔버스 1장=2-up 펼침면(08-03 개통 — API·admin·editor 3자 해소 확인). 추가/삭제/선택 OK.
- **세션 구조 완비**: edit_sessions 에 contentPdfFileId/PageCount/ValidationResult/Mode
  ('replace'|'underlay') 컬럼 실존. 면지는 canvasData 에 없음(endpaper_config→워커 합성).
- **템플릿 제작 완비**: admin=iframe 으로 editor /template 임베드(JWT token+checkAuth 승격 방어),
  표지 spread·내지 단면·포토북 inner spread 전부 제작 경로 존재. **IDML 변환기 =
  packages/indesign-import 독립 패키지**(변환→SVG 미리보기→저장→셋 등록 admin 내 완주).
- **PDF 첨부 플로우 완비**(ContentPdfAttachModal): 업로드(≤50MB public/2GB presigned)→검증
  (FIXABLE=진행, failed 만 거부)→BLEED_MISSING 자동 fix-bleed→세션 PATCH+render-pages 잡
  →metadata.contentPdfGuide{pageImageUrls} 저장.
- **PDF 렌더 아키텍처 확정**: 클라이언트 pdfjs 없음(의도) — 워커 render-pdf-pages 잡(110dpi,
  200p 캡, POST /worker-jobs/render-pages @Public)이 래스터 → contentPdfGuide.ts 가 fabric
  이미지로 각 내지 캔버스에 잠금 배경(excludeFromExport) 배치.
- **워커 합성 규칙 완비**(compose-mixed): [표지, 앞면지, 내지PDF, 뒷면지] 고정, null 면지=빈페이지,
  outputMode 4종, 2GB qpdf 경로. underlay=임포지션 스킵 원본 인쇄.

### 2-2. 미진(갭) — 이 트랙의 실작업 목록

| # | 갭 | 실물 근거 | 성격 |
|---|---|---|---|
| G1 | **첨부 직후 앉히기 없음** — 배지만 뜨고, 가이드 배치는 /embed?sessionId **재로드 시에만** | EditorWorkflowControls.tsx:180-186 vs embed.tsx:1177-1181 | 코드(핵심) |
| G2 | **/embed 에 첨부 진입점 자체가 없음** — EditorWorkflowControls 가 레거시 / 전용 마운트 | EditorView.tsx:704·App.tsx:41-48 | 코드(핵심) |
| G3 | applyContentPdfGuides 가 /embed 로드에만 — EditorView(/)는 재로드해도 안 보임(비대칭) | EditorView grep 0건 | 코드 |
| G4 | 페이지 재정렬/매핑 없음 — PDF↔페이지 고정 1:1, PagePanel DnD 0건, spread 모드 DnD 부재 | contentPdfGuide.ts:45-47·PagePanel.tsx:24-37 | 코드(중형) |
| G5 | 첨부 직후 페이지 수 즉시 확장 미구현(targetPageCount 미소비 — 재로드 시에만 PDF 페이지수로 생성) | ContentPdfAttachModal.tsx:694-723 | 코드 |
| G6 | **'작업'의 의미 미확정** — underlay 는 표시전용(가이드 위 편집은 인쇄 미반영, 원본 인쇄). 앉힌 내지 위에 얹은 객체를 인쇄에 반영하려면 오버레이 합성 신설 필요 | edit-sessions.service.ts:876-882 | ⚠️ 오너 결정 |
| G7 | **통합가이드 compose-mixed 예시대로 호출하면 에러 없이 '성공한 백지 PDF'** — DTO 필수 필드 0건(@IsOptional 14/필수 0)이라 `{editSessionId, orderId}` 만으로 201, 서버는 세션에서 `metadata.spread` 만 읽고(best-effort try/catch, 세션 없어도 통과) 파일은 자동 해석하지 않음 → coverUrl 없으면 A4 백지 1p + 내지 skip 으로 status=COMPLETED. ⚠️ 성격 보정: **문서 결함이 주(主)**이고, "editSessionId 만으로 세션 자동 조립"은 결함이 아니라 **현재 미구현 기능**(별도 트랙 검토 대상 — 이번 트랙에서 약속하지 않음) | create-compose-mixed-job.dto.ts:20-110 · worker-jobs.service.ts:1173-1206 · synthesis.processor.ts:432·445·588-590·602·617-618 vs PLATFORM_INTEGRATION_GUIDE.md:890-896 | 문서(주) + 미구현 기능 |
| G8 | LeatherCoverPreview 미배선(coverEditable=false 여도 표지 편집 노출·배너만)·면지 배너 / 전용·book 모드에서 endpaper 템플릿 페이지 전개 무시 | loadSpreadModeEditor:1460·1615 | 코드 |
| G9 | 페이지 가변 반복 규칙 = 마지막 페이지 복제 고정(좌/우 교대 등 패턴 메타 없음)·포토북 inner 후속 펼침면 반복 미정 | useEditorContents.ts:1623-1642 | 설계+코드 |

### 2-3. 권장 착수 순서

1. **W1 (즉효, 앉혀 보여주기 완성)**: G1+G2+G3 — 첨부 완료 시점에 render-pages 결과로
   applyContentPdfGuides 즉시 호출 + /embed 에 첨부 진입점 마운트 + EditorView 로드 배선(대칭).
   G5(즉시 페이지 확장)도 같은 흐름에서 해소.
2. **W2 (오너 결정 선행)**: G6 — '앉힌 내지 위 작업'의 인쇄 반영 여부.
   (a) 표시전용 유지(현행 계약, 안내 문구 강화) (b) 오버레이 인쇄 합성(내지PDF 위에 세션 객체
   레이어를 겹쳐 인쇄 — 워커 합성 신설, 중형). 결정 후 구현.
3. **W3**: G7 — **통합가이드 compose-mixed 예시 정정(문서 전용, 코드·계약 무변경)** 으로
   '성공한 백지 PDF' 사고를 차단. editSessionId 자동 조립(세션의 contentPdfFileId/coverUrl/
   endpaperConfig 해석)은 현재 **미구현 기능** — 별도 트랙 검토 대상이며 여기서 약속하지 않는다.
   - ⚠️ **문서 트랙 밖 에스컬레이션(코드 사안, 오너 결정)**: `POST /worker-jobs/compose-mixed` 는
     `@Public` 인데 서버가 **호출자가 보낸 `dto.siteId` 를 그대로 잡에 기록**한다
     (worker-jobs.service.ts:1215 `siteId: dto.siteId || null`). 무인증 호출자가 임의 테넌트의
     siteId 를 실으면 잡이 그 사이트 소유로 귀속되고, 그 사이트의 v2 웹훅 설정이 있으면
     콜백까지 그 파트너 엔드포인트로 발신될 수 있다(:1958-1967 게이트 `hasV2ConfigForJob(job, job.siteId)`).
     → 통합가이드 허용 필드 표에서 `siteId` 행은 **제거**(광고 금지)했고, 코드 차원 조치
     (컨트롤러에서 body siteId strip 또는 ApiKeyGuard+@CurrentSite 도입)는 미착수.
   - ⚠️ **표지 회수 구멍**: `separate`(스프레드 책 강제 모드)의 `cover.pdf` 를 바이트로 내려주는
     파트너용 라우트가 없다 — `GET /worker-jobs/:id/output` 은 `result.outputFileUrl`(=content.pdf)
     하나만 스트리밍(worker-jobs.controller.ts:569-572), cover 는 `outputFiles[].url` 경로로만 노출.
     가이드에는 '운영자 확정' 으로 명시했으나 실제 전달 수단은 오너 결정 필요.
4. **W4**: G8(레더커버·면지 배선) → G4(재정렬 UI) → G9(반복 규칙).

## 3. 함정 색인 (이 세션 신설 — 위반 시 재발)

- **워커 배포 = dist 역검증 필수**(§0). editor/admin 은 Vercel 자동, api/worker 수동+nginx.
- GS `ink_cov` 출력은 **% 스케일**(inkcov 0~1 분율과 다름) — ×100 금지.
- GS `-dSAFER` 는 PDFX def 의 ICC `file` 읽기를 차단 — `--permit-file-read=<icc>` 필요.
- ICC(JapanColor2001Coated.icc)는 VPS `~/storige/storage/icc/` — **레포 커밋 금지**(재배포 제한).
- fixMethod 발행=wiredAutoFixable 경유 불변식 유지(C+ 게이팅). types 미러는 additive 만(S-1 계약
  spec 이 강제 — api jest 가 잡는다).
- 병렬 구현 오케스트레이션 관행: `.claude/worktrees/` 수동 워크트리+배타 파일 소유권 명세
  +기준선 수치 제공+머지는 메인 세션 게이트(canvas-core build→editor 순서).
- 곡선 텍스트는 이제 **벡터 경로**를 탄다(R9 개통) — svgTextToPath 다중루트 래핑 제거 금지.

## 4. 정본 포인터

| 주제 | 정본 |
|---|---|
| 업계표준 트랙 전체(R1~R10·GWG 분류표·Adobe 판정) | `EDITOR_PDF_STANDARD_AUDIT_2026-08-09.md` |
| PDF 첨부·면지·게스트 워크플로 사양 | `docs/EDITOR.md` §13 + fabric-editor 스킬 |
| 파트너 합성 계약(compose-mixed) | `docs/PLATFORM_INTEGRATION_GUIDE.md` (⚠️ §compose curl 예시는 G7 불일치) |
| 포토북 내지 스프레드 | photobook-template 스킬 + `RESUME_PROMPT_2026-08-03.md` |
| 운영 실값 | `CLAUDE.local.md`(gitignored) |

## 5. 새 세션 시작 프롬프트 (복사해서 그대로 사용)

```
storige 프로젝트 — 표지·내지 편집기 / 템플릿 제작 / PDF 내지 편집기 로딩 트랙을 시작합니다.

착수 전:
1. CLAUDE.local.md (SSH/Vercel/키/레시피 실값)
2. .cursor/plans/RESUME_PROMPT_2026-08-11.md — 이 문서가 정본. §0 확인 → §2 신규 트랙.
3. git fetch && git log --oneline -8 && git status -sb

현재 상태(§2-1 — 재구현 금지): 표지 스프레드·내지 다페이지·포토북 inner·템플릿 제작
(admin iframe+IDML 변환기)·PDF 첨부 플로우(검증→fix-bleed→세션 저장→워커 110dpi 래스터)
·compose-mixed 합성 규칙까지 전부 구동. PDF 렌더는 클라이언트 pdfjs 없이 워커 래스터
+fabric 이미지 배치가 확정 아키텍처다.

작업 목표(§2-2 갭, §2-3 순서로):
W1 = G1+G2+G3+G5: PDF 내지 첨부 직후 편집기에 즉시 '앉혀 보여주기' 완성 —
  ①첨부 완료 시 applyContentPdfGuides 즉시 배치 ②/embed(프로덕션 경로)에 첨부 진입점
  마운트(현재 레거시 / 전용) ③EditorView 로드 배선 대칭 ④페이지 수 즉시 확장.
W2 = G6(⚠️ 오너 결정 선행): 앉힌 내지 위 '작업'의 인쇄 반영 여부 — 표시전용 유지 vs
  오버레이 인쇄 합성(워커 신설). 결정 받고 진행.
W3 = G7: 통합가이드 compose-mixed 문서 정정(문서 전용 — 코드·파트너 계약 무변경).
  editSessionId 자동 조립은 미구현 기능이라 별도 트랙 결정 대상(이번 트랙 범위 아님).
W4 = G8(레더커버 배선·면지)→G4(페이지 재정렬 UI)→G9(반복 규칙).

주의(§3): 워커 배포 후 dist grep 역검증 필수(캐시 함정). /embed 가 파트너 정본 경로 —
배선은 항상 EditorView·embed 양쪽 대칭(F4 사고 전례). edit_sessions 스키마 변경은
additive+마이그레이션 직접 실행 순서. 로컬 테스트 PATH="/opt/homebrew/opt/node@22/bin:$PATH",
기준선 editor 596·canvas-core 615·worker 570·api 930.
```
