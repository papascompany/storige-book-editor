# RESUME PROMPT — 2026-09-28 (Storige · 파트너 협업 세션)

> **이 문서가 최신 날짜 정본이다.** 상세 이력은 `RESUME_PROMPT_2026-09-12.md`(§8 시간순 누적, 09-12~09-28)에 있다. 이 문서는 새 세션이 바로 일할 수 있게 **현재 상태·채널·대기·결정만** 압축했다.
> 이 문서와 충돌하는 옛 문서 서술은 이 문서가 우선이다. 단, 이 문서도 작성 시점(2026-09-28 ~09:30Z)의 스냅샷이다 — 파일·Git·운영 상태로 재확인하고 쓴다.

---

## ▶ 새 세션 시작 프롬프트 (그대로 붙여 넣기)

```text
Storige 편집기 개발을 이어서 진행합니다. bookmoa·printy 파트너 세션과 크로스세션 메시지로 협업합니다.

1) 시작 절차
   - CLAUDE.local.md 의 운영 규칙과 참조 위치만 확인합니다. 비밀값은 출력·복제하지 않습니다.
   - .cursor/plans/RESUME_PROMPT_2026-09-28.md 를 먼저 읽습니다. 과거 경위가 필요할 때만 RESUME_PROMPT_2026-09-12.md §8 을 봅니다.
   - git log --oneline -10 · git status -sb 를 확인합니다. untracked 타 세션 파일은 건드리지 않습니다.
   - SSH 가 필요하면 ssh-add -l 을 확인합니다. 접속은 deploy@(CLAUDE.local.md §1.1) 한 대상만 씁니다.
2) 파트너 채널 확인
   - ListAgents 로 활성 bookmoa·printy 세션을 찾습니다. 이 문서 §2 의 id 와 대조하고, 이름이 바뀌었으면 §2 확증법으로 cwd 를 확인합니다.
   - 양사에 "Storige 새 세션 시작 + 이 세션 id" 를 한 줄로 통지하고 ACK 를 요청합니다.
3) 이 문서 §4 대기 항목 중 회신이 도착한 것부터 처리합니다.
   - 회신마다 운영 DB·로그와 대조합니다(읽기 전용, 집계 시각 UTC 명시).
   - 결과는 RESUME 에 기록하고, 커밋 전 gitleaks 를 통과시킨 뒤 푸시합니다.
4) 규칙
   - 배포·운영 DB 쓰기·파트너 약속(착수 시점)·제품 결정은 사용자 승인 후에만 합니다.
   - 사실 확인 회신(코드·운영 실측)은 바로 보내도 되고, 보낸 내용은 RESUME 에 남깁니다.
   - 보안 취약점 서술은 교정이 배포되기 전에는 공개 저장소에 커밋하지 않습니다.
   - 사용자에게는 한국어로 결과부터 짧게 보고합니다.
```

---

## 1. 현재 라이브 상태 (2026-09-28 ~09:30Z)

| 구성 | 마지막 배포 | 롤백 |
|---|---|---|
| DB | `template_sets.page_step INT NULL` 추가(09:05Z, additive) | 덤프 `~/backup-template_sets-pre-s8-20260928.sql`(VPS). 컬럼은 남겨도 무해 |
| worker | 09:10:56Z (S6·S7) | `storige-worker:rollback-pre-s6s9` |
| api | 09:12:53Z (S6·S7·S8) + nginx 재시작 | `storige-api:rollback-pre-s6s9` → 그 이전 `rollback-pre-copyfix` · `rollback-pre-r195` · `rollback-pre-w1` |
| editor·admin | Vercel master push 자동(09:07Z 전후 Ready) | Vercel 이전 배포 promote |

- master = origin/master. 배포 방식:
  - editor·admin 은 master push 가 곧 배포다(**push 전 승인**).
  - api·worker 는 VPS 에서 수동 배포한다(`CLAUDE.local.md` §6). **api 를 재생성하면 nginx 재시작이 필수**다.
