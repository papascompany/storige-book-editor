# STORIGE 통합 플랫폼 확장 계획 — CTO 보고서

> **세션 성격**: 코드 변경 0 · 읽기 전용 감사·설계 세션 (서브에이전트 오케스트레이션 10에이전트)
> **날짜**: 2026-07-03 · **판정**: **GO-WITH-RISKS** (P0 3건 전부 "계획 수정으로 해소 가능", 아키텍처 결함 아님)
> **하네스**: `AGENT-ORCHESTRATION-HARNESS.md` 규약 (Cartographer 5팀 정찰 → Architect 설계 → 적대검증 3렌즈 → Final Reviewer)
> **직전 정본**: `.cursor/plans/RESUME_PROMPT_2026-07-02.md` (모듈화 트랙 A + 3영역 감사)
> **본 문서 = 이 계획의 정본.** 착수 전 이 문서의 "필수 수정 반영본" 기준으로만 진행. 원안(Architect 초안)은 적대검증에서 사실 전제 오류로 FAIL 2건을 받았고, 아래는 그 수정을 접은 재판(再版)이다.

---

## ADR — 오너 결정 반영 (2026-07-03, yohan)

착수 승인과 함께 §9 오너 결정 중 3건 확정. 나머지 7건은 해당 Phase 도달 시 결정(§9 유지).

- **ADR-1 (Track A)**: **골든(픽셀 diff 0) 검증 게이트 실행 후 처리.** 순수 지연로딩이므로 PDF 출력 불변이 기대값. 검증 통과 시 push, 실패 시 revert. ⚠️ master push = 파트너 프로덕션 배포 행위이므로 검증 증거 확보 전 push 금지, push는 오너 최종 go에서만.
- **ADR-2 (PrintCard CMYK)**: **storige worker 오프로드 채택.** 자체 GS 워커 신설 안 함. → Phase 1에서 storige worker의 CMYK(PDF/X-1a)·N-up duplex 실지원 실사가 최우선(갭이면 worker 신규 기능 견적).
- **ADR-3 (계약 표면)**: **기존 X-API-Key external 표면으로 통일. papas-pdf-platform 신규 인증(Bearer+X-Tenant) 미채택.** capability 개념만 레지스트리 메타데이터로 차용(§2.1). 이중 표면 금지(§7-1) 확정.

**진행 지시**: Phase 0(안전판) 착수 — 오케스트레이션. Phase 0의 코드/프로덕션 접촉 항목(thumbnail 수정, findExpired 가드, Sharesnap DB 언블록, Track A push)은 실행 전 Review Gate(구체 diff·런북 제시→오너 승인).

---

## Phase 0 실행 상태 (2026-07-03 오케스트레이션 — 정찰5+종합+적대검증2)

**완료(안전 산출물 — 코드/프로덕션 미접촉)**:
- `docs/CONTRACT_FREEZE.md` v1.1 작성 — 적대검증(FAIL P0×3)이 잡은 누락 보강본. 업로드 표면 6종+크기 경계(100MB multer/90MB 라우팅/2GB/nginx 100M)·frame-ancestors(死코드 오판 정정→FROZEN)·NOT_S3/503·content-type enum·응답 id 키·100p 재분류 포함.
- [미검증] 8건 재검증 완료: **사실 5 / 死코드 1(frameAncestors DB 필드) / 부분 1(파일상한 코드기본 100MB) / ADR-2 결정적 갭 1**.

**[미검증] 8건 재검증 결과표**:
| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | admin site 격리/컬럼 | **사실** | edit_sessions·worker_jobs site_id 컬럼 실존(entity) |
| 2 | frameAncestors DB 死코드 | **사실** | getAllFrameAncestors 정의(sites.service.ts:218) 있으나 호출처 0. 실효 CSP는 editor/vercel.json |
| 3 | softDelete 2단계+48h | **기구현·기머지** | file-retention.service.ts sweepExpired/purgeSoftDeleted 2 cron |
| 4 | result shape | **`{isValid,errors,warnings,metadata}`** (issues 아님) | validation-result.dto.ts:198 |
| 5 | 파일상한 | 코드 기본 **100MB**(1GB/2GB 아님) | validation.config.ts:15, env WORKER_MAX_FILE_SIZE |
| 6 | 재시도 서명 생략 | **아님(포함)** | webhook.service.ts:134, X-Storige-Retry+서명 |
| 7 | DELETE/expiry external | **실구현·활성** | files.controller.ts:607/629 |
| 8 | worker CMYK/N-up | **감지 O, 변환·임포지션 X** | ghostscript.ts CMYK 감지만. ADR-2 스코프 영향 ↓ |

