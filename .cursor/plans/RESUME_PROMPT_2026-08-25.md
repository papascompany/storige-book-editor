# RESUME PROMPT — 2026-08-25 (8/26 이어짐)

> **이 문서가 최신 정본이다.** 같은 스프린트가 8/26 까지 이어져 여기에 계속 기록한다(별도 8/26 문서 없음). 직전 스프린트는 `RESUME_PROMPT_2026-08-24.md`(P1-4 트랙 종결·테넌트 격리 전면 확장·파트너 문서), 그 이전 상세는 8/22·8/18 참조.

## 0. 현재 라이브 상태 (2026-08-26 세션 종료 기준)

- **master = origin/master = 558eb6f**(+ 이 문서 커밋), 워킹트리 클린(`.tmp-verify-combos/`·docs/SHOPIFY_*·docs/SITE_CATALOG_* untracked 는 타 세션 산출물 — 무접촉, 커밋 시 항상 명시 add)
- 배포: editor/admin=Vercel master push 자동, API/워커=VPS 수동(`CLAUDE.local.md` §6, api recreate 시 **nginx 재시작 필수**). 이번 스프린트 변경은 **editor·canvas-core·CI 전용** — API/워커 무변경
- 이번 배포 실증: Vercel `helbt4b01` Ready → 라이브 청크 문자열 대조 PASS
  (`index-DjYUrNgl.js` 에 `runBulkPageOps:async e=>{H++;try{...}finally{...}}` · `debouncedRecalcSpine():Z().then(` · `H>0){oe.cancel()`, `EmbedView-lhzHHm4n.js` 에 `runBulkPageOps(async(`). editor/ 200 · /embed 200

### ⚠️ 검증 기준선 갱신 (종전 수치는 폐기)

| 대상 | 이전 기록 | **현재 정본** |
|---|---|---|
| editor vitest | 62파일/735 PASS | **66파일/785 PASS** (누적 신규 50) |
| editor tsc / lint | 0err / no-undef 4err "베이스라인" | **0err / 0err** (no-undef 근본 제거) |
| canvas-core vitest | "기존 실패 6파일(ABI)" | **54/54 파일·623/623 PASS** — 실패 6파일은 베이스라인이 아니라 로컬 네이티브 모듈 파손이었다 |
| canvas-core lint | no-undef 11+ "베이스라인" | **0err** (28err → 0) |
| api jest | 75파일/1038 PASS | **76파일/1047 PASS**(contract-freeze +8 · supertest-ipv4-binding +1) |
| api 전체실행 플레이크 | 희생자 무작위 ~14% + partner-api-keys 타임아웃 | **전부 종결**(0d65984·2089ea7, §1 ⑩) — 둘 다 supertest 주소 패밀리 버그(4xx 변종/침묵 데몬 변종). 누적 46회 0 실패. **등재된 플레이크 0종** |
| 동결 게이트 | Files·WorkerJobs·EditSessions 3컨트롤러 | **5컨트롤러** — TemplateSets·ProductTemplateSets 등재(558eb6f) |
| CI 게이트 | canvas-core lint 부재 | **등재됨**(02178c7) — run 32801584699 success. devDeps 선언 후 clean install 재실증(69a6038, run 32926301746) |
| api lint | globals 손열거 의존 | **no-undef off**(7a71060) — 0 errors 유지, 오탐 재발 경로 차단 |

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

**신규 관찰 → 프로덕션 DB 조회로 종결(2026-08-25)**: 코드상 px 상품에서 두 규약이 어긋난다 — `photoPlacement.canvasDpi` 는 px 좌표를 **72dpi(pt)** 로 보는데, `ServicePlugin._createMultiPagePDF` 는 `pxToMm(x, settings.dpi)` 로 본다(보통 150). 어긋난 배율만큼 저해상도 경고가 과다 산출된다.

**판정: 프로덕션에 px 단위 상품 0건 = 실노출 없음. 정합화 불요.** 근거(전수):

| 경로 | 결과 |
|---|---|
| `products.template.editorPreset.settings.unit` — 편집기가 `unit` 을 읽는 **유일한 DB 소스**(`useSettingsStore:533`) | 상품 5건 전부 `template` 자체가 NULL → unit 0건 |
| `format_presets`(7) | **스키마가 mm 전용**(`trim_width_mm`/`trim_height_mm`) — px 가 구조적으로 불가 |
| `sites.default_unit`(10) | 전부 `mm`. 타입 도메인도 `'mm'\|'inch'` 라 px 는 값 자체가 없음 |
| `templates`(71)·`template_sets`(43) | unit 경로 없음 + 원문 `unit…px` 0건 |
| `file_edit_sessions`(106)·`editor_designs`(1) | `canvas_data`/`metadata` 0건 |

