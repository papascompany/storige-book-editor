# RESUME PROMPT — 2026-07-13 (가로형 템플릿 편집 6이슈 수정 트랙)

> 오너가 가로형 템플릿(303×216 = A4 가로 297×210 + 사방 3mm 도련)을 편집하며 발견한 6개 문제를
> 오케스트레이션(정찰 7 → 구현 5트랙 → 전체검증 → 적대검증 3렌즈 → P1 수정)으로 전수 수정한 트랙.
> ⚠️ 이 트랙은 **별도 워크트리**에서 작업됨: `../storige-fix-20260713` (브랜치 `fix/landscape-template-ux-20260713`, base master cf28dd0).
> 메인 체크아웃(chore/source-exposure-gate + PLATFORM_INTEGRATION_GUIDE.md 미커밋 = 병행 세션 작업분)은 무접촉.

## 1. 커밋 5건 (워크트리, 로컬 — push/머지는 오너 게이트)

| 커밋 | 내용 |
|---|---|
| 8214ca6 | T1: 템플릿 모드 에셋 라이브러리 빈 패널 — useLibraryPanel/AppFrame/AppBackground `(isCustomer‖editMode)` 완화 |
| a727f16 | T4+T6: SidePanel 레이어 우선 재구성 + useCanvasContainerSizeSync 훅 3뷰 배선 + ControlBar 폭 sidebarWidth 연동 |
| b2805dd | T3 백엔드: POST /worker-jobs/fix-bleed(@Public, 서버 권위 editSize) + kind='bleed-fix' 완료훅 + WIRED_FIX_METHODS extendBleed + contract-freeze/문서 |
| 281eae1 | T3 프론트(노티 배너→fix-bleed→변환본 첨부/가이드, 취소가드·grace폴링·크기비례 타임아웃·bleedFixed 마커) + T5 pageCount 표지 제외(21→20) |
| 7f1bfce | T2: admin 12곳 defaultPageSize + T5: WorkerJobList outputFiles·EditSessionList 표지/내지 개별 다운로드 |

## 2. 근본원인 요약 (정찰 confidence 전부 high)

1. **T1 에셋 빈 패널**: role=ADMIN → `useIsCustomer()=false` → useLibraryPanel fetch 조기 return(호출 자체 없음). 2026-06-15 수정은 /embed만 구제.
2. **T2 페이지네이션**: antd Table `pagination={{pageSize:10}}` 고정 리터럴 = controlled 간주 → 매 렌더 스냅백. admin 12곳 공통(+스코프 외 2곳 잔존: Reviews/ReviewList.tsx:245, ProductTemplateSets/ProductTemplateSetList.tsx:345).
3. **T3 도련**: 워커 validatePageSize는 첫 페이지 MediaBox(mm)를 [판형 / 판형+2×bleed / workSize] 3중 비교(±1mm). 재단 사이즈 업로드는 통과+BLEED_MISSING 경고뿐, 모달이 경고 미렌더+underlay 고정이라 도련 없는 원본이 그대로 인쇄로 유입되던 구조.
4. **T4 레이어 아이콘**: 오배선 아님 — SidePanel이 '페이지 섹션 최상단' 레거시 복합 패널 + 데스크톱 제목 없음(lg:hidden).
5. **T5 21페이지**: computeLivePageCount가 표지 스프레드 캔버스(allCanvas[0])를 +1 산입. metadata.spreadContentPageCount는 원래 정확(20). 표지/내지 PDF 분리 생성·저장은 **기구현**(cover/content 분리 업로드 + compose-mixed spread책 separate 강제) — admin 다운로드 UI만 없었음.
6. **T6 밀림**: 선택 → FeatureSidebar unmount + ControlBar 280px in-flow mount → 컨테이너 폭 변화. 흡수 로직(ResizeObserver+재센터링)이 `/`에만 있고 `/template`·`/embed`에 없었음 + 300↔280 폭 불일치.

## 3. 검증 증거 (최종 상태)