- 비상 차단: `EDITOR_SPREAD_VALIDATION_MAPPING=off`(API env) — 편집기 스프레드 책 검증 잡 매핑(R-195)을 끈다. 미설정이면 ON 이다.
- 런타임: `PATH="/opt/homebrew/opt/node@24/bin:$PATH"`(v24.20.0). 기본 node 26 은 쓰지 않는다(canvas ABI 137).
- 워크트리: `.claude/worktrees/multitenancy-p3b`(P3b 백로그, 보존) 하나만 남아 있다. 워크플로 워크트리 4개는 09-28 에 정리했다.
- untracked 타 세션 파일(`.tmp-verify-combos/`, `docs/PLATFORM_INTEGRATION_GUIDE.backup-*` 등)은 건드리지 않는다. `git add` 는 항상 명시 목록으로 한다.

### 검증 기준선 (09-28 통합 실측 — 이보다 낮으면 회귀)

| 대상 | 기준 |
|---|---|
| api jest | 82 스위트 / 1166 PASS · tsc 0 |
| worker jest | 23 스위트 / 645 PASS · tsc 0 |
| editor vitest | 72 파일 / 871 PASS · tsc 0 |
| admin | tsc 0 |
| canvas-core | 55 파일 / 628 PASS(09-11, 이후 미변경) |

- 참고: worker `crop-mark-validation.spec` 파리티 1건이 **API 스위트와 동시에 돌릴 때만** 간헐 실패한다. 단독으로 돌리면 통과한다(부하성 flaky).

---

## 2. 파트너 채널

| 파트너 | cwd | 현재 세션 | 비고 |
|---|---|---|---|
| bookmoa | `~/Developer/claude/bookmoa-mobile` | **09-28 교체**: "20260928 북모아 개발 계속" · `local_75d4aefc-f026-45ed-b044-df4fdf377c23` · 소켓 `uds:/tmp/cc-socks/47702.sock`(lsof cwd 확증) — 옛 `local_154c5e2a…`/37531 대체 | bypass 모드. 운영 `19ce2a5`(R-198). 펼침면 pageCount 정정 ACK 완료 |
| printy | `~/Developer/claude/printy` | 이름 "20260928 Printy 개발 계속"(표시명이 "…새세션 시작"으로 보일 수 있음) · `local_5ca0cbbf-bacf-4881-b394-7a4fab936804` | 09-28 교체 · 소켓 `uds:/tmp/cc-socks/67905.sock` · 09:24Z ACK 수신. 옛 `local_35adcfea…`("20260926 Printy 개발 계속")는 목록에 남아 있으나 쓰지 않음 |
| **Storige(당사)** | 이 저장소 | 이름 "Storige 편집기 개발 계속" · printy 가 보고한 id `local_7e9f1fad…` | 09-28 새 세션. 양사에 창구 교체 통지·ACK 완료 |

- 세션 이름·id 는 재시작하면 바뀐다. 받은 메시지에 회신할 때는 **`from` 값을 그대로 `to` 로** 쓴다.
  - `uds:/tmp/cc-socks/<PID>.sock` 이면 `lsof -a -p <PID> -d cwd -Fn` 으로 발신자 cwd 를 확증할 수 있다.
- **발신 성공은 도달을 뜻하지 않는다.** 중요한 통지는 ACK 를 요청하고, 레포 문서(가이드·partner-notices)에도 함께 남긴다.
- ⚠️ `printcard-studio-*` 세션은 printy 가 **아니다**(오발신 주의).
- 계약 정본:
  - `docs/PLATFORM_INTEGRATION_GUIDE.md` — §3.1 파라미터·호스트 책등 규칙·pageStep, §3.2 payload, §5.3.1 표지 판정 규칙
  - `docs/CONTRACT_FREEZE.md`(v1.5)
  - `docs/FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md`

---