**🔴 ADR-2 스코프 경보**: PrintCard이 요구하는 **CMYK 변환(PDF/X-1a 생성)·N-up duplex 임포지션은 worker 미지원**(감지만 존재). "storige worker 오프로드" = 기존 기능 재사용이 아니라 **worker 신규 파이프라인 개발**. Phase 1 실사 확정 → 오너 스코프 재산정 필요.

**🔴 Track A 경보**: 골든/픽셀 diff PDF 회귀 테스트 인프라 **부재**(grep 0건). 커밋 본문은 출력 불변 명시(순수 dynamic import, 호출처 이미 async). 골든 검증하려면 인프라 신설 or 수동 qpdf 구조+시각 비교 필요 → ADR-1 검증 방법 오너 결정.

**Phase 0 구현 완료 (branch `feat/platform-phase0-safety`, origin/master 기준 = Track A 미포함, 미푸시·미배포)**:
| 항목 | 오너결정 | 구현 | 검증 | 배포 게이트(잔여) |
|---|---|---|---|---|
| thumbnail 무인증 제거 | 지금 구현(별도 브랜치) | ✅ `files.controller.ts` getThumbnail(ApiKeyGuard+@CurrentSite+@Throttle), `files.service.ts` generateThumbnail/getThumbnailBuffer(assertSiteAccess) | ✅ files 모듈 첫 spec 7케이스 + api 213 tests green + build/lint clean | VPS `docker compose up -d --build api` + nginx restart |
| findExpired 가드 | 주문 상태 조인(미완결만 제외) | ✅ `files.service.ts:518` NOT EXISTS(file_edit_sessions status<>'complete') + site 스코프 | ✅ spec(NOT EXISTS 가드 존재·만료조건 유지) | ⚠️ **배포 전 retention.dryRun=ON before/after 표본검증 필수** → VPS 배포 |
| 골든 하네스 | 인프라 신설 후 자동화 | ✅ `scripts/pdf-golden/`(compare.mjs+test+README, `golden:compare`/`golden:test`) | ✅ self-test 3/3(샘플PDF identical PASS/different FAIL/pixel-skip) | 캡처(편집기→PDF) 자동화는 Phase 1 후속 |
| Sharesnap DB 언블록 | (오너 실행) | 📋 SQL 런북 제공(가역, 값 교체) | — | 오너 실값·백업·단일 site_id 후 실행 |
| Track A push | 골든 검증 후 처리 | — | 하네스 준비됨(캡처는 수동/후속) | 골든 PASS 확인 후 오너 push |

**커밋(feat/platform-phase0-safety, 미푸시)**: `b5fe349`(docs) · `92540a6`(fix: thumbnail+findExpired) · `6738f2b`(feat: 골든 하네스).

---

## 0. 한 줄 결론

**"백지 확장이 아니라, 이미 사실상의 멀티테넌트 인쇄 플랫폼인 storige를 '안전판(계약 동결+회귀 그물) → 계약 정본화+SDK → 보안 opt-in → 통합 admin → 신규 온보딩' 순서로 완성하는 작업이다. 방향은 옳고, 기존 파트너 4종 무중단도 additive/opt-in/동결로 지킬 수 있다. 단, 착수 전에 계획의 사실 전제 오류(웹훅 서명식·Track A 머지 상태·thumbnail 유출) 3건을 반드시 정정해야 하며, 정정 없이 현행 계획대로 Phase 0을 시작하면 잘못된 계약을 정본으로 동결하고 미검증 에디터를 파트너 프로덕션에 배포한다."**

---

## 1. 4개 기둥 실행 가능성 (적대검증 반영 정정본)

| 기둥 | 판정 | 근거 · 선결 조건 |
|---|---|---|
| ① 프로젝트별 admin 통합 (테넌트 콘솔) | **가능** | admin은 파트너 하위호환 표면이 **없어** 확장 자유도 최상. sites 테이블·키 회전 API·SiteList 화면 이미 존재(`ADMIN_PLATFORMIZATION_PLAN` Phase A·B 구현 완료). "신규 발명"이 아니라 "멀티테넌트 뷰 완성". |
| ② 연동설정 관리 (파트너 온보딩) | **조건부 가능** | Site CRUD·키 회전은 있으나 frame-ancestors는 `vercel.json` 정적(DB 필드는 死코드), 웹훅 allowlist·템플릿셋 등록은 SSH/DB 수작업. 목표를 "완전 셀프서비스"가 아닌 **"오너 1인이 SSH 없이 admin에서 끝내는 수준"**으로 잡으면 가능. |
| ③ 편집/변환 데이터 관리 | **조건부 가능** | file_edit_sessions→worker_jobs→files 체인·siteId 스코프 존재. **선결: (a) `findExpired` order_seqno 가드 1건**(주문 파일 삭제 방지) **(b) 에디터 사진/에셋 files 편입**(현재 정적 저장→추적 불가) **(c) ERD 정본 재작성**(2025-12-21판 stale, sites 미반영). ⚠️ 원안이 P0로 잡은 "hardDelete→softDelete 전환"은 **이미 기구현·기머지**(file-retention.service.ts, 48h 복구창) — 잔여는 order 가드 1건뿐. |
| ④ 최종 작업파일 다운로드 통합 | **가능 (③ 선행 조건부)** | 파이프라인 전 구간 운영 중(presigned→files→worker→outputFileId→`GET /files/:id/download/external`). 파트너 4종이 이미 소비. admin 다운로드 허브를 그 위에 얹는 작업. **동결: `/download/external`의 무소유검증 특성**(bookmoa admin·Sharesnap 회수가 의존 — 소유자 검증 추가 시 2종 동시 파손). |