⚠️ **조회 함정**: `canvas_data` 에는 `mm` 도 0건이라 그 컬럼 스캔만으로는 판단할 수 없다 — `unitOptions` 는 런타임 캔버스 속성이라 **직렬화되지 않는다**. 판정 근거는 canvas_data 가 아니라 위 설정 소스 테이블들이다. (`file_edit_sessions` 에서 `unit` 이 걸린 1건은 base64 문자열의 우연한 일치 `…ahLunitpJp…` — 필드가 아니다.)

코드 측 교차 확인: 라이브 연동 경로 `/embed` 의 공개 타입이 `size: { width, height, unit: 'mm' }` **리터럴 고정**이고, templateSet 흐름(`useEditorContents:1145·1624`)과 USE_CASE_CONFIGS 4종 기본값도 전부 `'mm'`. px 캔버스는 레거시 `/` 라우트에서 `products.template.editorPreset` 이 채워진 경우에만 발생하는데 그 데이터가 없다.

**향후 조건부 재개**: px 단위 상품을 도입하면 **사진틀(frame) 기능을 열기 전에** 두 규약을 맞출 것. 이 조건은 `photoPlacement.test.ts` 의 px 케이스 주석에 기록돼 있다.

### ④ 부수효과 ② pxToMm 분기 — 코드 대조로 정합 확인, 코드 변경 불요

`ServicePlugin` 의 px 분기 3곳(콘텐츠 `L748` / 칼선 페이지 `L1603` / 효과 페이지 `L1785·L1798`)은 모두 `bound`=상품 `size`(캔버스 단위) 를 `pdf`(항상 mm 단위)로 환산한다. 주입 이전에는 **추가 페이지 캔버스만** `unitOptions` 가 없어 else 분기(=값을 mm 로 간주)를 탔다 → px 상품의 효과/칼선 페이지가 `size.width` px 를 그대로 mm 페이지 크기로 잡는 결함이 잠복했다. 주입으로 페이지 0 과 추가 페이지가 **동일 기준**이 됐다 = 결함 해소 방향. 라이브 노출 여부는 px 단위 상품 존재 여부에 달렸는데, **조회 결과 0건이라 이 잠복 결함은 실제로 발현된 적이 없다**(위 ④ 표).

### ⑤ 재진입 시드 성능 — 페이지당 낭비 2종 제거 (3ddce60)

`addInnerPage ≈390ms/장`(9캔버스 ≈3.5s)의 원인 중 **코드로 잡히는 두 가지**:

1. **책등 재계산이 debounce 를 우회**하고 있었다. `addPage` 가 스프레드 모드에서도 `recalculateSpineWidth()` 를 직접 호출 → 복원 증설 루프가 페이지마다 책등 API 왕복 + 표지 `resizeSpine` 발사(9장=9회). `debouncedRecalcSpine()`(300ms + AbortController) 경유로 **마지막 1회**로 접는다. 부수적으로 **경합도 닫힌다** — 직접 호출분은 abort 대상이 아니라서 늦게 도착한 중간 pageCount 응답이 최종 응답보다 나중에 `resizeSpine` 을 덮어써 **최종 책등 폭이 스테일 페이지 수로 확정될 여지**가 있었다. 비스프레드는 `debouncedRecalcSpine` 이 즉시 return 하므로 직접 호출 유지.
2. **썸네일 캡처가 O(N²)** 였다. 썸네일 debounce 는 200ms 인데 addPage 1회가 그보다 오래 걸려(≈390ms) 루프 매 반복에서 debounce 가 만료 → 그 시점까지의 **전 캔버스** 재캡처(`takeCanvasScreenshot()` 무인자 = `'all'`). N장 증설이면 `toDataURL` 이 1+2+…+N(9장=45회). `runBulkPageOps(fn)` 로 구간을 감싸 구간 내 예약을 막고 종료 시 전량 1회만 캡처. 적용처 = embed 재진입 증설 루프 · `contentPdfGuide` 증설 루프.

`runBulkPageOps` 계약: **깊이 카운터**(중첩 시 안쪽 종료가 바깥을 조기 해제하지 않음) · **try/finally 내장 래퍼만 노출**(수동 begin/end 는 예외 경로에서 썸네일 영구 정지) · `reset()` 에서 깊이 0 복원. 스펙 4건으로 고정(`useAppStore.bulkPageOps.test.ts`).

**남은 계측**: 실기 체감은 오너 재진입 1회로 확인 필요(`window.__storigeLoadProfile` 의 `restore:grow` lap). 두 낭비를 제거해도 페이지당 잔여 비용(플러그인 등록·`workspacePlugin.init()`+`setZoomAuto`·`setPage` 의 O(N) DOM 표시전환)이 남는다 — 실측 후 다음 후보 결정.

### ⑥ 후속 — CI 에 canvas-core lint 게이트 등재 (02178c7, 2026-08-26)