## 3. 09-28 하루 동안 끝난 것 (상세는 09-12 문서 §8-19 ~ §8-20)

- **R-195 (bookmoa 요청)** — 전부 배포했다.
  - 편집기가 `/embed?spineWidthMm` 를 받는다. full·flat-spine 표지의 초기 책등으로 쓴다.
    - 고정 모드: 용지·제본 코드 중 하나라도 없거나 값이 0 이면 호스트 값을 고정한다.
    - 비고정 모드: 쪽수가 주문 쪽수와 같으면 호스트 값을, 다르면 API 재계산 값을 쓴다.
  - `'-'` 는 미전달로 정규화한다.
  - 완료 시 `metadata.appliedSpine`·`metadata.coverOutput` 을 기록한다. `editor.complete`·레거시 이벤트·`pricingChange` 에 `spineWidthMm` 를 싣는다.
  - API 는 편집기 스프레드 책 검증 잡에 주문 제본·실제 쪽수를 연결한다. 표지 책등 기하는 **편집기가 기록한 출력 크기가 기대식과 일치할 때만** 연결한다(오탐 방지 — 운영 표지 16건 중 6건은 도련 미가산).
  - worker 는 사철 쪽수 규칙을 내지에만 적용한다.
- **S4 무책등 스프링 6세트** 를 운영 DB 에 직접 등록했다.
  - 판형: A4·B5·A5 × 세로·가로. 공용(site NULL), flat-spread, 책등 0, 쪽수 [16,500], `pageStep 2`.
  - id 는 09-12 문서 §8-19-1 표에 있다. **실편집 E2E 는 아직 검증하지 않았다.**
- **템플릿 복사 수정**: `POST /templates/:id/copy` 가 type·판형·spreadConfig 를 보존하고 새 코드를 발급한다.
- **S6~S9 (bookmoa 후속)** — 전부 배포했다.
  - S6: `coverLayout:'separate'` 이면 단일 판형 검사(첫 페이지만).
  - S7: 스냅샷에서 책등 0 을 유효값으로 본다.
  - S8: `pageStep` 필드를 추가했다. 편집기가 이 단위로 증감하고, 배수가 아니면 완료를 막는다.
  - S9: 책등이 확정되면 `pricingChange` 를 1회 재발신한다.
- printy 템플릿셋 스코프 회신 건은 08-26 에 이미 전달된 것으로 확인해 종결했다.
- 양사 모두 R-194·R-195 이식·배포를 끝냈다(bookmoa `a39007a`·`217b52f`, printy `b9356fc`).
  - **전 상품이 spinePolicy legacy** 라 운영 트래픽에는 아직 새 파라미터가 실리지 않는다.

---

## 4. 대기 항목 (회신 오면 처리)

**양사 모두 오너 지시로 실 e2e·템플릿 실테스트를 보류 중이다 → 회신 시점 미정.** 오면 아래를 한다.

1. **bookmoa 첫 실편집 2건**(S4 스프링 1 · flat-spine 무선 + spineWidthMm 1)의 sessionId·완료 UTC
   → `file_edit_sessions.metadata.{coverOutput, appliedSpine, spread.spec, spine}` 과 표지 VALIDATE 잡의 `options.orderOptions`·`result.result.metadata.pageSize`·errors 를 대조한다.
   → 책등 0 표지가 운영에서 처음으로 렌더·완료되는지 확인한다.
2. **printy 오너 e2e**(첫 `synthesize/external` 실합성): synthesisJobId·그 잡 `siteId`(`009c26d5-…` 기대)·편집 sessionId·결과 PDF·UTC
   → `job.siteId` 스탬프와 세션 VALIDATE 를 대조해 **D6 선행 조건 칸을 닫는다**(09-12 문서 §2 D6·§8-17).
3. **bookmoa R-193 D6 실합성 회신** — 2번과 같은 대조를 한다.
4. **당사 약속**: 양사 첫 실합성의 **소요 시간을 초 단위로 실측해 공유**한다.
   - DB `completed_at` 은 초 단위라, 필요하면 api·nginx 로그 타임스탬프를 함께 쓴다.