---

## 2. 목표 아키텍처 (허브-스포크)

```
                     ┌──────────── HUB: storige ────────────┐
                     │ apps/api    계약 표면(/external·/embed·│
                     │             shop-session·webhook 발신) │
                     │ apps/worker PDF 검증15종·변환·합성·렌더│
                     │ apps/admin  통합 콘솔(4기둥)           │
                     │ apps/editor /embed iframe + IIFE       │
                     │ packages/   canvas-core(플러그인28)·   │
                     │             types·@storige/sdk(신설)   │
                     └────┬──────────────┬──────────────┬─────┘
          임베드형(유형2) │  워커형(유형1)│  모듈 직접사용(유형0·카탈로그만)
       ┌──────────────────┤              │              │
       │ bookmoa-mobile 동결│ 100p_books 동결            │ (canvas-core npm —
       │ Sharesnap      동결│ MD2Books   동결            │  현 수요 미확인)
       │ [신규] ShelfSync   │ [신규] PrintCard(1호)      │
       │                    │ [신규] storywork·frameshop │
```

- **원칙**: 파트너의 주문·결제·회원 도메인은 각자 유지. 허브가 맡는 건 **편집(임베드)·PDF 파이프라인(워커)·연동설정·최종파일** 딱 4기둥.
- **PrintCard의 `WORKER_API_CONTRACT.md`**(papas-pdf-platform, Bearer+X-Tenant 신규 계약 v1.0-draft)는 **방향성 원형으로만 흡수**. 신규 인증 표면을 지금 만들지 않고 기존 X-API-Key external 표면 하나로 통일(§7 참조). capability 개념(validate/convert/impose)은 레지스트리 메타데이터로만 차용.

### 2.1 파트너 레지스트리 (sites 테이블 additive 확장 — 기존 파트너 무영향)
| 영역 | 현행 | 확장(additive) |
|---|---|---|
| 인증 | editorAuthCode/workerAuthCode(평문), status | `webhookSecret`(사이트별 HMAC), `webhookVersion`(1\|2), 키 만료/폐기·발급이력(장기) |
| 유형 | (암묵) | `integrationType`(worker\|embed\|hybrid), `capabilities` JSON |
| 설정 | allowedOrigins, retentionDays, 워커옵션 6종 | webhook allowlist admin 편집, 연결 템플릿셋, contractProfile(동결 스냅샷 참조) |

### 2.2 @storige/sdk — **단일 패키지 + subpath exports** (원안의 3패키지 분할 → 감량)
`@storige/sdk` 하나 + `/client`·`/embed`·`/webhook` subpath. 버저닝 단위 1개로 1인 운영 부담 최소화.
- `/client`(server-only): base URL 정규화, 2키 인증, 티어 업로드(multipart ≤100MB ↔ presigned 3단계, `STORIGE_NOT_S3` 폴백), never-throw 폴링, download/delete/expiry, `StorigeError`, graceful-disable(Sharesnap 503 패턴 표준화), 100p의 SSRF allowlist·고아 abort 옵션 승격.
- `/embed`(browser): /embed URL 빌더(파라미터 12종), postMessage 엔벨로프 v1, parentOrigin 강제, **레거시 dual-emit 미포함**(신규에 레거시 혼입 금지).
- `/webhook`: MD2Books의 trust-but-verify 원형 + v2 HMAC 검증 + replay 방어(bookmoa 차용).
- **기존 4종 SDK 강제 이관 금지** — 신규 파트너부터. 배포방식(npm publish 여부·버전정책·시크릿 스캔)은 Phase 1 산출물.
- **선결**: 검증 result shape 정본 확정(100p=`result.issues`, MD2=`result.errors` 기대 불일치 — worker 실응답 확인). 초판 발행은 PrintCard capability 실사 통과 후.

