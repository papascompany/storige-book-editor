# RESUME PROMPT — 2026-08-25

> **이 문서가 최신 날짜 정본이다.** 직전 스프린트는 `RESUME_PROMPT_2026-08-24.md`(P1-4 트랙 종결·테넌트 격리 전면 확장·파트너 문서), 그 이전 상세는 8/22·8/18 참조.

## 0. 현재 라이브 상태 (2026-08-25 세션 종료 기준)

- **master = origin/master = 3ddce60**, 워킹트리 클린(`.tmp-verify-combos/`·docs/SHOPIFY_*·docs/SITE_CATALOG_* untracked 는 타 세션 산출물 — 무접촉, 커밋 시 항상 명시 add)
- 배포: editor/admin=Vercel master push 자동, API/워커=VPS 수동(`CLAUDE.local.md` §6, api recreate 시 **nginx 재시작 필수**). 이번 세션 변경은 **editor 전용** — API/워커 무변경
- 이번 배포 실증: Vercel `helbt4b01` Ready → 라이브 청크 문자열 대조 PASS
  (`index-DjYUrNgl.js` 에 `runBulkPageOps:async e=>{H++;try{...}finally{...}}` · `debouncedRecalcSpine():Z().then(` · `H>0){oe.cancel()`, `EmbedView-lhzHHm4n.js` 에 `runBulkPageOps(async(`). editor/ 200 · /embed 200

### ⚠️ 검증 기준선 갱신 (종전 수치는 폐기)

| 대상 | 이전 기록 | **현재 정본** |
|---|---|---|
| editor vitest | 62파일/735 PASS | **63파일/743 PASS** (신규 8 = dpi 가드 4 + 배칭 계약 4) |
| editor tsc / lint | 0err / no-undef 4err "베이스라인" | **0err / 0err** (no-undef 근본 제거) |
| canvas-core vitest | "기존 실패 6파일(ABI)" | **54/54 파일·623/623 PASS** — 실패 6파일은 베이스라인이 아니라 로컬 네이티브 모듈 파손이었다 |
| canvas-core lint | no-undef 11+ "베이스라인" | **0err** (28err → 0) |
| api jest | 75파일/1038 PASS | 불변(이번 세션 미변경). `partner-api-keys.v1.spec` 병렬 26s 타임아웃 = 플레이크(단독 PASS) |

- 라이브 커밋 계보: `3ddce60`(perf 재진입 시드) ← `cb1a741`(dpi 회귀 가드) ← `5877780`(canvas-core 프리플라이트) ← `bf8ab1d`(lint no-undef) ← `df40954`(8/24 정본)

## 1. 이번 세션 완료 (§2 P1 ④⑤⑥ 전량)

### ⑥-a lint no-undef 근본 제거 (bf8ab1d)

canvas-core 28건 + editor 4건이 **전부 오탐**이었다. 두 eslint 설정이 lib.dom 전역을 `languageOptions.globals` 에 손으로 열거하는 구조라 열거 누락이 곧 에러가 되고, `types/fabric.d.ts` 의 `declare` 내부 타입(Transform·IEvent·ControlMouseEventHandler…)은 열거로도 통과시킬 수 없다. typescript-eslint 공식 권고대로 TS 파일에서 core `no-undef` 를 끈다(미정의 식별자는 tsc TS2304 가 이미 잡는다). 경고 건수는 불변.

### ⑥-b canvas-core "실패 6파일"의 정체 = 커버리지 72건 증발 (5877780)

**여러 스프린트 동안 "기존 베이스라인(ABI)"으로 회귀 판정에서 제외돼 온 항목이 실은 베이스라인이 아니었다.**

- fabric 5.x node 엔트리는 `canvas`(node-canvas)를 하드 요구. 모듈 로드 실패 시 ① fabric 최상위 import 스위트 5개 통째 FAIL ② 2d 컨텍스트 null → `Cannot set properties of null (setting 'textBaseline')` 8건
- 진짜 위험은 **수집 자체가 줄어드는 것**: 정상 623 tests/54 files 인데 파손 상태에선 **551 tests 만 수집**되고 "6 files failed" 로만 보였다 → 72개 테스트가 실패도 스킵도 아닌 **부재**
- 로컬 canvas 재빌드 후 **54/54·623/623 PASS** 실측. CI 는 Node 24 로 소스 빌드하므로(ci.yml 시스템 의존성 스텝) **원래부터 정상** — 이 증상은 로컬 Node 버전 전용
- `packages/canvas-core/vitest.setup.ts` 프리플라이트 신설 — 경고가 아니라 **하드 실패**(커버리지 조용한 축소보다 즉시 중단이 안전). 양방향 실증: 정상=623 PASS / ABI 불일치=원인+처방 메시지로 즉시 중단