종전 CI 에 canvas-core lint 스텝이 **없었다**. no-undef 28err 가 "베이스라인"으로 굳어도 아무 빌드도 깨지지 않은 이유다. 오탐 근본 제거로 0err 가 된 시점에 등재했다(배치 = `api lint` 와 동일 패턴, 해당 패키지 test 직후).

**lint 범위를 `eslint src` → `eslint .` 로 확대**한 것이 핵심이다 — 해소한 28건 중 **20건이 `types/fabric.d.ts`** 에 있었는데 `src` 범위로는 그 파일이 게이트 밖에 남아 "게이트를 달았지만 정작 재발 지점은 안 보는" 상태가 된다. 확대 후에도 0err(경고 48건은 기존치·error 아님, `dist/**`·`node_modules/**`·`*.js` 는 eslint.config.js ignores 가 제외).

typecheck+test 스텝에는 **node-canvas 전제**를 주석으로 명시했다(로드 실패 시 '실패'가 아니라 수집 축소 623→551 — ⑥-b 경위).

**CI 실증**: run `32801584699` success — canvas-core 두 스텝 모두 success, 테스트 **54파일/623 전량 수집**, lint **0 errors/48 warnings**.

**⚠️ 발견(미해결, 아래 P1 6번)**: `canvas-core` 는 `eslint`·`@typescript-eslint/*` 를 devDependency 로 **하나도 선언하지 않는다**. 루트 `package.json` 도 선언하지 않으며, `eslint-plugin-react` 의 **auto-install-peer** 로 루트에 링크가 생긴 것을 쓰고 있다(팬텀 의존성). 현재는 락파일에 고정돼 CI clean install 에서도 결정적으로 동작함을 실증했지만, 루트의 eslint 플러그인 구성이 바뀌면 조용히 사라질 수 있다.

### ⑦ 8/26 병렬 트랙 4건 (69a6038 · 7a71060 · cd1225c · 542fa18 · c0f3dde)

정찰 4 → 구현 3 → 통합검증 1, 총 8에이전트. 파일 소유권을 배타 분할해 교차 침범 0건. 통합검증 **GO**.

**A. canvas-core eslint devDeps 선언 (69a6038)** — 팬텀 의존성 해소. canvas-core 도 루트도 `eslint`·`@typescript-eslint/*` 를 선언하지 않고 `eslint-plugin-react` 의 **auto-install-peer** 로 생긴 루트 링크에 얹혀 있었다. 기존 패키지와 같은 레인지로 선언해 **락파일 12줄 추가·버전 변경 0**. `--lockfile-only` 로만 갱신했다(전체 install 은 `ignoredOptionalDependencies:["canvas"]` 탓에 재빌드한 node-canvas 를 걷어낼 위험). CI run `32926301746` 이 clean `--frozen-lockfile` install 로 실증.

**B. api eslint no-undef off (7a71060)** — 끄기 전후 lint 산출물 동일(36/0/36). "tsc 가 이미 잡는다" 전제가 **린트 대상 317개 == tsconfig 프로그램 317개**로 정확히 성립함을 실증. 오탐 재발 경로도 실재 확인(globals 에서 `NodeJS` 한 줄 제거 → 즉시 오탐 1건). ⚠️ api 고유: `parserOptions.project` 덕에 lib.es2022.full(DOM 포함) 전역이 자동 주입돼 손열거가 떠받치는 범위는 @types/node·@types/jest·Express 뿐이다(project 제거 대조 실험에서 'URL' 오탐 17건 발생). lint 범위 확대는 **제외** — `eslint .` 로 넓히면 scripts/·test/ 가 tsconfig include(`src/**/*`) 밖이라 project 파싱 에러가 난다(별도 트랙).

**C. "마지막 저장: 없음" 해소 (cd1225c + c0f3dde 배선)** — `useSaveStore` 는 persist 없는 메모리 전용이라 재진입 직후 `lastSavedAt` 이 늘 null 이었다. 서버 `updatedAt` 으로 시드하는 `seedLastSavedAt` 신설. **불변식: status·isDirty·error 무접촉** — "마지막으로 저장된 시각"과 "지금 편집분이 저장됐는가"는 다른 명제다. 라벨도 정정("마지막 자동저장"→"마지막 저장", `updatedAt` 이 @UpdateDateColumn 이라 편집완료·첨부·검증캐시 PATCH 로도 갱신되므로 / "없음"→"기록 없음"). 호출부에 **`canvasData != null` 게이트 필수** — 없으면 방금 생성된 세션이 "방금 전" 거짓 표기.

**D. ⚠️ 8/25 커밋 3ddce60 의 주장 2건이 반증됐다 (542fa18 로 정정)**

적대검증이 CONFIRMED 로 반증했다. **정본의 종전 ⑤ 서술도 이에 따라 정정한다**:

| 3ddce60 의 주장 | 실제 |
|---|---|
| "debouncedRecalcSpine 경유로 마지막 1회로 접는다" | **접히지 않았다.** debounce 창 300ms < addPage 1회 ≈390ms(그 커밋이 스스로 인용한 실측치) → 타이머가 매 반복 만료. 9장이면 여전히 API 9회 |
| "부수적으로 경합도 닫힌다" | **닫히지 않았다.** AbortController 는 대기 타이머만 막고 **발사된 HTTP 에는 전달되지 않는다**(spineApi.calculate 가 signal 미수신) |

정정: 썸네일과 **동일한 구간 게이트**(`bulkPageOpDepth>0`)로 통일해 `runBulkPageOps` finally 에서 1회만 발사. 구간 진입 직전 예약도 abort 한다(살려두면 구간 한복판에서 중간 pageCount 로 발사돼 최종 요청과 in-flight 중복). `useAppStore.spineBatching.test.ts` 의 **대조군 spec 이 결함 자체를 실증**한다(390ms 간격 9회 → 9회 호출). 경합은 루프 기인분만 구조적으로 소멸했고, 구간 밖 연타는 여전히 열려 있다(아래 P1).

함께 고친 것: 빈 구간 무조건 플러시 제거(contentPdfGuide 는 부족분 0이어도 구간을 연다) · 죽은 `restoring` 분기의 abort 체인 identity 가드 · wrapper 치수 1px 허용오차.

**계측 배선(실측은 다음 실기)**: `loadProfiler` 에 활성 슬롯 + identity-safe 등록/해제 + `lap(key)`. 미등록 시 **공유 no-op 상수** 반환 → 평상시 비용 분기 1회·할당 0. addPage 에 `grow:createCanvas|plugins|storeInit|setPage|wsInit|wrapperSync:hit|skip|tail`. `restore:grow` 는 총합 대조군 유지.

**⚠️ "빨라졌다"고 말할 근거는 아직 없다.** 확정된 것은 (a) 9장 증설 책등 왕복 9→1(스펙 실증) (b) 빈 구간 toDataURL 플러시 제거 (c) 정확성 결함 2건 해소뿐이다.


### ⑧ 책등 스테일 응답 경합 마감 (1126d70, 2026-08-26)

⑦-D 가 "루프 기인분만 소멸, 구간 밖 연타는 열려 있다"고 남긴 잔여를 닫았다. 정찰 3 → 구현 1 → **3렌즈 적대검증** → 통합 게이트(8에이전트).

**2중 방어 — 둘 다 필요하다**
1. `spineApi.calculate(params, {signal})` → axios config 로 **AbortSignal 을 실제 HTTP 까지 관통**. `apiClient.post` 3번째 인자가 axios 로 그대로 넘어가 `client.ts` 는 무변경.
2. **세대 가드** — abort 는 '응답 도착 전'까지만 듣는다. 이미 resolve 돼 await 체인 중간인 요청의 효과 적용은 세대 비교만이 막는다. 효과 적용 **직전마다** 검사(스프레드는 await 경계 2개 → 가드 2개).

설계 결정: 세대 카운터는 **스토어가 아니라 spineCalculator 모듈** — 호출자 6곳 중 4곳(특히 deletePage)이 스토어 AbortController 를 우회한다. 세대는 **모든 조기 return 통과 후**에만 연다(진입부에서 올리면 스킵된 호출이 살아있는 in-flight 를 무효화 → 책등 아예 미적용). promise 직렬화는 기각(axios timeout 30s 매달림).

**취소 판별식 정정**: axios 1.x 는 `CanceledError`(name='CanceledError', code='ERR_CANCELED')를 던진다 — **'AbortError' 가 아니다**(4케이스 실측). 기존 `error.name !== 'AbortError'` 는 취소를 에러로 오분류했다. 판별식이 실제로 필요한 자리는 useAppStore 의 `.catch` 가 아니라 **spineCalculator 의 catch 2곳**이다(recalculateSpineWidth 가 모든 에러를 반환값으로 삼켜 바깥 catch 에 안 간다).

반환 계약: 스테일 선점 = `superseded`(신규 필드). `skipped`(종국적 no-op)와 분리, `error` 미설정.

**검증은 전부 뮤테이션 실증**: `isSuperseded`→`return false` 시 6스펙 즉시 실패(메시지가 결함 그대로 — "expected 4 to be 4.5") / signal 관통 3줄 제거 시 `api/spine.test.ts` 2스펙 실패(**같은 뮤테이션에서 spineRace 는 13/13 초록** — 그 파일은 `@/api/spine` 을 통째 mock 하므로 관통이 커버리지 밖이었다) / 비스프레드 취소 가드 제거 시 S7c 만 실패. 신규 파일 20회 반복 0 실패.