### 2.3 웹훅 표준 v2 — **WH-001 발신 형식을 기준선으로 재정의** (⚠️ 원안 정정)
- **⚠️ 원안의 치명적 오류**: 원안은 "WEBHOOK_SECRET no-op, bookmoa HMAC 준비 완료"를 전제로 제3의 v2 형식을 설계했다. **실코드는 3중 불일치**:
  - 발신부(`webhook.service.ts:186`, WH-001): `X-Storige-Signature-HMAC` 헤더에 Stripe식 `t=<unix>,v1=<hex>` (이미 프로덕션 발신)
  - bookmoa 수신부: 레거시 `x-storige-signature` 헤더에 `identifier:event:timestamp`의 **base64** digest 기대
  - 원안 v2: 또 다른 형식
  - → **원안대로 opt-in 전환 시 bookmoa 웹훅 전량 401 유실.**
- **정정된 v2 (Phase 0 정찰로 재확정)**: 수신부 3종(bookmoa·Sharesnap·MD2) **전부 레거시 `X-Storige-Signature`(base64)만 읽고, HMAC 헤더를 검증하는 수신부는 0종**. 따라서 **동결 계약 기준선 = base64 v1**(모두 통과시키는 유일 형식). WH-001 HMAC(`X-Storige-Signature-HMAC`, hex `t=,v1=`)은 발신부가 이미 additive 발신 중이나 소비자 0 → 순수 additive. v2 = 사이트별 `sites.webhookSecret` opt-in이되, **opt-in 사이트는 수신부를 발신부 hex/`t=` 형식으로 재작성 선행 필수**(bookmoa 수신부의 base64 HMAC 경로는 발신부와 형식 불일치라 "시크릿만 맞추면 된다"는 오답). `webhookVersion=1` 기본, **일괄 전환 절대 금지.** 상세: `docs/CONTRACT_FREEZE.md` §1-A·§3.
- **opt-in 게이트 필수 조건**: "발신부 실서명 ↔ 수신부 검증 함수 **페어와이즈 golden 테스트 green**". Phase 0 첫 태스크 = **서명 3종 대조표** 작성.
- **⚠️ 전역 비밀 위험**: 현재 HMAC이 전역 `process.env.WEBHOOK_SECRET` 하나 → 검증 파트너끼리 동일 비밀 공유 = **크로스테넌트 위조 가능**. 사이트별 secret 도입 전 2개 이상 파트너 HMAC 동시 활성화 금지.

### 2.4 파일 수명주기 (통합 다운로드의 신뢰 기반 — 정정본)
`FILE_LIFECYCLE_INTEGRITY_DESIGN` 정본 집행:
1. **P0(진짜 잔여)**: `findExpired`(files.service.ts:518)에 주문 파일 만료 가드. ⚠️ **적대검증 정정**: `order_seqno IS NULL` **단독 가드는 오답** — 100p/MD2의 retention-오프로드 파일은 `order_seqno`·`expires_at`을 **동시 스탬프**(uploadFileExternal이 orderSeqno 스탬프 후 setExpiry)하므로, 단순 order 배제 시 이들이 만료 sweep에서 영구 제외 → 스토리지 무한 잔존(파트너 retention 기능 무력화). **재설계**: 주문 '상태'(완료/취소) 조인해 미완결 주문만 제외하거나, `setExpiry`(files.service.ts:506) 시점에 order 진행중 가드. 배포 전 `retention.dryRun=ON` before/after sweep 건수 표본검증 필수. softDelete 2단계+48h는 **이미 기구현·기머지**. VPS 실배포·`retention.enabled`/`dryRun` 실값 확인이 Phase 0 첫 항목.
2. 에디터 사진/디자인 에셋 files 편입 → 고아 정리 cron 활성.
3. 보존/삭제 external API 계약 명문화(100p retention cron이 이미 의존 — 동작 변경 금지).
4. admin 다운로드 허브를 이 위에 얹음.

---

## 3. 단계별 로드맵 (Phase 0~6 · 적대검증 반영 감량본)

> 게이트: 각 Phase는 하네스 4게이트(Review→구현→Verification→Merge, 회귀는 contract test) 통과. 운영 함정 반영 — **스키마(마이그레이션) 먼저 배포·검증 후 코드**, editor는 Vercel 배포(atomic 롤백), worker/api는 VPS 순차 배포 + **api 재배포 시 nginx restart**.