5. printy 예고: 상품 옵트인 전에 `그린라이트 80`·`아르떼(NW)*` 의 **paper_types code 존재 확인** 요청이 올 예정이다.
   - 해석 순서: code → alias → 정규화(공백 제거·끝 g 제거·소문자). `name` 은 쓰지 않는다.
6. bookmoa S10(WH-005 v2 사이트 전용 `whsec_`): bookmoa 가 착수를 통지하면 Storige 선행(수신 호스트 SSRF 허용 목록·partner test 키)을 함께 진행한다.

### 4-1. 09-28 새 세션 통지 결과 (ACK)

- bookmoa: 대기 3건(첫 실편집 sessionId·D6 실합성·S10 착수)은 오너 지시로 **기본 웹 기능 마무리 뒤로 보류**. 보류 해제 뒤 bookmoa 다음 세션이 발신. S6~S9 배포 계약은 bookmoa 인계문 R-196 1순위로 넘김.
- printy(09:24Z): S6~S9 FYI 대조 완료 — 전 상품 legacy 라 `coverLayout` 미전송, `editor.pricingChange` 수신 처리 없음, 사용 세트 `f0335fda`·`a2cc2939`·`207c458f` 로 **영향 없음**. 첫 실합성 회신값은 실 e2e 보류로 미정. paper_types code 확인 요청은 책등 옵트인 준비 단계에서 발신 예정.

- bookmoa 새 창구(`local_154c5e2a`, 09-28 수신): R-196 운영 배포 09:38Z(new.bookmoa.com `54828a0`, DB 변경 없음) — validate 429 시 Retry-After 재시도(최대 3회)·job-status 400/401/403/404 폴링 즉시 중단·경합 가드 DB 조회 실패 시 거부. Storige 계약 변경 없음. S6~S9 반영(S6 coverLayout 등)은 다음 트랙 착수 시 통지. 오너 e2e 보류 유지.

- bookmoa 세션 교대 예고(09-28, `local_154c5e2a` 발신): 다음 bookmoa 세션이 착수 직후 새 이름을 통지 → §2 갱신. 그 전까지 현 세션이 수신. bookmoa 운영 `19ce2a5`(R-198, 10:14Z). 반영 완료: S6 coverLayout(R-197, 비legacy 표지 잡만)·padToPageStep ACK. 후보: R-200(S8 pageStep 을 bookmoa 상품편집기에 표시·불일치 경고, 착수 시 통지). 84개 상품 전부 legacy·오너 e2e 보류 유지.

## 5. 오너 결정 대기 (착수 약속 없음)