⚠️ **워크플로 운영 교훈**: 3렌즈를 **같은 워킹트리에서 병렬**로 돌리며 각자 뮤테이션 실험을 시켰더니, 렌즈2가 렌즈0의 소스 뮤테이션을 "플레이크 3회"로 오관측했다. 클린 트리 20회 재실행 0 실패로 확정. **뮤테이션 실험을 시키는 검증 에이전트는 직렬화하거나 worktree 격리할 것.**

⚠️ **잔여**: 가드 ② 도달 시 신 세대가 그 뒤 **실패**하면 플러그인=구값/스토어=그 이전 값으로 갈린 채 남는다(덮어줄 주체 없음). 반대로 쓰면 스테일 되덮기가 열려 더 해롭다 — 트레이드오프를 코드 주석에 명시했다. 다음 재계산이 양쪽을 맞춘다. 가드 ②는 오늘 기준 도달 경로 미확인(방어적 보험).


### ⑨ 프린티 회신 + 동결 게이트 갭 해소 (3987d2a · 558eb6f, 2026-08-26)

북모아와 같은 구조로 분리한 **프린티**(site `009c26d5…`, active, 키·origins 설정 완료, 2026-08-14 생성) 팀이 템플릿셋 테넌트 스코프 3건을 질의. **DB 실조회 + 코드/문서 대조**로 답하고, 그 과정에서 드러난 게이트 갭을 당일 해소했다.

**Q1 — `template_sets.site_id` 실값**: 지목된 4건(`f0335fda`·`a2cc2939`·`e66588b2`·`83e6ec80`) 전부 `NULL`. **더 중요한 건 테이블 전체 43행이 전부 NULL** 이라는 것 — 특정 site 귀속 템플릿셋이 **0건**이라 "프린티가 bookmoa 의 공백을 타는 중"이라는 전제 자체가 성립하지 않는다.

그리고 이 NULL 은 레거시가 아니라 **설계된 시스템공유**임이 코드 3곳으로 확정된다:
- `common/helpers/tenant-scope.helper.ts` — `applySiteScope(..., {includeNull})` 기본값 **false(안전 우선)** + 주석 "템플릿/라이브러리처럼 시스템공유를 함께 노출해야 하는 경우에만 명시적으로 true"
- `templates/template-sets.service.ts` `findAll` — `includeNull: true` + 주석 "**P2b: 템플릿셋=hybrid**"
- 같은 파일 `findOne` — `assertSiteInScope(..., { allowNull: true })`

⇒ **주문/파일/편집세션 = 격리, 템플릿셋 = 의도적 공유.** 서로 다른 정책이 각각 코드에 새겨져 있다. (`product_template_sets` 5행도 전부 NULL.)

**Q2 — `with-templates` @Public 무스코프는 계약이다**: `docs/CONTRACT_FREEZE.md` FROZEN 등재("4종 혼용") + 파트너 OpenAPI allowlist(CI 게이트). 코드도 의도 — 같은 컨트롤러의 다른 읽기 3개(`findAll`/`compatible`/`findOne`)는 **전부** `@CurrentScope` 를 받는데 이것만 안 받는다(인증 이전 편집기 부트스트랩). **닫을 계획 없음**(변경 시 CONTRACT_FREEZE §4 절차).

**Q3 — 프린티 온보딩 조치 불요**: 이미 NULL 이라 '내릴' 것이 없고 복제도 불필요(공용 1벌이 사이트별 N벌로 갈라져 악화). 장래 스코프 도입 시에도 `includeNull: true` 유지 → 공용 셋은 계속 보인다. 전용 셋이 필요해지면 `POST /template-sets/:id/copy` 가 비전역 스코프에서 복제본을 **호출자 site 로 자동 귀속**시킨다.

**갭 해소(558eb6f)**: 두 라우트가 문서·allowlist 에는 있는데 **리플렉션 동결 게이트에는 빠져 있었다** — 문서상 FROZEN 인데 자동 검증이 없어 데코레이터 이탈을 CI 가 못 잡았다.

| 등재 | 인증 | 비고 |
|---|---|---|
| `GET /template-sets/:id/with-templates` | `@Public` 무인증 | 문서에 이미 FROZEN |
| `GET /product-template-sets/by-product` | `@Public`+`ApiKeyGuard` | 문서 미등재였음 → 행 신설(사후 추인). **ApiKeyGuard 이탈 = 조용한 완전 공개**라 비대칭 위험 |

컨트롤러 prefix 2건도 동결. **뮤테이션 양방향 실증**: `@Public` 제거 → 'public' 단언 실패 / `ApiKeyGuard` 제거 → 'api-key' 단언 실패(둘 다 원복 확인). 런타임 동작 무변경. 코드 주석에 "무스코프는 결함이 아니라 계약"을 명시해 다음 작업자의 오인 수정을 막았다.

회신문 정본: `docs/partner-notices/PARTNER_ANSWER_PRINTY_TEMPLATE_SET_SCOPE_2026-08-26.md`(게이트 등재 완료로 갱신됨). **오너 액션: 프린티 팀 발송.**