### Phase 0 — 안전판 (감량: 전수 선구축 → 접촉 표면 한정) · 1~2주
**목표: 이후 변경이 "깨뜨렸는지"를 자동으로 아는 상태. 기능 추가 0.**
1. **CONTRACT_FREEZE.md** — 파트너 4종 의존 표면 전수 목록(§4) 정본화. **원안 누락분 추가**: `X-Storige-Signature-HMAC` 헤더, WH-005 additive 필드(sessionId/orderSeqno), editor `vercel.json` frame-ancestors 파트너 도메인 스냅샷, nginx `client_max_body_size 100M`.
2. **서명 3종 대조표** (§2.3) — v2 기준선 확정 전 필수.
3. **contract test(접촉 표면 한정)** — external HTTP 표면(기존 123 spec 인프라 재사용, ~수일)만. 웹훅 서명 테스트는 Phase 2 직전, postMessage는 임베드 접촉 Phase까지 보류. GitHub Actions에 master push 필수 체크로 등록(현재 CI는 gitleaks뿐 = honor system).
4. **[미검증] 8건 재검증** (원안 Phase 1 → **Phase 0 승격**. 렌즈 2팀 교차로 8건 중 4건이 이미 사실과 다름 확인).
5. **FILE_LIFECYCLE 잔여 P0**: `findExpired` order 가드 1건 + cron 1주기 관찰.
6. **🔴 Track A 처리 결정** (오너) — Track A 5커밋이 **로컬 master에 기머지·미푸시**(origin/master..HEAD=6커밋). editor `vercel.json` `ignoreCommand`가 canvas-core diff 감시 = **git push 시 자동 재배포**. 골든(픽셀 diff 0) 검증 전 push 금지. Phase 0~1 커밋은 **별도 브랜치**에서, master push를 배포 행위로 취급.
7. **Sharesnap 즉시 언블록** — 웹훅 allowlist/uploadCallbackUrl 등록을 Phase 3 UI에 종속시키지 말고 기존 수동 경로(DB INSERT 런북+SQL 기록)로 지금 처리.
8. **🔴 thumbnail 유출 즉시 수정** — `GET /files/:id/thumbnail`(@Public·무가드)이 임의 파일(주문 content PDF 포함)을 무인증 PNG 반환. `:id/raw`와 동일 정책(content/synthesis 404 배제 또는 ApiKeyGuard+assertSiteAccess)+@Throttle. **동결 아니라 수정 대상.**
- **무중단**: 파트너 표면 1바이트도 안 바꿈. Track A/thumbnail 외 커밋은 별도 브랜치.

### Phase 1 — 계약 정본화 + SDK · 2~3주
ERD 재작성, result shape·파일 상한(1GB vs 2GB 상충) 정본 확정, OpenAPI/JSON Schema, `@storige/sdk` 초판(단일 패키지). **PrintCard CMYK/N-up worker 실지원 실사를 첫 태스크로 승격** — 갭이면 SDK 초판 범위를 storywork 시나리오로 재산정.

### Phase 2 — 보안 표면 v2 (opt-in 병행) · 2~4주(파트너 조율 포함)
웹훅 v2(§2.3, WH-001 기준선), `sites.webhookSecret/webhookVersion` 마이그레이션 선배포 → bookmoa 1호 opt-in. `POST /worker-jobs/compose-mixed/external`(인증판) **신규 추가**, 기존 @Public 라우트 **유지**(bookmoa-mobile·Sharesnap 의존). presigned-upload-public **인증 보류**(100p가 키 없는 호출 의존 — 강제 시 >90MB 업로드 파손, rate limit/모니터링만). **WORKER_API_KEY 마스터키 분리**(내부 워커 인증) 항목 등재.

### Phase 3 — 통합 admin (이분 감량: 고빈도만 UI) · 1.5~2주
- **UI**: 사이트 dropdown 필터, 다운로드 허브(사이트→주문→파일+보존상태), 웹훅 실패 재발신.
- **런북+스크립트로 대체**(저빈도): frame-ancestors 반자동(기존 도메인 슈퍼셋 검증+시크릿 직렬화 금지 가드), 템플릿셋 등록 유효성 게이트.
- admin은 back-compat 표면 없음 → 가장 안전한 대량 작업 구간.

### Phase 4 — 신규 파트너 온보딩 · 파트너당 1~2주
**PrintCard(1호, capability 실사 통과 전제) → storywork → frameshop.** 신규 site suspend로 즉시 롤백. VPS 자원 경합 모니터링(신규 CMYK 잡이 기존 4종 SLA 침식 시 동시성 한도).

### Phase 5 — 트랙 B (Capability Registry) · **트리거 기반(4번째 편집상품 착수 시). 지금 착수 금지.**
`SITE_OVERRIDES` 매니페스트가 파트너별 편집기 기능셋의 씨앗. Phase 2~4에서 sites 스키마 필드 예약만.

### Phase 6 — 최종 통합·구 표면 정리 · **파트너 4종 전원 v2 전환 완료 후에만**
구 라우트 deprecation, dual-emit 제거. 파트너별 재활성 플래그로 단계 철거. bookmoa editor.complete의 needsAuth/guestToken 인라인은 영구 보장.

---