**⚠️ 로컬 Node 함정**: `canvas@2.11.2` 는 **Node 26 의 V8 에서 컴파일되지 않는다**(`v8::Context::GetIsolate` 제거 → `make` Error 1). 이 Mac 기본 node 는 v26.5.1 이고 Homebrew 에 실제 존재하는 keg 는 `node`(26)·`node@22` 뿐이다(`/opt/homebrew/opt/node@24` 는 26 을 가리키는 **깨진 alias**). 재빌드/실행은 Node 22(또는 24 설치 후) 로:

```bash
cd "$(ls -d node_modules/.pnpm/canvas@2.11.2*)"/node_modules/canvas
PKG_CONFIG_PATH="$(brew --prefix)/lib/pkgconfig:$(brew --prefix jpeg-turbo)/lib/pkgconfig" \
  npx --yes node-gyp@11 rebuild     # 번들 node-gyp 8.4.1 은 Python 3.12+ distutils 부재로 실패
# 실행: PATH="$(dirname $(ls -d /opt/homebrew/Cellar/node@22/*/bin/node)):$PATH" npx vitest run
```

### ④ 부수효과 ① photoPlacement dpi — "경고 강화"가 아니라 **오탐 제거**였다 (cb1a741)

8/18 `unitOptions` 주입(c5c9525) 이전, addPage/addInnerPage 캔버스는 `unitOptions===undefined` 라 `canvasDpi()` 가 72(pt)로 폴백했다. mm 상품 좌표는 150dpi px 규약이므로 **내지 페이지에서만** `effectiveDpi` 가 실제의 72/150 = 0.48배로 산출 → ⓐ 멀쩡한 사진에 저해상도 경고(오탐) ⓑ 토스트 "최저 NNNdpi" 숫자가 2.08배 낮게 표기. 주입으로 둘 다 해소 = **정상화 확정, 추가 조치 불요**.

회귀 가드 4건 추가(`photoPlacement.test.ts`): mm/150 254dpi→무경고 / unitOptions 미주입은 같은 사진이 122dpi 오탐(주입 누락 즉시 검출) / px 캔버스 현행 규약 / 캔버스별 자기 dpi 사용.

**신규 관찰(오너 결정 대기)**: px 상품에서 두 규약이 어긋난다 — `photoPlacement.canvasDpi` 는 px 좌표를 **72dpi(pt)** 로 보는데, `ServicePlugin._createMultiPagePDF` 는 `pxToMm(x, settings.dpi)` 로 본다(보통 150). 어긋난 배율만큼 저해상도 경고가 과다 산출된다. **현재 사진틀(frame)은 mm 상품 전용이라 실노출 0** — 정합화 여부는 결정 사항.

### ④ 부수효과 ② pxToMm 분기 — 코드 대조로 정합 확인, 코드 변경 불요

`ServicePlugin` 의 px 분기 3곳(콘텐츠 `L748` / 칼선 페이지 `L1603` / 효과 페이지 `L1785·L1798`)은 모두 `bound`=상품 `size`(캔버스 단위) 를 `pdf`(항상 mm 단위)로 환산한다. 주입 이전에는 **추가 페이지 캔버스만** `unitOptions` 가 없어 else 분기(=값을 mm 로 간주)를 탔다 → px 상품의 효과/칼선 페이지가 `size.width` px 를 그대로 mm 페이지 크기로 잡는 결함이 잠복했다. 주입으로 페이지 0 과 추가 페이지가 **동일 기준**이 됐다 = 결함 해소 방향. 라이브 노출 여부는 px 단위 상품 존재 여부에 달렸고, 이는 프로덕션 DB 1회 조회로만 확정된다(**권한무시 모드 필요 — 아래 §2**).

### ⑤ 재진입 시드 성능 — 페이지당 낭비 2종 제거 (3ddce60)

`addInnerPage ≈390ms/장`(9캔버스 ≈3.5s)의 원인 중 **코드로 잡히는 두 가지**:

1. **책등 재계산이 debounce 를 우회**하고 있었다. `addPage` 가 스프레드 모드에서도 `recalculateSpineWidth()` 를 직접 호출 → 복원 증설 루프가 페이지마다 책등 API 왕복 + 표지 `resizeSpine` 발사(9장=9회). `debouncedRecalcSpine()`(300ms + AbortController) 경유로 **마지막 1회**로 접는다. 부수적으로 **경합도 닫힌다** — 직접 호출분은 abort 대상이 아니라서 늦게 도착한 중간 pageCount 응답이 최종 응답보다 나중에 `resizeSpine` 을 덮어써 **최종 책등 폭이 스테일 페이지 수로 확정될 여지**가 있었다. 비스프레드는 `debouncedRecalcSpine` 이 즉시 return 하므로 직접 호출 유지.
2. **썸네일 캡처가 O(N²)** 였다. 썸네일 debounce 는 200ms 인데 addPage 1회가 그보다 오래 걸려(≈390ms) 루프 매 반복에서 debounce 가 만료 → 그 시점까지의 **전 캔버스** 재캡처(`takeCanvasScreenshot()` 무인자 = `'all'`). N장 증설이면 `toDataURL` 이 1+2+…+N(9장=45회). `runBulkPageOps(fn)` 로 구간을 감싸 구간 내 예약을 막고 종료 시 전량 1회만 캡처. 적용처 = embed 재진입 증설 루프 · `contentPdfGuide` 증설 루프.