### ⑩ api 전체실행 플레이크 — **원인 확정 + 근본 수정 LIVE** (0d65984, 2026-08-26)

한때 "guest-session-tenancy 플레이크"로 오분류했던 전체실행 무작위 실패(~14%)의 정체:
**supertest 요청이 우리 서버가 아니라 이 Mac 의 상주 데몬으로 배달되고 있었다.**

**메커니즘**: supertest serverAddress = `listen(0)`(IPv6 '::' 바인딩) + URL 은 하드코딩
`127.0.0.1`(IPv4). macOS 는 v4/v6 바인딩 분리 취급 → 커널이 v6 공간에서 고른 포트의
IPv4 쪽을 Orca·agy(Go 계열, 실측 9개)가 점유 중이어도 listen 성공 → 그 파일의 전 요청이
남의 서버로. 포획된 "404 page not found"(Go 표준 라이브러리 시그니처)가 스모킹 건.

**종전 관측 전부 설명됨**: 희생자 무작위=포트 추첨 · 단독 통과=새 추첨 · runInBand
재현=병렬성 무관 · CI 무발현=상주 데몬 없음+Linux dual-stack 은 EADDRINUSE ·
"도달 불가 403/404"=우리 응답이 아니었음.

**수정**(`apps/api/test/setup.ts`): serverAddress 랩 — 바인딩이 IPv6 면 URL 을 [::1] 로
재작성(패밀리 정합). ⚠️ `listen(0,'127.0.0.1')` 강제안은 기각 — host 있는 listen 은
dns.lookup 경유 비동기라 직후 address()=null → 원 구현이 listen(0) 재실행(실측).
함께 넣은 진단 계층: 상태 불일치 시 응답 body 를 에러 메시지에 표시(_assertStatus 랩).

**검증**: `supertest-ipv4-binding.spec` 이 IPv4 스쿼터+같은 포트 v6 바인딩으로 버그를
**결정적 재현**(뮤테이션: 패치 제거 시 'SQUATTER' 수신 실패, Linux 는 함정 부재로 통과).
전체 76스위트/1047 PASS · **수정 후 30회 반복 0 실패**(수정 전 ~14%).

**잔여(문서화됨)**: v6 루프백 특정 리스너와의 공존 충돌은 이론상 가능 — 이 Mac 실측
v6 루프백 리스너는 well-known 2개뿐(ephemeral 0). ~~partner-api-keys 타임아웃~~ → **동근원 변종으로 확정·종결**(2089ea7, ⑪ 참조).

### ⑪ partner-api-keys 타임아웃 종결 + new.bookmoa.com 베타 준비 (2089ea7·45e42dd·20dcca6, 2026-08-26)

**A. 마지막 플레이크 종결** — "단독 PASS·전체 병렬 26s 타임아웃"은 ⑩ 버그의 **침묵 데몬 변종**이었다. 스쿼터가 Go 데몬(즉시 4xx)이면 403/404, "accept 후 무응답" 리스너(실측 상주 2개)면 행→jest testTimeout 발현. 해싱 고비용 가설은 반증(SHA-256 단일 digest, bcrypt 0회) · CPU 기아 반증(busy-loop 10개 하 3.6s 불변) · 결정적 데모(pre-fix=HANG / post-fix=8ms) · 누적 46회 무실패. 코드 변경은 spec 헤더 기록 17줄뿐. **등재 플레이크 0종.**

**B. new.bookmoa.com 베타 전환 3건**(파트너 요청):
1. 콜백 구조 — 동의(잡별 callbackUrl 전달 구조, 조치 불필요)
2. **site `b5aef7a9` 갱신 LIVE**: `frame_ancestors`·`allowed_origins` 에 새 도메인 멱등 추가(JSON_CONTAINS 가드) + **구 도메인 3필드(domain·upload_callback_url·return_url_base) 신 도메인 전환**(오너 지시). 라이브 검증: `/api/frame-ancestors` 합집합 + `/embed` CSP 실헤더 반영 확인. ⚠️ **함정 발견**: 이 필드들은 웹훅 SSRF 허용 호스트 목록(`webhookAllowedHosts`)을 만든다 — 전환 없이는 새 프로젝트의 콜백이 막혔을 수 있다. 병행 안전: 허용 호스트가 frame_ancestors 호스트를 포함하므로 구 오리진이 allowlist 에 있는 한 구 콜백도 허용
3. **R2 CORS ✅ 완료(2026-08-27)**: 오너 로그인(계정 Yohan73@gmail.com = R2 계정 ID `58bf1bf0…` 일치 확인) 후 브라우저 협업으로 대시보드에서 `https://new.bookmoa.com` 추가(기존 항목·ETag·MaxAge 불변). **끝단 실증**: R2 preflight 204+allow-origin 반환, 미등록 오리진 403(대조군). 계정·경로 정보는 CLAUDE.local.md §5.5 신설