## 4. 동결 목록 (Phase 6 이전 변경 금지 — 계약 수준 · 적대검증 추가분 ★)
| 분류 | 동결 항목 |
|---|---|
| 인증 | X-API-Key 헤더명, editor/worker 2키, shop-session 응답 shape, graceful-disable 시맨틱 |
| 임베드 | /embed 파라미터 12종(camel/snake), postMessage 엔벨로프 v1 + 레거시 dual-emit, editor.complete payload(files 중첩+needsAuth/guestToken 인라인), ★**editor vercel.json frame-ancestors 파트너 도메인 스냅샷** |
| 업로드 | /files/upload/external(multer 100MB), presigned-upload-public **@Public 무인증**(100p 의존), multipart 3단계, `STORIGE_NOT_S3` 문자열·503, ★**nginx client_max_body_size 100M** |
| 워커 잡 | validate/synthesize/split-synthesize/fix-pagecount/external DTO(forbidNonWhitelisted 필드셋), compose-mixed @Public+DTO(outputMode separate\|content-only), GET /worker-jobs/external/:id 상태 enum. ★**동결 규약 정밀화: 기존 필드 시맨틱 변경·제거 금지 + additive 필드는 contract test 동시 갱신 조건부 허용**(Phase 4 신규 capability 수용) |
| 다운로드 | GET /files/:id/download/external **무소유검증 특성**, DELETE /files/:id/external 404=성공 |
| 웹훅 | v1 base64 서명식·payload 필드, ★**X-Storige-Signature-HMAC 헤더(WH-001, 이미 발신)**, ★**WH-005 additive 필드(sessionId/orderSeqno)**, 이벤트 7종 명칭 |
| 조회 | /edit-sessions/external?orderSeqno=, /edit-sessions/my summary, guest/migrate, spine/calculate, template-sets/:id/with-templates |
| ⚠️수정대상(동결 아님) | ★**GET /files/:id/thumbnail** — 무인증 크로스테넌트 유출, Phase 0 즉시 수정 |

---

## 5. 프로젝트별 온보딩 매트릭스
| 프로젝트 | 유형 | 필요 모듈 | 난이도 | 우선순위 | 비고 |
|---|---|---|---|---|---|
| bookmoa-mobile | 임베드(현행) | — | — | **동결** | 최다 계약 소비자(17엔드포인트). 웹훅 v2 opt-in 1호 |
| Sharesnap | 임베드(현행) | — | — | **동결** | allowlist/uploadCallbackUrl 등록이 파트너측 BLOCK — **Phase 0 즉시 수동 언블록** |
| 100p_books | 워커(현행) | — | — | **동결** | 가장 방어적(SSRF·NOT_S3·고아정리). presigned @Public·retention 의존 — 보안 강화 시 최우선 점검 |
| MD2Books | 워커(현행) | — | — | **동결** | 유일한 trust-but-verify 구현 → SDK /webhook 원형 |
| **PrintCard Studio** | 워커 | CMYK 변환·N-up duplex imposition·validate·웹훅·다운로드 | **S~M** | **1순위** | `WORKER_API_CONTRACT.md`의 **원저자**(storige worker 멀티테넌트 승격 계약 제안). ⚠️ CMYK/N-up worker 실지원 [미검증] — Phase 1 첫 실사. 임베드 트랙(StorigeEditorHost)은 dead code |
| **storywork** | 워커 | validate-print·convert-colorspace(CMYK)·apply-bleed·saddle imposition·웹훅 | **M** | 2순위 | 최다활동(329커밋). 런타임 연동 0 → 무중단 영향 없음. Inngest publish 스텝 삽입형. ADR-0007 결정론이 외부 후처리로 깨짐 — 골든 재설계 |
| **frameshop** | 워커 | 렌더 결과 검증·PDF화/CMYK·웹훅·다운로드 접합 | **M** | 3순위 | Konva 자체 편집기(임베드 불필요). print_render_jobs 유지, storige는 "렌더 이후 출고 후처리" 분업 |
| ShelfSync (Tagmanager/shelfsync-gemini-ready) | 워커(배치 카드) | worker·card-imposition | **M~L** | 조건부 | **선결: git 초기화 + 정본 지정**(2벌 이중 관리) |
| mystory | **제외** | — | — | — | ⚠️ "Storige 통합"은 storige-heritage(storige.app) 트랙 — 본 플랫폼과 **독립**. 용어 혼선 주의 |
| cardcraft-agents / memorybook | **보류** | — | — | — | 디지털 산출물(PNG/ZIP) / 4개월 휴면 — YAGNI |
| blog-migrator | **제외** | — | — | — | 접점 전무 |
| PCMS / excel 견적분석 | 지식자산 | — | — | 참고 | 코드 연동 대상 아님(외부 상용 CMS 교육자료 / 견적 도메인 입력) |

---

## 6. 통합 admin 설계 — **현 apps/admin 확장 (별도 콘솔 반대)**
근거: (a) admin은 back-compat 표면 없어 확장 안전, (b) 이미 15페이지+Site 관리 존재, (c) 1인이 콘솔 2개 유지 불가, (d) 파트너 6곳 전부 자체 admin 보유 → 통합 admin은 **대체가 아니라 크로스 계층**(연동설정+모니터링+파일).