- editor: vitest **29파일 406 passed** + tsc -b 0err + lint 0err/78warn(기왕치) + vite build ✓
- api: jest **318 passed** (fix-bleed 스펙 10 + contract-freeze 62 포함) + nest build ✓
- worker: jest **417 passed** + build ✓ / canvas-core: 330 passed + typecheck ✓
- admin: lint 0경고(엄격) + build ✓ / 골든 엔진 self-test 4/4 / gitleaks staged **0 leaks**
- 적대검증 3렌즈(정확성/보안/계약): P0 0건, P1 3건 전부 수정 반영 후 재검증 green
- 브라우저 QA(/template, 워크트리 dev): 아트보드 센터링·패널 개폐 재센터링·선택 시 무이동 확인.
  dev 한정 init 레이스(StrictMode+innerHTML='' → 패널 무반응)는 **master A/B로 기존 결함 확정**(회귀 아님) — 별도 칩 발행.

## 4. 오너 게이트 (미실행 잔여 — 순서대로)

1. **머지+push**: 워크트리 브랜치 → master 병합·push (⚠️ push 즉시 admin Vercel 자동배포 + CI. 병행 세션의 chore/source-exposure-gate 머지 게이트와 순서 조율)
2. **VPS 배포**: api(fix-bleed 라우트) + worker(validation.config) — `docker compose up -d --build api worker` 후 **nginx 재시작 필수**(옛 IP 캐싱 502)
3. **editor 배포**: Vercel CLI 수동 (git 웹훅 미발화 관행). 순서: api 먼저 → editor (editor가 신규 라우트 호출)
4. **하드커버 가로 templateSet 데이터 결정**: `83e6ec80` width/height=**301×214**(재단 297×210도 작업 303×216도 아님 — 이대로면 297×210 업로드가 SIZE_MISMATCH). 규약 정합 교정 시:
   `UPDATE template_sets SET width=297, height=210 WHERE id='83e6ec80-482b-4cee-a22b-ce1b08af33e0';`
   (하드커버 성책 규격 의도라면 유지 — 단 그 경우 (b) 자동 도련 룰이 이 세트에선 301×214 업로드에만 발동)
   `e66588b2`(A4 기본 가로)는 297×210/bleed3 정합 — 교정 불요. ⚠️ 병행 세션이 이 ID들을 bookmoa에 전달 중 — 조율 후 실행.
5. **bookmoa 고지 2건**: ① spread 표지+내지 세션의 editor.complete/pricingChange pageCount가 표지 제외값으로 정정(21→20, 주문 옵션과 동일 기준) ② 주문 시점 합성이 synthesize/external이면 outputFormat='separate' 지정해야 표지/내지 분리 산출(merged 기본값 주의)
6. **오너 표기 확인**: "313×216"은 기하상 303×216(=297+2×3)의 오기로 판단 — 특수 도련(8mm) 의도였는지만 확인
7. **라이브 E2E**(배포 후): 가로형 세트에서 (a) 303×216 업로드=노티 없음·꽉 찬 미리보기 (b) 297×210=노티+사방 3mm 중앙 정렬+저장 PDF 303×216 실측 (c) 오사이즈=기존 오류 흐름. + 모바일 임베드(iOS Safari) 키보드 개폐 시 줌 거동 스모크(T6 훅 신규 거동)

## 5. 후속 백로그 (P2, 배포 비차단)

- heavy @Public 3라우트(fix-bleed·render-pages·compose-mixed) 공통 @Throttle 보수화 (현행 전역 300/min per-IP 의존)
- /worker-jobs/:id/output NULL-siteId 소유권 검증 (§4.3 기존 오너결정 트랙에 fix-bleed 표면 확장 반영)
- fix-bleed에 templateSet.isActive 필터 여부 / registerBleedFixOutput 원자적 UPDATE(멱등, pagecount 동형)
- pdf-validator.service.ts:952 낡은 주석 갱신(다음 워커 수정 사이클에 편승 — 단독 배포 불요)
- admin 대용량 blob 다운로드(2GB) 스트리밍화 / AppImage·AppTemplate 탭의 템플릿 모드 데이터 소스(오너 UX 결정)
- admin 스코프 외 pageSize 2곳(ReviewList·ProductTemplateSetList) 동일 한 단어 치환
- ~~TemplateEditorView dev 초기화 레이스(기존 결함)~~ → ✅ 해소(커밋 0b2ffdd, 하단 갱신 절 참조)
- G3(bookmoa 회신) 후 WORKER_WIRED_FIXABLE_GATING=ON 시 (c) 오사이즈가 실제 거부로 전환됨(현행 OFF는 FIXABLE 마스킹 첨부) — 기존 로드맵 그대로

