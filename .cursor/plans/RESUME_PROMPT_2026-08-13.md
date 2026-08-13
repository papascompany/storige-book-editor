# RESUME PROMPT — 2026-08-13 (세션 정본 · 내지 PDF 편집기 트랙 W1 완료)

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
- 로컬 테스트: `PATH="/opt/homebrew/opt/node@22/bin:$PATH"`. 기준선 editor **619**(596+W1 23) · canvas-core 615 · worker 570 · api 930.
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

## 2. 다음 타순

1. **실주문 실기 1회** — 실제 내지 PDF 첨부 → 즉시 앉히기·페이지 확장·최종 산출(원본 PDF) 육안 확인.
   `/embed` 는 세션이 있어야 첨부가 뜨므로 실주문(또는 재편집 `sessionId`) 경로로 확인할 것.
   롤백이 필요하면 `vercel promote <직전 Ready URL>`(직전 Production = 3h 전 Canceled 이므로
   `vercel list storige-editor` 에서 마지막 Ready 를 찾아 promote).
2. **W3 (G7)** — `compose-mixed` 가 `editSessionId` 만으로 자동 조립되게 additive 확장 + 통합가이드 curl 예시 정정(현재 예시 그대로 쓰면 빈 산출).
3. **W4** — G8(레더커버 배선·면지 — 임베드 배너는 W1 에서 의도적으로 보류) → G4(페이지 재정렬 UI) → G9(반복 규칙).
4. 배포 후 실기 1회: 실제 내지 PDF 첨부 → 즉시 앉히기·페이지 확장·인쇄 산출(원본 PDF) 확인.

## 3. 함정 색인 (신설분만 — 08-11 §3 는 계속 유효)

- **게스트 401 라우트**: 편집기 고객 경로에서 `GET /template-sets/:id` 금지. 공개본은 `/with-templates`. (테스트가 이 불변식을 잠금 — 두 테스트 파일 모두 JWT 라우트 호출 시 throw)
- **앉히기는 항상 `seatContentPdf` 한 곳**: /embed 로드·첨부 직후·EditorView 로드 3곳 대칭. 한쪽만 고치면 G1/G3 재발.
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