```
admin
├─ 플랫폼 (신설)
│  ├─ 파트너(Sites 승격): 키·웹훅(secret/version/allowlist)·origins·워커옵션·capability
│  ├─ 연동 모니터링: 사이트별 세션/잡/웹훅 이력 + 실패 재발신
│  └─ 파일 허브: 사이트→주문→파일 체인, 다운로드, 보존/만료
└─ 기존 메뉴 + 전역 사이트 필터 dropdown
```
- **권한 1단계(Phase 3)**: 오너/운영자 전용(기존 JWT+role). **2단계(수요 시에만)**: 파트너 read-only 포털(PARTNER role+siteId 강제). ⚠️ **셀프서비스 쓰기 부여 금지** — 오너 승인 게이트가 1인 체제에서 더 안전. ⚠️ **포털 착수 전 NULL-siteId 비노출 정책 선결**(아래 §8 격리 결함).

---

## 7. 하지 말아야 할 것 (과대설계 경계 — 1인 운영 지속가능성)
1. papas-pdf-platform 신규 계약(Bearer+X-Tenant) 즉시 채택 금지 — 이중 표면 유지비 2배. capability 개념만 차용, 인증은 기존 X-API-Key 통일.
2. 웹훅 HMAC·compose-mixed 인증 **일괄(빅뱅) 전환 금지** — 파트너별 opt-in 버전 분기.
3. API 키 해싱 빅뱅 금지 — 전 파트너 재발급 강제. 키 회전 사이클과 묶어 순차.
4. 트랙 B 조기 착수 금지 — 4번째 상품 트리거. 스키마 필드 예약만.
5. 기존 4종 SDK 강제 이관 금지 — 동작하는 어댑터를 건드리는 것 자체가 리스크.
6. 인프라 이전(migration/ Supabase+Vercel) 동시 진행 금지 — Worker는 Vercel 불가(GS 바이너리·장기실행).
7. 파트너 admin 대체 금지 — 주문/결제/회원 도메인 흡수는 범위 밖.
8. 파트너 셀프서비스 쓰기 포털 선행 금지 — 4~7곳 규모에선 오너 수동 승인이 더 싸고 안전.
9. **/download/external 소유자 검증 추가 금지 · presigned-upload-public 인증 강제 금지** — "보안 개선"처럼 보이나 곧 무중단 위반.
10. 휴면·기획 프로젝트(memorybook·cardcraft·mystory POD)를 수요 산정에 포함 금지. 실수요: PrintCard·storywork·frameshop·(조건부)ShelfSync.
11. **문서 인용만으로 착수 금지** — ADMIN_PLATFORMIZATION_PLAN·ERD stale. 착수 전 file:line 재검증.
12. **'Storige' 용어 혼용 금지** — 본 계획=Bookmoa 인쇄 플랫폼. storige-heritage(storige.app)는 별도 트랙.
13. ★**파트너 차단 해소는 어떤 Phase 게이트에도 종속 금지**(Sharesnap 교훈).

---

## 8. 적대검증 발견 (P0 3건 · 주요 P1 — 투명 공개)

### 최종 판정: **GO-WITH-RISKS** (P0 3건 전부 "계획 수정으로 해소 가능")
| 렌즈 | 판정 | P0 |
|---|---|---|
| 무중단·하위호환 | FAIL(→수정 후 해소) | 2 |
| 보안·멀티테넌시 | FAIL(→수정 후 해소) | 1 |
| 1인운영·실행가능성 | PASS_WITH_RISKS | 0 |

### P0-1 웹훅 서명 3중 불일치 (§2.3에서 정정 완료) — **오케스트레이터 실코드 확인**
발신부 WH-001(`t=,v1=hex`) ↔ bookmoa 수신부(base64) ↔ 원안 v2 = 세 형식 전부 불일치. 원안대로 opt-in 시 bookmoa 웹훅 전량 401. → v2를 WH-001 기준선으로 재정의.

### P0-2 Track A 기머지 + 자동배포 경로 (§Phase 0-6에서 정정) — **오케스트레이터 실코드 확인**
Track A 5커밋이 **로컬 master 미푸시**(현재 브랜치=master, RESUME 문서의 `feat/pod-modularization-track-a`와 불일치). editor `vercel.json`의 `ignoreCommand`가 `packages/canvas-core` diff 감시 → **git push 시 골든 미검증 에디터가 임베드 파트너 2종 프로덕션에 자동 배포**. → Phase 0 커밋은 별도 브랜치, master push=배포 행위.