- **결속 API 설계** `FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md` §16 — 핵심 O1~O5(v1 표면·사이트별 (a)안·백필 재실측·편집기 산출물 스탬프·취소 후 90일)
- **D6 게이트**: 선행 ①~⑤(편집기 산출물 스탬프, 세션완료 VALIDATE `siteId` 누락 `edit-sessions.service.ts` createValidationJobs, 백필 재실측, 거부 코드 404 금지, 100p·MD2Books 조율)
- 파트너 파기 계약(합성 산출물·편집 세션 external), 고아 정리 실가동(`FILE_ORPHAN_DRY_RUN`), 고아 판정 (a)안(**현 형태 기각 권고**)
- **09-28 누락분 복원(09-29 CTO 점검 — 09-11·09-12 에서 열린 채 닫은 근거 없음)**
  - 동화책 caseBind(양장 싸바리 설정) · cover VALIDATE 경고 처리 정책(`SPINE_PARAMS_UNRESOLVED`) · G-6 백필
  - **branch protection — master 무보호(09-29 `gh api` 재확인 404 "Branch not protected")** · 폰트 시딩(0건)
  - 파트너 회신문: 8/24 통지 4종 미발송(printy 대상 아님, 09-12 §2-3ⓐ) · 동화책 왕복 실기 1회(재진입 유지 + `grow:*` 캡처 + bookmoa 장바구니 #1 삭제, 09-12 §2-4)
  - 인쇄 정규화 ON(`PRINT_NORMALIZE`, 운영 false — 골든 육안 대조 후) · 재오픈 폴백을 `editor.error` 로 바꿀지 · `207c458f` pageStep=4(bookmoa 요청 시)
- **CTO 점검 메모(09-29)**
  - 운영 worker 실측: `WORKER_LIGHTWEIGHT_VALIDATION`·`WORKER_LIGHTWEIGHT_SYNTHESIS`·`WORKER_CROP_MARK_VALIDATION`·`CUTOUT_ENABLED` = true(.env), `PRINT_NORMALIZE` = false. compose 기본값은 전부 false → .env 누락 재배포 시 조용히 OFF 되는 위험.
  - S7 정정: worker `handleSpreadSynthesis` 의 스냅샷 하드 검증은 `createSpreadSynthesisJob`(컨트롤러 호출 0) 경로 전용 → 파트너 합성(compose-mixed·synthesize/external)은 막지 않는다. 실영향은 SOFT `SPINE_MISSING` 뿐.
  - 문서 스테일: `OWNER_DECISIONS_2026-07-07` 의 D-11(이미 `ee88078` 구현)·D-4(07-14 채택, 구현만 남음) 서술 · `_RESUME_EDITOR_TRACKS.md`(05-02) 는 정본 아님.
  - 로드맵 미착수 주요: 임베드 D6 getState 페이지 필드·D-4a/b/c, R3b 지종별 TAC, I-4 Bull attempts, 게스트 complete 소유권(보안 항목), 에셋 A4/A5/A8·시드, R6 CutContour, R10, admin stage1b.
- 후속 후보(코드)
  - ~~편집기 `SidePanel` pageStep 우회~~ → **해소 확인(09-28)**: S8 리뷰 수정 `2402462` 가 이미 단위 추가/삭제(인접 묶음·스프레드 0번 제외·min/max 가드)를 적용했다. 09-12 문서 §8-20 의 "SidePanel 1장 단위" 한계는 `43104b2` 시점 기록이라 스테일. 회귀 테스트 `SidePanel.pageStep.test.tsx`(7건, 1장 단위로 되돌리면 5건 실패) 추가. `PagePanel.tsx` 는 1장 단위지만 미사용 컴포넌트.
  - **첨부 PDF(underlay) 쪽수 pageStep 배수 채움** — 오너 결정 A안(서버/worker 가 빈 페이지를 붙이고 원본 보존). **배포 완료(오너 승인)**: DB ALTER 10:35:24Z(49행 전부 false, 백업 `~/backup-template_sets-pre-padstep-20260928.sql`) → push `aa93216` 10:35:32Z(편집기·admin Ready) → api 재생성+nginx 10:37:33Z(롤백 `storige-api:rollback-pre-padstep`). 검증: health ok · 새 라우트 400(검증) 응답 · dist 반영 · level50 0 · 공개 조회 `padToPageStep:false`. 양사 통지·ACK 완료(bookmoa·printy 모두 이벤트 직접 구독 없음, 세션 값 그대로 보관 → 코드 변경 불요, 켤 상품 없음). 문서: 가이드 §3.3·API 표·pageStep 단락, CONTRACT_FREEZE(+contract-freeze.spec 등재), 템플릿등록 매뉴얼(md·html, pageStep 행도 신규), PRODUCT_TEMPLATE_REGISTRATION_MANUAL, 시각화 `docs/ATTACH_PDF_PAGE_PAD_2026-09-28.html`.
    - 설계 변경 근거(조사): 파트너는 `editor.contentPdfAttached` 의 `contentPdfFileId` 를 보관해 compose-mixed 에 직접 넘긴다(가이드 §3.3) → 완료 시 relink 로는 놓친다. 그래서 **첨부 시점**에 채움본을 만들어 세션·이벤트·합성이 처음부터 같은 파일을 보게 했다. worker 는 기존 fix-pagecount(`padToMultiple`, 첫 페이지 크기 백지) 재사용 → **worker 무수정·무배포**.
    - 구성: `template_sets.pad_to_page_step BOOLEAN DEFAULT FALSE`(migrations/20260928_add_template_set_pad_to_page_step.sql) · 엔티티/DTO/types/admin 스위치 · `POST /worker-jobs/fix-pagecount/attach`(@Public, 배수는 templateSet 권위 산출, 미설정 400 PAGE_PAD_NOT_ENABLED) · 편집기 첨부 모달이 도련 변환 뒤 채움 → 실패 시 원본 첨부 없이 중단 · 결과 마커 `contentPdfValidationResult.pagePadded`.
    - 검증: api 83 스위트/1174, editor 74 파일/883, tsc(api·editor·admin) 0. 게이트 무력화 시 흐름 테스트 2건 실패 확인.
    - 한계: 설정 전에 첨부된 기존 세션은 채우지 않는다. 채움 페이지 크기 = PDF 첫 페이지 크기.
    - 배포 순서: 운영 DB ALTER → master push(편집기·admin) → 즉시 api 재생성+nginx 재시작. push~api 사이 수 분간 admin 템플릿셋 저장은 400 가능(forbidNonWhitelisted).
  - ~~펼침면 내지 세트 min/max 가 0 으로 집계되는 결함~~ → **교정·배포 완료(오너 승인)**: push `6534354` 11:01:31Z → 편집기 Vercel Ready 11:02:21Z. 양사 통지 발신. **printy ACK**: 조치 불요 — pageCount 를 보정 없이 재견적·`totalPages` 에 쓰고, 재편집 완료 pageCount ≠ 주문 쪽수면 합성을 막는 게이트가 있어 종전 절반값(8)이면 16p 주문 합성이 막혔을 것 → 이번 정정이 207c458f(210x210, 16~48p)에 이롭다. **bookmoa ACK**(새 창구 `local_75d4aefc`): 조치 불요 — StorigeEditorHost 가 pageCount 를 "실측 물리 페이지 수(펼침면 ×2)"로 받아 그대로 재견적·주문 스펙 확인 모달·storige.totalPages 에 사용(환산 코드 없음). 옛 창구(`local_154c5e2a`)도 ACK — bookmoa 는 7세트 중 `207c458f` 만 상품 「동화책 하드커버 210x210」(내지 16~48쪽·**4쪽 단위**)에 사용, 기존 레코드는 주문 1·장바구니 1(세션 없음)뿐. 범위 질의에 사실 회신: range [16,24,32,40,48]→16~48 일치, **page_step NULL 이라 4쪽 단위 미강제** — pageStep=4 설정은 bookmoa 요청 시 오너 결정(양 창구 발신).
    - 원인: 펼침면 내지는 `TemplateType.SPREAD` 인데 스토어 최소/최대 판정이 `PAGE` 만 셌다 → 내지 0p → 최대 무제한 추가·최소 미만 삭제 가능. 기존 테스트는 PAGE 유형으로 만들어 놓쳤다.
    - 오너 결정: 펼침면 캔버스 1장 = 2쪽, **표지+펼침면 세트도 2쪽**. → 스토어 최소/최대·완료/가격 `pageCount`(`computeLivePageCount` innerPagesPerCanvas)·S8 가드/단위(`livePhysicalPageCount`·`pageStepMetric` pagesPerCanvas)를 책등 산식(`innerPrintPageCount`)과 같은 기준으로 통일. 내지 수는 스프레드 세션에서 위치(표지 0번 제외)로 센다.
    - 운영 실측(10:54Z, 읽기 전용): 펼침면 내지 세트 10개(공용·활성; [검증] 3 + 동화책 하드커버+내지펼침면 7, 모두 pageStep NULL), 누적 세션 17 · **완료 0**. 최근 30일 2건 모두 `207c458f`(printy 사용 세트, 호스트 order pageCount 16 = 표지+펼침면 8장 → 2쪽 기준과 일치). 세트-템플릿 연결은 `template_sets.templates` JSON(레거시 `template_set_items` 5행 아님, 조인 시 collation 명시 필요).
    - 파트너 영향: 표지+펼침면 세트의 `editor.complete`/`pricingChange` pageCount 가 N → 2N(가이드 "펼침면 ×2" 계약으로 정정). 완료 0건이라 기존 주문 영향 없음.
    - 검증: editor 74 파일/889, tsc 0, 옛 산식 되돌리면 3건 실패.
  - S7: 스프링 스냅샷의 paperType 선택값화
  - S6: 뒷면 크기 검사
  - 양장 편집기 표지의 싸바리 기하 연결
  - ~~canvas-core 책등 0 에서 spine 영역 객체 재배치 TypeError~~ → 09-28 교정·배포(오너 승인 push): spine 영역 소멸 시 spine 객체를 자유 객체로 강등·scene 위치 보존. 편집기 `spineCalculator.ts:599` 0mm 차단 가드는 **오너 결정으로 유지**(제품 정책 — 책등 텍스트가 접지선에 남음), 주석만 정정. canvas-core 기준 55/630
  - 재오픈 조회 실패 시 조용한 폴백
  - `restore()` 의 expires_at 미해제(O18)
  - `with-templates` 배치 조회(S11)
- 제품 결정: 스프링 표지를 펼침 1장으로 받는지·가로형 제본 변, 표지 기본 디자인 필요 여부

## 6. 상시 함정 (요약 — 전문은 09-12 문서 §0)

- **파트너와의 약속**
  - "0건·없음" 결론에는 **집계 시각(UTC)** 을 붙인다. 프로덕션 DB `created_at` 은 UTC 다.
  - 오탐 차단은 곧 파트너 `session.failed` 웹훅이다. 검증을 강화할 때는 **운영 실데이터로 기대식을 먼저 대조**한다.
- **로그 판독**
  - pino 로그는 요청 헤더를 기록하지 않는다. 인증 유무를 로그로 판별하지 않는다.
  - api 로그를 정규식으로 자를 때는 대조군(이미 아는 요청)을 함께 센다.
- **셸·배포 도구**
  - nginx.conf 는 파일 bind-mount 다. 설정을 바꾸면 `up -d --force-recreate nginx` 를 쓰고, `nginx -T` 로 로드된 설정을 확인한다.
  - zsh: `GID`·`UID` 는 변수명으로 쓰지 않는다. `echo ===` 도 금지다(`==` 확장). `PIPESTATUS` 대신 `pipestatus`.
  - 사용자용 bash 블록에 `<host>` 같은 자리표시자를 넣지 않는다(Run 버튼이 그대로 실행한다).
  - 연속 push 시 CI 가 앞 run 을 취소한다(concurrency) → **최신 커밋의 run** 으로 판정한다.
  - `gh run rerun` 직후 `watch` 결과는 이전 시도일 수 있다.
- **메타데이터·스키마**
  - 세션 `metadata` 업데이트는 **얕은 병합**이다. `orderOptions` 같은 중첩 객체를 부분 전송하면 통째로 덮인다.
  - prod 는 `synchronize=false` 다. 스키마 변경은 SQL 을 먼저 수동 적용한 뒤 API 를 배포한다(`apps/api/migrations/`).

## 7. 세션 종료 규칙

- 작업마다 이 문서(또는 새 날짜 RESUME)를 갱신하고, gitleaks 를 통과시킨 뒤 커밋·푸시한다.
- 종료 전 완료·미완료·다음 행동을 남긴다.
- 세션 히스토리(`~/.claude/projects` 등)는 절대 삭제·이동하지 않는다.