회신문: `docs/partner-notices/PARTNER_ANSWER_BOOKMOA_NEW_DOMAIN_2026-08-26.md` — **발송 완료, 파트너 최종 스모크 3단 전부 통과 회신 수신(2026-08-27)**: ① 대시보드 실측(CORS 등재) ② preflight 204+allow-origin 에코 ③ **실업로드 e2e**(부교재 내지 슬롯 실PDF — presign→PUT→complete 201→검증 잡 생성·폴링 200→워커 판정 정상). **new.bookmoa.com 베타 전환 트랙 완전 종결.** 잔여 = 구 프로젝트 완전 폐기 시 allowlist 구 오리진(`bookmoa-mobile.vercel.app`) 제거(파트너 요청 대기, ⑪-B-2 병행 안전 참조).


### ⑫ 테넌시 S3·S4 전역 결정 트랙 — (C) 경로 (b855796, 2026-08-28)

printy 감사 문의(S1~S4)를 코드+DB+라이브로 **사실 확정 회신**(b855796). printy 진단 거의 전부 정확 — 특히 S3 삭제는 **soft 아닌 즉시 hardDelete(48h 복구창 없음)** 로 printy 서술보다 무겁다. 상세는 회신문/§1 직전 요약 참조.

**핵심 판단: S3(presigned NULL-site)·S4(compose-mixed 공개)는 printy 고유가 아니라 bookmoa-mobile·100p·MD2 가 공유하는 전역 표면**이다. 한 파트너 문의만으로 상류를 조이면 다른 파트너(특히 100p/MD2 대용량 무인증 업로드·정리)를 깬다. 그래서 개별 배선이 아니라 결정 트랙으로 승격.

**오너 지시 = (C)**: 회신 먼저 → **bookmoa 답 정렬 대기** → 설계안 상신. 정렬 스캐폴드 = `.cursor/plans/TENANCY_S3_S4_DECISION_TRACK_2026-08-28.md`(확정 사실·대안 A~D 판정·bookmoa 정렬 4칸·승격 조건). **코드 무변경**(동결 계약+오너 결정 트랙 준수).

- **bookmoa 정렬 완료(2026-08-28, bookmoa-mobile-65 세션)**: ① 산출물 회수=**클라 직접 노출**(printy 서버중계보다 노출↑→S4 우선) ② 업로드=presigned 무인증 직결(bookmoa 가 NULL-site 주 사용자) ③ 둘 다 실질 위험·조이기 지지(자사 R-92 서명URL 전환 전례) ④ 1주 공지+병행이면 무중단, 코드 1~2일. **🔴 blocker: 기존 주문 박제 URL 즉시 사멸 금지 → grandfathering/재발급 API 필수**
- **설계안 상신 완료**: `.cursor/plans/TENANCY_S3_S4_DESIGN_2026-08-28.md` — S3 A안(complete 옵션 스탬프, 동결 저촉 없음)·이원 정책·NULL-파괴 게이트 / S4 nginx secure_link(outputs 한정, 모듈 실측 포함)+재발급 API(grandfathering). 오너 결정 게이트 D1~D6. **nginx secure_link+auth_request 모듈 실측 확인, outputs=워커 로컬디스크(R2 아님)**
- **다음 트리거 = 오너 결정 D1~D6**(설계안 §5). D1(S3 A안)·D3(발급 권한)·D4(grandfathering) 승인 즉시 1·2단계 착수 가능. **여전히 코드 무변경 — 결정 대기**


## 2. 잔여 작업 (우선순위)

**P0 — 오너 액션(코드 아님)**
1. **파트너 회신문 발송** — ⓐ `PARTNER_NOTICE_*_2026-08-24.md` 4종(테넌트 격리·EDITOR_BUSY) ⓑ `PARTNER_ANSWER_PRINTY_TEMPLATE_SET_SCOPE_2026-08-26.md`(프린티 템플릿셋 스코프 3건) ⓒ `PARTNER_ANSWER_BOOKMOA_NEW_DOMAIN_2026-08-26.md`(new.bookmoa.com 3건, 게이트 완료) ⓓ `PARTNER_ANSWER_PRINTY_UPLOAD_TENANCY_2026-08-27.md`(presigned 테넌시·산출물 회수 S1~S4 사실 확정). 각 사 보안 채널로
2. 동화책 왕복 실기(8/22 이월): **새 세션으로** 편집완료(PDF 생성)→보관함 이어서편집→16p 추가→재진입 유지 확인 + content PDF VALIDATE 426×216 워커 로그(R7) + 복원 UI 실주문 iframe 1회 눈확인
   - **이번 세션 추가**: 같은 왕복에서 `__storigeLoadProfile` 의 `restore:grow` lap 을 기록해 ⑤ 개선 폭 실측(기준 ≈390ms/장)