### P0-3 thumbnail 무인증 크로스테넌트 유출 (§Phase 0-8에서 즉시수정)
`GET /files/:id/thumbnail`(@Public·무가드)이 임의 파일(주문 content PDF·타 테넌트 포함)을 무인증 PNG 반환. 인접 `:id/raw`는 바로 이 이유로 PDF를 404 배제 — thumbnail은 그 경계의 구멍. → :id/raw 정책+@Throttle.

### 주요 P1
- **NULL-siteId 격리 결함**: `assertSiteAccess`가 file.siteId=NULL이면 무조건 통과. NULL 대량 생성 경로(compose-mixed·render-pages·presigned) 존재 → 유효 키 파트너가 타 테넌트 NULL 파일 열람/하드삭제 가능. "Phase 4 siteId 논리격리" 주장은 이 경로에서 거짓. → 이원 정책(기존 의존분 화이트리스트 + 신규 site 스탬프 강제).
- **WORKER_API_KEY 마스터키**: role='worker'가 전 테넌트 스코프 바이패스 = 사실상 마스터키(PUBLIC 레포+2026-06 노출 이력). → Phase 2 내부 워커 인증 분리.
- **전역 WEBHOOK_SECRET**: 다중 파트너 동일 비밀 = 크로스테넌트 위조. → 사이트별 secret.
- **stale 전제**: FILE_LIFECYCLE softDelete 2단계는 기구현·기머지(원안이 미완으로 오판). → Phase 0 P0 범위 축소.
- **검증 실체 부재**: 스테이징 없음(단일 VPS), 배포 드레이닝·카나리 전무. → 목 수신 서버·dryRun·VPS runbook 명시.
- **용량 모델 부재**: 총 11~20주를 라이브 4종 운영과 병행 → Phase별 shippable checkpoint 정의.

---

## 9. 오너 결정 필요 (OWNER-DECISION)
1. **Track A 처리**: 골든(픽셀 diff 0) 통과 후 master push vs revert 후 독립 트랙 — PDF 출력은 파트너 계약의 심장, 오너 승인 필수.
2. **PrintCard CMYK 택일**: 자체 pdf-worker GS vs storige worker 오프로드(worker CMYK/N-up 실지원 실사 결과와 함께).
3. **papas-pdf-platform 계약(Bearer+X-Tenant) 회신**: 본 계획은 "기존 X-API-Key 통일, capability만 차용" 권고 — 수용 여부.
4. 웹훅 v2 롤아웃 순서·파트너 조율 창구(bookmoa 1호 일정).
5. compose-mixed 인증판 컷오버 시점(bookmoa-mobile·Sharesnap @Public 의존).
6. API 키 위생 로드맵(평문 유지 기간, 해싱 시점, bookmoa PHP 구 키 cutover, PUBLIC 레포 git history force-push).
7. 워커 파일 상한 정본(100p 인식 2GB vs MD2 인식 1GB — VPS 실값 확인 후 파트너 공지).
8. ShelfSync 정본 지정(Tagmanager vs shelfsync-gemini-ready) + git 초기화.
9. 파트너 read-only 포털 구축 여부·시점(본 계획은 수요 확인 전 보류 권고).
10. VPS 자원 증설 여부(워커 동시성 경합 시).

---

## 10. 잔여 리스크 (모니터링 대상)
- bookmoa 수신부 서명 형식은 검증자 file:line 인용에 의존(레포 미탐색) — Phase 0 서명 3종 대조표에서 확정.
- WORKER_API_KEY 단일 마스터키 = Phase 2 분리 전까지 전 테넌트 유출·파괴 단일점.
- FILE_LIFECYCLE VPS 실배포·활성 여부 미확인 — Phase 0 실값 확인 전 위험 확정 불가.
- 스테이징 부재 → Phase 2 웹훅 E2E·Phase 4 온보딩 검증은 대체 수단 완성도에 의존.
- Phase 4 후보 3종 외부 수요 확약 없음 → SDK·admin 투자 회수 지연 가능.
- NULL-siteId 이원 정책 시 기존 의존분 식별 불완전하면 무중단·격리 충돌.

---

## 부록. 정찰 근거 (신뢰도)
- Cartographer 5팀: storigeCore=높음, embed·worker 파트너(코드 직접 열람)=높음, candidates=높음, sweep=중간.
- 파트너 4종 연동 코드 직접 확인: bookmoa-mobile(api/storige/* JS 1,243줄), Sharesnap(app/api/storige/* TS 667줄), 100p_books(lib/storige/client.ts 635줄), MD2Books(storige-adapter.server.ts 359줄).
- 오케스트레이터 직접 재확인: Track A 머지 상태(`git log origin/master..HEAD`), editor `vercel.json` ignoreCommand+frame-ancestors.
- [미검증] 8건은 Phase 0 첫 태스크로 재검증(렌즈 2팀 교차로 4건이 이미 사실과 다름 확인).
- **시크릿 값 미포함**(참조 위치만). 파일 수정 0.
