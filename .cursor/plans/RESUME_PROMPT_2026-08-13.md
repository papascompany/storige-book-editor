# RESUME PROMPT — 2026-08-13 (세션 정본 · 내지 PDF 편집기 트랙 W1 + W3 완료·LIVE)

> **이 문서가 최신 날짜 정본이다.** 직전 정본 `RESUME_PROMPT_2026-08-11.md`(트랙 개시·갭 목록 G1~G9)는
> 여전히 유효한 배경 문서 — §2-1(재구현 금지 목록)·§2-2(갭 표)는 그대로 참조한다.
> 작성 2026-08-13 · 기준 master `66c9880`(해시를 믿지 말고 `git fetch`).

---

## 0. 착수 전 확인 (순서 고정)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git status -sb && git log --oneline -8
ssh-add -l | head -1          # 비면: ssh-add ~/.ssh/id_ed25519
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool | head -8
```
- `CLAUDE.local.md`(gitignored) 먼저 — SSH/Vercel/키/레시피 실값.
- 로컬 테스트: `PATH="/opt/homebrew/opt/node@22/bin:$PATH"`. 기준선 editor **619**(596+W1 23) · canvas-core 615 · worker 570 · api **993**(930+W3 63).
- ⚠️ 워커 배포 후 `docker exec storige-worker grep -c <신규문자열> dist/...` 역검증(캐시 함정). api 재배포 시 nginx 재시작.

## 1. 이 세션에서 한 일 — W1 (G1·G2·G3·G5) **프로덕션 LIVE**

> 커밋 `50ffeef` → master push → Vercel `storige-editor` Production **Ready(44s)** →
> 라이브 실기 확인: `editor.papascompany.co.kr/?templateSetId=sample-8x8-book-24p` 에서
> "📎 내지 PDF 첨부" 렌더 + 게스트 세션 발급 + 모달 신규 카피 노출(=신 번들 확인).
> api/worker 무변경 → VPS 배포 불필요.

### 1-1. 오너 결정 (2026-08-13)
| 결정 | 값 |
|---|---|
| /embed 첨부 진입점 노출 | **기본 ON** + 호스트 opt-out `contentPdfAttach=0` (book 모드 templateSet 한정) |
| G6 '앉힌 내지 위 작업'의 인쇄 반영 | **표시전용 유지** — 오버레이 합성 신설 안 함. W1 후 **W3(G7)** 진행 |

### 1-2. 구현 (변경 파일 7 + 신규 테스트 2)
| 파일 | 내용 |
|---|---|
| `utils/contentPdfGuide.ts` | **정본 모듈**. `ensureUnderlayPages()`(추가만·상한 200p·inner 세트 제외·무한루프 가드) + `seatContentPdf()` 신설, `applyContentPdfGuides()` **멱등화**(기존 가이드 제거 후 재배치) |
| `components/editor/EditorWorkflowControls.tsx` | 임베드 겸용화 — `sessionId`/`guestToken`/`offsetRight`/`onAttached` prop. 명시 세션 주입 시 **게스트 세션 자동생성 금지**. 첨부 완료 → 즉시 앉히기 + 토스트. 소유 세션(레거시 `/`)은 ready 후 세션 조회해 앉히기(G3) |
| `components/editor/ContentPdfAttachModal.tsx` | `onAttached` 에 `contentPdfGuide` additive 전달(재조회 불필요), `guestToken` prop override, 페이지 확장 카피 정직화 |
| `embed.tsx` | 첨부 진입점 마운트(G2) + 로드 앉히기를 `seatContentPdf` 로 통일 + `options.contentPdfAttach` + `editor.contentPdfAttached` 이벤트(additive) |
| `views/EmbedView.tsx` | `contentPdfAttach` URL 파라미터 파싱(`0|false` 만 off) |
| `views/EditorView.tsx` | 우측 네비와 겹치지 않게 `offsetRight` 전달 |
| `hooks/useEditorContents.ts` | `UNDERLAY_MAX_PAGES` 중복 선언 제거(contentPdfGuide 와 공유) |
| 신규 테스트 | `contentPdfGuide.seat.test.ts`(14) · `EditorWorkflowControls.test.tsx`(9) |
| 문서 | `docs/EDITOR.md` §13.2 + **§13.2-A 앉히기 계약** 신설 / `docs/PLATFORM_INTEGRATION_GUIDE.md` 파라미터표·이벤트표·설명 블록 |

### 1-3. 검증
- editor **619/619 pass**(기준선 596 + 신규 23) · `tsc -b` 0err · 변경 파일 eslint 0err.
- 실기(dev 서버 → prod API, `/?templateSetId=sample-8x8-book-24p`): 첨부 버튼 렌더 + 게스트 세션 발급 확인, 버튼 위치 겹침 수정 후 재확인.
- ⚠️ **미수행**: 실제 PDF 첨부 E2E(업로드→검증→래스터→앉히기)는 실주문 세션·프로덕션 쓰기가 필요해 하지 않았다. 배포 후 1회 실기 확인 필요.

### 1-4. 이 세션에서 적발한 **기존 결함**(실기에서만 드러남)
- `GET /template-sets/:id` 는 **JWT 필수**(`@Public` 없음) → **비로그인 고객 401**.
  - 결과 ①`EditorWorkflowControls` 가 templateSet 을 못 받아 **컴포넌트 전체가 렌더 안 됨** = 첨부 진입점이 게스트에게 원래부터 없었다.
  - 결과 ②`applyContentPdfGuides` 의 `contentPdfEditable` 조회가 401 → catch 폴백으로 **항상 '편집 허용'** = 잠금 설정 무력화.
  - 조치: 두 곳 모두 공개 라우트 `GET /template-sets/:id/with-templates`(@Public)로 교체. 편집기 내 JWT 전용 호출자는 이제 0건(grep 확인).

## 1-A. W3 (G7) — compose-mixed 세션 자동 조립 + 문서 정정 **(프로덕션 LIVE)**

> 서브에이전트 오케스트레이션 4라운드(정찰 6 → 문서정정 6 → 구현 7 → 마무리 7 = 26에이전트).
> 커밋 `be2b5dc`(고아정리) + `defaf9a`(W3) → VPS 수동 배포 완료(2026-08-13 15:42 KST,
> `docker compose up -d --build api` + `docker compose restart nginx`). health 200·502 없음.
> **프로덕션 실측 스모크**: 빈 입력 → `400 EMPTY_COMPOSE_INPUT` / 자동조립 무인증 → `404 SESSION_NOT_FOUND`
> (둘 다 잡 미생성 확인 — 최근 10분 worker_jobs 0행). 부팅 로그 오류 0.

### 1-A-1. 정찰이 뒤집은 전제 + 프로덕션 실측
- G7 의 정체 = **문서 결함이 주, 미구현 기능이 부**. 워커는 **무변경**으로 성립(서버가 기존 큐 키를 채움).
- 실측(2026-08-13): compose-mixed 호출 이력 **0건** · 세션 `site_id` 스탬프율 88/97(7월 19/19) ·
  `template_sets.endpaper_config` **23행 전부 NULL**(= 정찰이 1순위 blocker 로 본 '편집가능 면지'가 실재 0건).
- 산출물 `/storage/outputs/<jobId>/*.pdf` 는 **무인증 공개** 서빙(206 실측). `GET /worker-jobs/:id/output` 은
  사이트 API 키로 **401**(ApiKeyGuard 미적용) — **파트너 경로가 아니다**(문서에 잘못 적혀 있던 것을 정정).

### 1-A-2. 오너 결정
| 결정 | 값 |
|---|---|
| 빈 입력(자산 0건) 처리 | **400 `EMPTY_COMPOSE_INPUT` 전면 승격** (종전: 백지 1p COMPLETED) |

### 1-A-3. 구현 (전부 additive · 워커/에디터/스키마 0줄)
- `assembleFromSession?: boolean` opt-in. **미전달 시 기존 경로 바이트 불변**(분기 게이트 최상단, 큐 키 집합 동일 — 단언으로 잠금).
- 세션 도출: 표지(`session.coverFile`) · 내지(`contentPdfFileId` 우선 → `contentFile`) · 면지(endpaperConfig 개수만큼 null) ·
  치수(metadata.spread → templateSet, 펼침면/작업사이즈 보정) · `job.siteId`=session.siteId · callbackUrl 폴백.
- **인가**: `@Public` 유지 + `OptionalShopJwtGuard` additive → 호출자 siteId ↔ session.siteId 일치 **+ 주문 스코프
  (`allowedOrderSeqnos`)**. 실패는 전부 동일한 `404 SESSION_NOT_FOUND`(존재 은닉, books 패턴).
  ※ 주문 스코프는 적대검증이 MAJOR 로 적발 — siteId 만으로는 **같은 테넌트의 타 고객 세션**이 열렸다.
- 도출 실패 → `400 SESSION_ASSEMBLY_INCOMPLETE {missing[]}`.
- **siteId 위조 차단**: 무인증 라우트라 body `siteId` 를 그대로 스탬프하던 것을 **호출자 siteId 와 일치할 때만 채택**(그 외 NULL + warn).
  파급: NULL 잡은 v2 웹훅 게이트가 닫혀 타 테넌트 엔드포인트로 배달되지 않는다.
- **고아정리 역참조 정합**(데이터 손실 방지): compose 옵션 절이 `file_url` 하고만 비교해 `api://<id>`·`file_path` 를
  전부 miss 하던 것을 입력 URL 절과 같은 5형식 규약으로 통일. 적대검증이 **같은 결함이 `createSynthesisJob`
  내지 참조에도 있음을 MAJOR 로 추가 적발** → 함께 해소. 고아 쿼리 실패의 침묵 장애도 Sentry 알림으로 승격.

### 1-A-4. 검증
- api **993 pass / 69 suites**(기준선 930 + 신규 63) · `tsc` 0err · lint 0err(경고는 기존분).
- 동결 계약 `contract-freeze.spec.ts`(auth:'public') 통과 — 가드는 ApiKeyGuard 가 아니라 additive.
- 삭제 안전성: 추가 항이 전부 `NOT EXISTS(...)` 내부 OR 체인 = **덜 지우는 방향**(메인 세션 직접 확인). 뮤테이션 테스트로 회귀 검출력도 실증.
- ⚠️ **미검증**: 실 DB 에서 새 SQL(JSON_SEARCH 최초 사용) 실행 경로. 배포 후 `FILE_ORPHAN_DRY_RUN=1` 상태로 cron 1회 로그 확인 필요.

## 1-B. W4-G4 (페이지 재정렬) — 구현 · **이 커밋으로 editor 배포**

> 2026-08-13 Grok 세션. editor 전용(api/worker 0줄). 단위테스트 26 + W1 9 pass · `tsc -b` 0err.
> 실기(책 템플릿 DnD → 페이지 전환·저장 재로드)는 배포 후 1회.

- `SpreadPagePanel` 내지 HTML5 DnD (표지 고정, 내지전용 펼침면은 전 페이지, 터치는 비활성).
- `reorderByIndex` 가 DOM 컨테이너 순서도 맞춤(`setPage` DOM 인덱스 함정) + 스프레드면 책등 debounce.
- 내지 PDF 매핑: `metadata.contentPdfPageOrder`(shallow-merge 안전). 인쇄는 원본 PDF 순서(G6).
- 정본 순열: `utils/innerPageReorder.ts` (`computeInnerReorder` 는 BookNavigation 과 공유).

## 2. 다음 타순

1. **G4 라이브 실기 1회** — 책 템플릿에서 내지 DnD → 페이지 전환이 맞는 캔버스인지·저장 후 재로드 순서.
   내지 PDF 첨부가 있으면 가이드가 `contentPdfPageOrder` 를 따라오는지 + 인쇄는 원본 순서라는 토스트.
2. **실주문 실기 1회** — 실제 내지 PDF 첨부 → 즉시 앉히기·페이지 확장·최종 산출(원본 PDF) 육안 확인.
   `/embed` 는 세션이 있어야 첨부가 뜨므로 실주문(또는 재편집 `sessionId`) 경로로 확인할 것.
   롤백이 필요하면 `vercel promote <직전 Ready URL>`(직전 Production = 3h 전 Canceled 이므로
   `vercel list storige-editor` 에서 마지막 Ready 를 찾아 promote).
3. **고아정리 cron 1회 관찰** — 새벽 03:00 KST 이후 `docker logs storige-api | grep -i orphan` 으로
   새 SQL(JSON_SEARCH 최초 사용) 실행 오류 없음 + 후보 표본 확인. `FILE_ORPHAN_DRY_RUN` 미설정 = **dry-run ON**
   이라 삭제는 일어나지 않는다(실측). 오류 시 Sentry `alert.type=orphan-query-failed` 로도 뜬다.
4. **파트너 안내** — 공지문 `docs/PARTNER_NOTICE_2026-08-13_compose_mixed.md` 작성 완료. 발송은 오너 판단.
   통합가이드 §3.4/§3.4.1 갱신분(빈 입력 400 승격·결과 회수 경로 정정·자동조립 신설)을
   bookmoa-mobile·100p Books·MD2Books 에 릴레이. **빈 입력 400 은 관측 가능한 동작 변화**다(호출 이력 0건이라 실파손은 없음).
5. **W4 잔여 = G9(반복 규칙)**. G8(레더커버·면지)은 착수 보류 — 프로덕션에 해당 상품 0건.

## 3. 함정 색인 (신설분만 — 08-11 §3 는 계속 유효)

- **게스트 401 라우트**: 편집기 고객 경로에서 `GET /template-sets/:id` 금지. 공개본은 `/with-templates`. (테스트가 이 불변식을 잠금 — 두 테스트 파일 모두 JWT 라우트 호출 시 throw)
- **앉히기는 항상 `seatContentPdf` 한 곳**: /embed 로드·첨부 직후·EditorView 로드 3곳 대칭. 한쪽만 고치면 G1/G3 재발.
- **페이지 재정렬은 `reorderByIndex` + `syncCanvasContainerOrder`**: 배열만 바꾸면 `setPage` 가 다른 페이지를 보여 준다. 표지(캔버스 0)는 고정.
- **즉시 확장 페이지는 빈 페이지**(재로드는 마지막 내지 템플릿 복제) — underlay 는 원본 PDF 인쇄라 인쇄 영향 0. 설계상 수용, 문서화됨(EDITOR.md §13.2-A).
- **첨부 진입점 노출 조건**: book 모드 + **세션 존재**(재편집 `sessionId` 또는 신규 `orderSeqno`+`mode`). 세션 없는 진입(`templateSetId` 만)에서는 안 뜬다 — 파트너가 "안 보인다" 하면 여기부터 확인.
- dev 서버 실기 시 캔버스가 백지로 보이는 현상은 **기존 환경 이슈**(stash 로 베이스라인에서도 재현 — canvas0 0×0). 내 변경과 무관.

## 4. 정본 포인터

| 주제 | 정본 |
|---|---|
| 트랙 배경·갭 표(G1~G9) | `RESUME_PROMPT_2026-08-11.md` §2 |
| 앉히기 계약·첨부 진입점 | `docs/EDITOR.md` §13.2 / §13.2-A |
| 파트너 계약(파라미터·이벤트) | `docs/PLATFORM_INTEGRATION_GUIDE.md` |
| 업계표준 트랙(R1~R10) | `EDITOR_PDF_STANDARD_AUDIT_2026-08-09.md` |
| 운영 실값 | `CLAUDE.local.md`(gitignored) |