3. bookmoa 장바구니 #1 "그림책·동화책 하드커버(A4)" 테스트 항목 삭제(8/21 부산물)

**P1 — 코드 후속(다음 세션 착수 순서)**
4. **재진입 시드 실측**(오너 실기 1회 선행) — `window.__storigeLoadProfile.laps` 의 `grow:*` sub-lap 으로 390ms/장 배분 확보 + 같은 실기에서 Chrome DevTools Performance 녹화(Recalculate Style/Layout 총시간·Forced reflow 경고 수). **읽기 전용으로** 뜰 것(자동저장이 발화하면 절단 방지 로직과 얽힌다). `grow:wrapperSync:hit` count 가 0에 가까우면 1px 허용오차는 이득 없음으로 결론
5. **FontPlugin 동일 CSS 재기입 스킵**(A-1) — 정찰이 증명했으나 canvas-core 소유권 미배정으로 미착수. `grow:plugins` 가 지배적으로 나오면 우선 착수
6. api lint 범위 사각지대 — `apps/api/scripts/*.ts`·`storage/test/*.ts` 는 lint·typecheck 어느 쪽도 대상이 아니고, `test/**/*.ts` 11개는 eslint ignores + tsconfig 밖이라 e2e ts-jest 컴파일에만 의존. 해소하려면 `projectService: true` 전환 또는 test/scripts 전용 config 블록
7. (관찰) 시드 표기의 잔여 — 레거시 `/` 경로(EditorView+useAutoSave)는 시드 대상이 아니라 '기록 없음' 유지(임베드가 실사용 경로라 수용) · 게스트 세션은 `GET /edit-sessions/:id` 403 이라 세션 자체가 안 실려 시드 미적용(해소는 API 변경) · `updatedAt` 은 @UpdateDateColumn 이라 워커 검증캐시 PATCH 가 마지막 편집 저장보다 늦으면 표시 시각이 더 최신으로 보일 수 있다

**P2 — 기존 백로그(트랙별 정본 참조)**
0. (대기) bookmoa 구 프로젝트 폐기 시 site `b5aef7a9` allowlist 의 구 오리진 제거 — 파트너 요청이 오면 실행(⑪-B). R2 CORS 의 구 도메인 항목들은 `*.vercel.app` 와일드카드라 별도 정리 불필요
8. 업계표준 R6·R10·R3b(RESUME 08-11) / R5 다크 ON=오너게이트
9. 파일 보존 P1(고아정리·per-product)·P2(스트리밍 검증) — 고아 파일 6건 실증분 존재
10. 멀티테넌시 P3b(SITE_ADMIN @Roles·TenantGuard·테넌트 스위처, 설계 06-17)
11. 포토북 S2 삭제모달 설계결정 / 사진인화 POD MVP(설계 06-17, 오너 게이트)
12. ⓑstage1b 프론트 쿠키 전환·Bull attempts·BQ-03·ⓒ게이트B 히스토리 정화 force-push(오너)

**오너 결정 대기**: 동화책 caseBind 미설정(D-4 상이)·cover VALIDATE 경고(SPINE_PARAMS_UNRESOLVED·base14 폰트)·G-6 백필·branch protection·R2 프로비저닝·폰트 시딩(0건!)

## 3. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피 — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb` (타 세션 미커밋 보존, **`git add` 는 항상 명시 목록**·`-a`/`-A` 금지)
3. SSH 필요 시 `ssh-add -l` 확인, `deploy@` 대상만(fail2ban)
4. 함정 상기: vite.config.js shadow / 빌드게이트 5함정(배포는 state·번들 문자열·컨테이너 dist 로 실증) / fabric styles·loadJSON 치수 오염 / SPREAD=표지 아님(buildPageMeta hasCoverSlot) / isInitializedRef 창에 저장 입구 금지 / API 재배포 시 nginx 재시작 / 실기·프로덕션 키 작업은 권한무시 모드 / **canvas-core 테스트는 Node 22·24 에서만(§1 ⑥-b)**
5. CI 는 canvas-core lint 를 게이트로 잡는다(02178c7) — `pnpm --filter @storige/canvas-core lint` 는 `eslint .`(types/ 포함)이고 error 0 이 조건이다
6. **debounce 는 배칭 도구가 아니다** — 반복 1회가 debounce 창보다 길면 매 반복 만료된다. 루프 배칭은 `runBulkPageOps` 구간 게이트를 쓸 것(3ddce60 이 이 착각으로 잘못된 주장을 했고 542fa18 이 정정 — §1 ⑦-D)
7. 검증 기준선: **§0 표** — 종전 "canvas-core 실패 6파일·lint no-undef" 는 **더 이상 베이스라인이 아니다**. 실패하면 회귀이거나 로컬 canvas 파손 둘 중 하나이고, 후자는 프리플라이트가 이름을 대며 멈춘다