## 6. 다음 세션 시작법

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige-fix-20260713"  # 워크트리
git log --oneline -6   # 8214ca6..7f1bfce 5커밋 확인
```
메인 체크아웃은 병행 세션 상태(chore/source-exposure-gate) 그대로다. 머지 전 `git status -sb`로 타 세션 미커밋 무접촉 원칙 준수.

---

## [갱신 2026-07-13 저녁] 추가 커밋 6 — dev 초기화 레이스 수정 (칩 task_e264c8bd 소화)

| 커밋 | 내용 |
|---|---|
| 0b2ffdd | fix(editor,canvas-core): dev 초기화 레이스 — ①createCanvas await 경계 stale-abort(CanvasInitCancelledError, 뷰 3곳 정상 중단 처리·embed 가짜 editor.error 미발신) ②safeDisposeCanvas(removeChild NotFoundError 무해화+고아 wrapper 제거) ③createFabricCanvas 요소 직접 바인딩(id 충돌 도난 레이스 원천 제거, canvas-core 시그니처 하위호환 확장) |

- **실제 근본원인**(칩의 최초 가설 교정): reset() 순서 문제가 아니라 (a) 뷰의 `!isMounted` dispose가 cleanup의 innerHTML='' 이후 removeChild로 던짐 (b) stale 초기화가 initPlugins까지 완주하며 전역 리스너 누수 (c) `new fabric.Canvas('canvas0')`의 getElementById가 동시 초기화의 상대편 요소를 훔침.
- 검증: 신선 로드 콘솔 에러 0, init 1회 성공, store↔DOM 정합(sameEl), 패널 열림, DOM 캔버스 구성 = 프로덕션 패리티(3개 — 클래스 없는 600×300은 fabric 정상 부속물). editor vitest 411(+5 safeDispose 스펙)·canvas-core 330·typecheck·lint 0err·build ✓, gitleaks 0.
- ⚠️ 조사 중 별건 확인: 브라우저 패널이 숨겨진(visibilityState=hidden) 상태에서는 RAF가 동결되어 fabric 렌더가 안 보이고 합성 클릭도 무반응 — **코드 결함 아님**(master·프로드 동일). 에이전트 QA 시 패널을 화면에 띄운 상태로 검증할 것.
- dev 전용 수정이나 editor 번들에 포함되므로 배포 게이트는 본 트랙과 동일(§4).

---

## [갱신 2026-07-13 심야] 전량 배포 완료 + 프로덕션 E2E + 🚨 보안 사고 대응

### 배포 상태 (전부 LIVE)
- master `69f8fa5` push 완료 (463705f 머지 + 7691ab6 upload-public + 69f8fa5 보안).
- **admin**: Vercel 자동배포 Ready. **editor**: master push 웹훅 빌드 Ready + editor.papascompany.co.kr 별칭 확인, 프로덕션 청크(EditorView-DhePKVtz.js)에서 신규 코드 마커 실증. ⚠️ **editor git 웹훅이 이제 정상 발화**(과거 "미발화" 메모리 낡음 — api-only 커밋은 ignoreCommand가 올바르게 스킵함도 확인).
- **api·worker**: VPS 463705f→7691ab6 2회 배포 + nginx 재시작(옛 IP 502 함정 1회 재현→재기동 해소).
- **DB 교정**: 83e6ec80 판형 301×214→297×210 (오너 승인). 313=303 오기 확정.

### 프로덕션 E2E (b) 실증
297×210 업로드 → fix-bleed(editSize 서버 산출 303×216) → 3초 내 COMPLETED →
산출 PDF **MediaBox 303.00×216.00mm**, 테두리 콘텐츠 **사방 3.05mm**(선폭 보정=3mm) 무스케일 중앙, 1페이지 보존. (a)(c)는 에디터 게이트 단위테스트로 잠금.

### E2E가 적발한 추가 결함 → 수정 배포 (7691ab6)
`/storage/upload-public`이 files 레코드를 안 만들어 **≤50MB 첨부 경로의 validate/fix-bleed가
전부 FILE_NOT_FOUND**로 깨지는 기존 균열(트랙 B fileId 통일 유래, master도 동일).
registerExternalFile 재사용으로 등록+응답 id를 DB id로 통일. 계약 스펙 3건(api 321 green).

### 🚨 보안 사고: Redis SLAVEOF 하이재킹 (69f8fa5로 봉쇄)
- **경위**: docker compose `6379:6379` 매핑이 ufw를 우회해 무인증 Redis가 공인망 노출.
  2026-05-03 09:32 공격자(113.193.31.50)가 SLAVEOF 실행, 이후 role 전환 **185회**(봇들 각축).
  slave(read-only) 창에서는 **모든 Bull 큐 쓰기 실패** → 71일간 잡 생성 간헐 파손.
- **조치(완료)**: REPLICAOF NO ONE 복원 → compose에서 redis·**mariadb(3306 동일 노출)** 루프백
  바인딩 커밋·배포 → 컨테이너 recreate → 외부 스캔으로 차단 실증(6379/3306 timeout, 443 정상).
  공격자 SSH 공개키(redis key `x`) 삭제. 호스트 무침해 확인(deploy/root authorized_keys 106B
  4/27 이후 무변경, 크론 정상, 모듈/디렉토리 변조 없음, 공격자 마스터와 동기화 0바이트).
- **유출 평가**: redis에는 Bull 잡 메타(잡id·파일경로)뿐 — 시크릿·고객 데이터 없음.
- **오너 후속 권고**: ① api 4000·worker 4001·editor 3000 공인 매핑 결정(레거시 직결 소비자
  확인 후 루프백/제거 — 루트 vercel.json의 58.229.105.98:4000 rewrite가 직결 이력 증거)
  ② redis requirepass(심층방어) ③ auth.log 5/3 전후 포렌식 ④ monitor.sh에 redis role 감시 추가
  ⑤ DOCKER-USER iptables 정책(재발 계층 방어) ⑥ 5~7월 실패 주문/잡 영향 검토.

### 잔여 오너 항목 (갱신)
- bookmoa 고지 2건(§4-5) 그대로 / 라이브 UI 확인(§4-7: ①④⑤⑥ 화면 + 모바일 키보드 스모크)
- 하드커버 표지 규격 후속 트랙: docs/HARDCOVER_COVER_VALIDATION_NOTES.md (페브릭/래더·누드제본 실무 검증)

---

## [갱신 2026-07-14] 내지 PDF 판형 규격표 적용 (오너 스펙) — 배포 완료 d2a925c

- **규격표(재단→작업=+사방3mm)**: A4 210×297(216×303) / B5 182×257(188×263) / 46배판 188×257(194×263) / 16절 190×260(196×266) / B6 128×182(134×188) / 정사각 210×210(216×216) / 비규격=고객 입력값+3mm. 기준값=bookmoa 전달값, 가로형=방향 스왑만·동일 기준, 오차허용 무접촉.
- **채택 설계(A안)**: 워커 validatePageSize 무수정(스왑 허용 금지 — 방향 오업로드 마스킹+fix-bleed innerfit 축소 사고 방지, 무스왑 계약을 spec으로 명문 잠금). 방향 정합은 기준값 유도측:
  ① api 세션 완료 검증 — 전달값이 templateSet 판형의 정확 W↔H 스왑(비정사각)이면 templateSet 방향으로 정규화+warn 계측, expectedOrientation 주입(ORIENTATION_MISMATCH 안내 활성화) ② editor 단일모드 완료 PDF 치수 동일 정규화(G-E, metadata/payload 원본 보존) ③ 워커 spec 규격표 41케이스 CI 잠금 ④ admin 판형 힌트 교정(ISO B5 176×250 오기 제거) ⑤ docs 규격표 섹션.
- **DB 교정(오너 승인)**: 세로 하드커버 f0335fda 214×301→**210×297** (가로판과 함께 A4 하드커버 전체 판형=재단 규약 정합).
- **배포**: api VPS+nginx / editor·admin 웹훅 빌드 Ready+별칭 확인. 검증: api 327·worker 458(+41)·editor 417(+6)·admin 클린.
- **bookmoa 지시문**: `.cursor/plans/NOTICE_bookmoa_inner_pdf_size_spec_2026-07-14.md` (로컬 전용 — 오너가 파트너 전달).
- 오너 확인 잔여: A5 세트(148×210) 실재하나 규격표에 없음 — admin 힌트에서 제거됨(비규격 취급 여부 확인) / 비규격 book 상품 출시 계획 시 첨부·fix-bleed 경로 별도 트랙(현행 구조상 도달 불가) / validate 라우트 게스트 401 비대칭·큐 site-default 미적용(부수 발견 — 백로그).
- **[2026-07-14 추가] A5 규격표 편입(3a74674)**: 148×210(작업 154×216) — 워커 spec +7케이스(총 465)·admin 힌트 복원·docs/지시문 갱신. A5 힌트 제거 확인 항목 해소.

---

## [갱신 2026-07-14 오전] 판형 프리셋 관리 배포(22df006) + bookmoa 가로 templateSet 회신

- **판형 프리셋 관리 LIVE**: format_presets 테이블+시드 7종(마이그레이션 20260714 실행→api 재배포→nginx, 시드 7행 확인) / admin '판형 관리' 화면(템플릿 메뉴)+FormatPresetSelect 픽커(템플릿 생성 모달·스프레드 2차 모달·템플릿셋 폼) Ready. 삭제=비활성 토글만(시드 부활 충돌 방지), 프리셋=저작측 정본(워커·edit-sessions 0바이트 무접촉). 검증: api 339(+12)·admin 50(+10)·worker 465 무접촉.
- 구현 중 사건: 최초 실행에서 API 트랙 에이전트가 연결 종료로 중도 사망(고아 entity) → 검증 게이트가 접점 부재 FAIL 적발 → 워크플로 resume으로 API 트랙만 재실행해 완결(하네스 정상 동작 사례).
- **bookmoa 가로 templateSet 회신 완료**: HANDOFF_bookmoa_landscape_templateset_2026-07-14.md §4 표 기입+§7 회신 절 — mpkte2zbqo5w→83e6ec80 / noriter-14→e66588b2 (기존 7/9 생성분, 판형 규약 정합 완료 상태). 잔여=표지 아트워크 가로 저작(오너), bookmoa 운영자 ID 입력→수용기준 §5 왕복 확인.

## [갱신 2026-07-14 오전 2] 하드커버 내지 정리(①) + 치수 정합 가드(②) 완료 — 8ce4f54

- **① 데이터 정리(오너 승인)**: 하드커버 세로(f0335fda)·가로(83e6ec80) 세트의 내지를 정합 치수(210×297/297×210 기본내지)로 재연결, 구 성책값 내지 2건(214×301/301×214) 비활성(가역). 표지 스프레드(429.2×301/603.2×214)는 하드커버 표지 후속 트랙에서 재저작.
- **② 정합 가드 배포(8ce4f54, admin Ready)**: checkTemplateDimAlignment(재단∨작업, 방향 포함 정확 일치 ±0.01mm, page류만) — TemplateSetForm 행별 배지+비차단 Alert, '템플릿 추가' 필터 재단∨작업 이중 허용 확장, TemplateList 방향(가로/세로/정사각) 컬럼+필터. admin 60/60·lint 0.
- **③ 방향 쌍 관리 설계 제안(오너 회신 대기)**: template_sets에 paired_template_set_id+is_orientation_default additive — 짝 대칭 저장·스왑 정합 가드·1클릭 가로판 파생(내지 빈 캔버스, 자동회전 없음)·bookmoa 자동 resolve는 후속.

## [갱신 2026-07-14 오후] ③ 방향 쌍 관리 배포(a0b72a3) + 기존 4세트 페어링

- **배포**: 마이그레이션 20260714_add_orientation_pair.sql 실행(paired_template_set_id·is_orientation_default) → api 재배포+nginx → admin 웹훅 Ready. 검증: api 369(+30: 파생 변환 왕복<0.01px 실픽스처 포함)·admin 67 green. 봉투 불일치 1건은 검증 게이트가 적발→admin 언랩 수정 후 재검증.
- **기능**: pair/unpair(대칭 트랜잭션, 조건=같은 재단 정확 W↔H 스왑·정사각 불가)·orientation-default(상호배타)·derive-orientation(판형 스왑+설정 복사, **is_active=0 초안**, page류만 자동 재배치 이월 — 크기·회전·스타일·잠금·z순서 보존+위치만 축별 비율, workspace 유효치수 스왑·가이드류 drop, spread/spine류 미이월). admin: 목록 ⇄배지+★, 폼 방향 쌍 섹션+파생 confirm.
- **데이터**: 기본책자(a2cc2939★⇄e66588b2)·하드커버(f0335fda★⇄83e6ec80) 페어링 완료(세로=기본).
- 잔여 참고: 파생 book 초안은 표지(spread) 미이월이라 표지 저작 후 활성화 필요(하드커버 표지 트랙 정합) / 라이브러리 카테고리 연결 미복사(전역 폴백, 필요 시 오너 결정) / bookmoa 자동 resolve API는 후속.