`runBulkPageOps` 계약: **깊이 카운터**(중첩 시 안쪽 종료가 바깥을 조기 해제하지 않음) · **try/finally 내장 래퍼만 노출**(수동 begin/end 는 예외 경로에서 썸네일 영구 정지) · `reset()` 에서 깊이 0 복원. 스펙 4건으로 고정(`useAppStore.bulkPageOps.test.ts`).

**남은 계측**: 실기 체감은 오너 재진입 1회로 확인 필요(`window.__storigeLoadProfile` 의 `restore:grow` lap). 두 낭비를 제거해도 페이지당 잔여 비용(플러그인 등록·`workspacePlugin.init()`+`setZoomAuto`·`setPage` 의 O(N) DOM 표시전환)이 남는다 — 실측 후 다음 후보 결정.

## 2. 잔여 작업 (우선순위)

**P0 — 오너 액션(코드 아님)**
1. **파트너 회신문 4종 발송** — `docs/partner-notices/PARTNER_NOTICE_*_2026-08-24.md` 를 각 사 보안 채널로(키 회전 때와 동일 경로)
2. 동화책 왕복 실기(8/22 이월): **새 세션으로** 편집완료(PDF 생성)→보관함 이어서편집→16p 추가→재진입 유지 확인 + content PDF VALIDATE 426×216 워커 로그(R7) + 복원 UI 실주문 iframe 1회 눈확인
   - **이번 세션 추가**: 같은 왕복에서 `__storigeLoadProfile` 의 `restore:grow` lap 을 기록해 ⑤ 개선 폭 실측(기준 ≈390ms/장)
3. bookmoa 장바구니 #1 "그림책·동화책 하드커버(A4)" 테스트 항목 삭제(8/21 부산물)

**P1 — 코드 후속(다음 세션 착수 순서)**
4. **px 단위 상품 실재 여부 1회 조회**(권한무시 모드) — `print_templates`/프리셋에 `unit='px'` 가 있는지. 있으면 ④의 두 dpi 규약 불일치가 실노출이 되므로 정합화 결정, 없으면 ④ 관찰 종결
5. 재진입 시드 잔여 비용 실측 후 2차 최적화 판단(위 ⑤ "남은 계측")
6. (관찰) 재진입 직후 "마지막 자동저장: 없음" 표기(lastSavedAt 세션 내 한정 — 기존 동작, UX 판단)
7. (제안, 미실행) CI 에 canvas-core lint 스텝 부재 — 이번에 0err 가 됐으므로 지금이 게이트 등재 적기. api eslint 설정도 같은 "globals 손열거" 구조라 동일 오탐이 재발할 수 있다(현재는 열거가 맞아 0err)

**P2 — 기존 백로그(트랙별 정본 참조)**
8. 업계표준 R6·R10·R3b(RESUME 08-11) / R5 다크 ON=오너게이트
9. 파일 보존 P1(고아정리·per-product)·P2(스트리밍 검증) — 고아 파일 6건 실증분 존재
10. 멀티테넌시 P3b(SITE_ADMIN @Roles·TenantGuard·테넌트 스위처, 설계 06-17)
11. 포토북 S2 삭제모달 설계결정 / 사진인화 POD MVP(설계 06-17, 오너 게이트)
12. ⓑstage1b 프론트 쿠키 전환·Bull attempts·BQ-03·ⓒ게이트B 히스토리 정화 force-push(오너)

**오너 결정 대기**: 동화책 caseBind 미설정(D-4 상이)·cover VALIDATE 경고(SPINE_PARAMS_UNRESOLVED·base14 폰트)·G-6 백필·branch protection·R2 프로비저닝·폰트 시딩(0건!)·px 상품 dpi 규약 정합화(§1 ④)

## 3. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피 — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb` (타 세션 미커밋 보존, **`git add` 는 항상 명시 목록**·`-a`/`-A` 금지)
3. SSH 필요 시 `ssh-add -l` 확인, `deploy@` 대상만(fail2ban)
4. 함정 상기: vite.config.js shadow / 빌드게이트 5함정(배포는 state·번들 문자열·컨테이너 dist 로 실증) / fabric styles·loadJSON 치수 오염 / SPREAD=표지 아님(buildPageMeta hasCoverSlot) / isInitializedRef 창에 저장 입구 금지 / API 재배포 시 nginx 재시작 / 실기·프로덕션 키 작업은 권한무시 모드 / **canvas-core 테스트는 Node 22·24 에서만(§1 ⑥-b)**
5. 검증 기준선: **§0 표** — 종전 "canvas-core 실패 6파일·lint no-undef" 는 **더 이상 베이스라인이 아니다**. 실패하면 회귀이거나 로컬 canvas 파손 둘 중 하나이고, 후자는 프리플라이트가 이름을 대며 멈춘다
