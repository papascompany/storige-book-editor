# RESUME PROMPT — 2026-08-06 (세션 정본 · edicus/POD 트랙)

> **이 문서가 최신 날짜 정본이다.** 직전 정본 `RESUME_PROMPT_2026-08-04.md`(08-04~08-05 누적 상세)는
> **참조용으로만** 보고, 현재 상태·다음 행동은 이 문서를 따른다.
> 병행 트랙 인계본: `RESUME_PROMPT_2026-08-05_MULTITENANCY.md` (api/admin 소유 — **이 트랙이 건드리지 않는다**).
>
> 작성 2026-08-06 00:30 KST · **갱신 2026-08-06 11:30 KST**(D-12b 확정 → 컷아웃 **활성화 완료**).
> 기준 master **`4a4cd9b`**(문서 커밋이 계속 앞서므로 **해시를 믿지 말고 `git fetch`**).
> **코드 잔여 0 · 전 서비스 LIVE · 컷아웃 기능 ON · 오너 결정 대기 0건**.

---

## 0. 착수 전 확인 (2분 — 순서 고정)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git status -sb && git log --oneline -5
ssh-add -l | head -1                 # 비면: ssh-add ~/.ssh/id_ed25519
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool | head -20
```

- `CLAUDE.local.md`(gitignored) 먼저 — SSH/Vercel/키/운영 레시피 실값.
- ⚠️ **미커밋 변경 `.cursor/plans/RESUME_PROMPT_2026-07-30.md` 는 사용자 소유** — 건드리지 말 것(rebase 시 `--autostash`).
- ⚠️ **api·worker 는 수동 배포**다. editor/admin 만 master push 로 자동 배포된다.
- 로컬 테스트는 **Node 22 를 앞세울 것**: `PATH="/opt/homebrew/opt/node@22/bin:$PATH"` (Node 26 localStorage 함정, §4-1).

---

## 1. 지금 어디까지 왔나 (2026-08-04~06 세션 결과)

| 트랙 | 상태 | 근거 |
|---|---|---|
| [S-E3] 텍스트 프리셋 + 곡선(F5·F6) | ✅ 머지 `18c4a2e` · 프로덕션 LIVE · 라이브 실측 | PR #12 |
| fe-qa 3뷰포트(S-E3 UI) | ✅ 375/768/1280 통과 | 프로덕션 실측 |
| [S-E4] 사진 사용 횟수 배지(F7) | ✅ 머지 `a2c5c1b` · LIVE · 프로덕션 실기 | PR #13 |
| D-6b② 배경제거 픽셀 캡 | ✅ 머지 `4d1c2b1` · 번들 배선 확인 | PR #14 |
| [S-P2A-B] 샤드1 스택 스파이크 | ✅ 결정표 D-12 확정(코드 0) | `CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md` |
| [S-P2A-B] 샤드2 서버 슬라이스 | ✅ 머지 `14a881c` + 후속 수정 `3f6fd20` | PR #15 |
| **컷아웃 VPS 배포·사이드카 기동** | ✅ 완료 | §2 |
| **D-12b 모델 확정 → 컷아웃 ON** | ✅ **2026-08-06 11:20 완료** — `u2net` 확정·`CUTOUT_ENABLED=true` LIVE | `4a4cd9b` · §2-2 |
| **[S-P2A-B] 샤드3 편집기 연결** | ✅ **2026-08-06 12:00 완료** — 종단 실측 성공(로컬 dev↔프로덕션 API) | `10c4f3f` · §2-3 |
| **D-12d imgly(AGPL) 제거** | ✅ 완료 — 번들에서 imgly·onnxruntime 참조 0건 | `8132b0f` |

**현재 프로덕션**: editor/admin 200 · `api/health` ok(**queues 4종 = validation·conversion·synthesis·cutout**) ·
rembg 사이드카 healthy · 디스크 34% · **`CUTOUT_ENABLED=true`(api·worker 양쪽) · `REMBG_MODEL=u2net`**.

---

## 2. ★ 다음 세션이 가장 먼저 할 일

### 2-1. ✅ [완료] D-12b `REMBG_MODEL` 확정 — **u2net_human_seg** (3차·최종)

**2026-08-06 오너 실기 QA 결과 u2net 기각.** 인물 사진에서 얼굴만 남고 정장·셔츠가 반투명하게
지워졌다. 같은 원본(1180×1178)으로 세 모델 실측:

| 모델 | 반투명 픽셀 | 소요 | 결과 |
|---|---|---|---|
| `u2net` | **24.2%** | 1.3s | 몸통이 배경으로 판정됨(salient object detection 특성) |
| **`u2net_human_seg`** ✅ 기본 | **2.7%** | 2.9s | 인물 전체 온전 |
| `isnet-general-use` (화이트리스트 개방) | 18.0% | 4.5s | 인물 전체 온전, 범용 대안 |

배선(`f6da11a`): compose·워커 코드 기본값 = `u2net_human_seg`, API 화이트리스트에 두 모델 추가.
**프로덕션 배포 완료(2026-08-06 18:29 KST)** — 롤백 태그 `storige-{api,worker}:pre-humanseg` ·
api·worker 재빌드 → recreate → nginx 재시작 · `docker exec storige-worker printenv REMBG_MODEL`
= `u2net_human_seg` 확인 · 라이브 프로브에서 신규 2종 통과·`u2net_custom` 차단 유지.
⚠️ **수용된 리스크**: 두 가중치의 학습 데이터셋(Supervisely Person / DIS5K) 상업 조항은
**미확인·회색지대**다 — 1차 결정에서 u2net 을 고른 이유('데이터셋 얽힘 최소')를 품질과 맞바꿨다.
⚠️ `u2net_human_seg` 는 **인물 전용** — 상품·캐릭터·반려동물은 `isnet-general-use` 가 낫다.
✅ **편집기 선택 UI 완료**(`0d289cc`): 모양컷 '효과' 섹션의 **인물/일반 세그먼트 버튼**.
선택은 `useUiPrefStore.cutoutSubject`(persist v9)에 남아 다음 세션에도 유지된다.
`segmentImage(..., options?: { model })` 는 **선택 인자**라 §5-10 시그니처 규약은 유지된다.
⚠️ **비인물 품질은 미실측** — 오너 QA 는 인물 사진 1장뿐이다. '일반'이 상품·캐릭터에서 실제로
나은지는 실기 확인이 남아 있다.

<details><summary>1차 결정 경위(참고)</summary>

#### [보존] D-12b 1차 — u2net
2026-08-06 오너 결정: **(a) u2net 확정**(Apache-2.0). BEN2 는 rembg 백엔드에 부재(`ben_custom` 은
CVE-2026-40086 벡터라 금지), BiRefNet 계열은 이 박스에서 **cgroup OOM**(RSS 3.13GB > 3g) 이라
동작하는 유일한 선택지였다. 품질 열위(머리카락·반투명 경계)는 수용 — 증설 후 재검토 여지.

| 모델 | 결과 | 라이선스 |
|---|---|---|
| **`u2net`** ✅ 확정 | **0.98~3.6s / RSS 1.0GB** — 유일하게 동작 | Apache-2.0 (얽힘 최소) |
| `birefnet-general` (973MB) | ❌ cgroup OOM | MIT (DIS5K 회색) |
| `birefnet-general-lite` (224MB) | ❌ cgroup OOM (파일 크기 무관) | MIT (DIS5K 회색) |

배선(`4a4cd9b`): compose 기본값·워커 코드 기본값을 u2net 으로 **동시 고정** + 프로덕션 `.env` 에
`REMBG_MODEL=u2net` 명시(이중 고정). `birefnet-*` 는 API 화이트리스트에 남아 있으나 **지금 지정하면
그 잡은 OOM 으로 실패**한다.

</details>

### 2-2. ✅ [완료] 기능 활성화 (2026-08-06 11:20 KST)
`docs/DEPLOYMENT.md` §배경제거 절차대로 수행. 실측 근거:

| 단계 | 결과 |
|---|---|
| 롤백 태그(빌드 전) | `storige-worker:pre-cutout-u2net` · `storige-api:pre-cutout-u2net` |
| 모델 예열 | `U2netSession` 생성 OK (캐시 168MB 기존분 재사용) |
| **계약 스모크**(워커 실코드 `RembgService`) | `model=u2net` · 32KB→38KB · **982ms** · PNG colorType=6(알파) |
| `.env` | `CUTOUT_ENABLED=true` · `REMBG_MODEL=u2net` 추가(백업 `.env.bak.pre-cutout-on`) |
| 재기동 | worker 재빌드 → `up -d api worker` → **nginx restart** |
| env 주입 | api `true` · worker `true`/`u2net`/`http://rembg:7000` |
| 라이브 게이트 프로브 | ON 확인(`FILE_NOT_FOUND`) · `u2net_custom`→400 CVE가드 · `bria-rmbg`→400 |
| 큐·헬스 | `api/health` ok, queues 4종 |

⚠️ **워커에 `curl` 이 없어** 문서의 curl 스모크는 실행 불가였다 → `RembgService` 직접 호출로 교체(문서 반영).
⚠️ **잡 종단(큐→워커→산출물)은 아직 미검증** — 아래 2-3 의 P0 갭 때문. 구성요소는 각각 검증됨
(rembg 실추론 프로덕션 ✅ / CutoutProcessor 유닛 10/10 ✅ / API 게이트 라이브 ✅).

### 2-3. ✅ [완료] 샤드 3 — 편집기 연결 (2026-08-06)

오너 결정 = **(ii) storage→files 브릿지**. 확인해 보니 그 브릿지는 **이미 존재**했다 —
`POST /storage/upload-public` 이 `@Public` + `registerExternalFile` 로 `files.id` 를 돌려준다(§4-8).
그래서 신설 없이 그 경로를 소비하는 것으로 끝났다.

| 구현 | 내용 |
|---|---|
| `apps/editor/src/api/cutout.ts`(신규) | 입력 준비(장변 2560 캡·필요 시 JPEG 강등) → 업로드 → 잡 → 폴링(1.5s/210s) → 결과 로드. 에러 코드 분류(기능 off·429·CVE 가드·타임아웃) |
| `useImageStore.segmentImage` | **시그니처 유지** — 내부만 서버 왕복으로 교체. 결과 후처리(`processImage` 알파 트림) 재사용으로 산출 형상 보존. 화면 크기 보상 = `화면크기/inputWidth` |
| `AppClipping` | 대상 폴백(innerItem → 활성 선택 → 단일 이미지) + **워크스페이스 컨텍스트 판별** + 실패 토스트 |
| canvas-core | `getForeground()`·imgly 로더 제거, 의존 삭제(D-12d 종결) |

**★ 이 과정에서 발견한 더 큰 결함**: `renderWorkspace` 는 `canvas.clear()` 로 시작한다. 모양컷이 아닌
캔버스(BOOK 등)에서 '효과'가 동작하게만 고쳤다면 **사용자 디자인이 통째로 지워졌을 것**이다.
→ 컨텍스트를 판별해 일반 캔버스에서는 원본을 결과로 **제자리 교체**한다.

**검증(실측)**

| 무엇 | 결과 |
|---|---|
| 종단 왕복(로컬 dev ↔ 프로덕션 API) | upload 1.1s → 잡 → 워커 `rembg[u2net] 22488B→39882B` → 결과 로드 |
| 결과 알파 | 900×600, 모서리 α=0 / 중앙 α=254 RGB(41,128,184) — 배경 제거 정확, CORS 픽셀 읽기 OK |
| 진입 결함 | 모양컷 패널 '효과' 클릭 → 잡 생성(**종전 무반응**) |
| **라이브 프로덕션 편집기** | 배포 후 실기: 잡 `fd34ece4` 생성 → `rembg[u2net] 21787B→38564B` → 산출물 완료(0.9s) |
| 테스트 | editor 45스위트 581(cutout 19) · canvas-core 42스위트 479 · tsc 0 · SPA/embed 빌드 통과 |

⚠️ **자동 검증이 닿지 못한 구간**: 결과의 OpenCV 트림(`processImage`) 이후 캔버스 배치까지의 **화면 확인**.
로컬 dev 에서는 `@techstark/opencv-js`(UMD)가 dev ESM 로더에서 초기화 실패해(`Cannot set properties of
undefined (setting 'cv')`, `getCv` 미변경·기존 조건) 트림 단계를 태울 수 없었고, 라이브에서는 백그라운드
탭 타이머 throttling 때문에 폴링이 분 단위로 늘어져 완료 화면까지 확인하지 못했다. **눈으로 볼 QA 1회가
남아 있다**(§2-4).

설계 계약 정본은 `CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md` §5-10 (시그니처 유지 규약의 근거).

⚠️ **남은 범위 하나**: canvasData 의 컷아웃 결과는 아직 `processImage` 가 만든 **base64 dataURL** 이다
(=D-6b③ 미완결). 종전 클라 추론과 동일한 형상이라 회귀는 아니지만, 세션 저장 payload 가 커지는 문제는
그대로다. fileId/URL 참조로 바꾸려면 트림 결과를 다시 업로드하거나 트림을 서버로 옮겨야 한다 —
`ensureImageCrossOrigin` 경로와 `extendFabricOption` 등재 여부(화면 전용이면 미등재)를 함께 판단할 것.

### 2-3b. ✅ [완료] 모양컷 업로드 프리즈 — 별건 기존 결함 (오너 QA 실적발)
QA 중 발견: 모양컷 패널에서 사진(JPEG)을 올리면 캔버스가 빈 채 '처리 중' 고정 + 브라우저
**'응답 없는 페이지'**. **샤드3 이전 배포에서도 동일 재현**(A/B: `storige-editor-iz1y6d9dx`) —
서버 오프로드와 무관한 기존 결함이었다.

원인: `getObjectPath()`/`getObjectPathData()` 가 각각 진입부에서 `ensureCvReady()` 를 무조건 호출.
그런데 **알파 없는 이미지의 칼선은 `createExpandedPath()` 로 끝나 OpenCV 를 쓰지 않는다** —
쓰지도 않을 10MB opencv-js 를 받아 메인 스레드에서 컴파일하느라 UI 가 멈춘 것.
→ 로드를 실제 사용 분기(hasAlpha 윤곽 추출)로 이동(`b3d26df`). 회귀 잠금 2건 추가.

### 2-4. 그 밖의 잔여(경미)
- **컷아웃 실기 QA(권장 다음 작업)**: 프로덕션 editor 에서 사람 사진 1장으로 모양컷·일반 캔버스 각각
  1회씩. 자동 검증이 닿지 않는 것은 **품질**(u2net 의 머리카락·반투명 경계)과 모바일 UX 다.
- S-E4: 자동편집 채움 사진 배지 정합 실기 — 포토북 템플릿셋 세션에서 1회.
- ✅ D-12d(AGPL) 해소 완료(`8132b0f`) — SPA `/embed` 의 AGPL 포함 상태가 끝났다.
- 별건: 잡 폴링 `GET /worker-jobs/:id` 게스트 401(fix-bleed·render-pages·compose-mixed 3회 반복) — 공통 수정 판단.
  (컷아웃은 전용 `@Public` 라우트를 따로 둬서 이 문제를 비켜간다.)

---

## 3. 컷아웃 아키텍처 요약 (샤드 3 착수 전 필독)

```
editor ──POST /worker-jobs/cutout──▶ api ──image-cutout 큐──▶ worker(CutoutProcessor)
                                                                    │ multipart POST /api/remove
                                                                    ▼
editor ◀──GET /worker-jobs/:id/cutout-status── api ◀──PATCH──  rembg 사이드카(내부망 전용)
                                                                    │
                                                     /storage/cutouts/<jobId>/<uuid>.png
```

| 항목 | 값 |
|---|---|
| 큐 / 잡 | `image-cutout` / `remove-background` · 동시성 1 |
| 잡 타입 | `WorkerJobType.CUTOUT` — `job_type` varchar(30) → **DDL 변경 없음** |
| 플래그 | `CUTOUT_ENABLED` **기본 false · api·worker 양쪽 필요 · 값은 `true`\|`1`** — 프로덕션 현재 **true** |
| 모델 | `REMBG_MODEL` 기본 **`u2net`**(D-12b 확정). birefnet 계열은 화이트리스트에 있으나 **현 박스에서 OOM** |
| 사이드카 | compose profile `cutout`(기본 `up -d` 미포함) · **포트 미노출** · rembg 2.0.77 핀 |
| 가드 | 장변 2560 캡 · 30MB · 40MP · **바이트 기반 포맷 판정** · 모델 화이트리스트(`_custom` 이중 차단) |
| 테넌트 | 익명은 site 스탬프된 파일·잡에 접근 불가. 게스트(NULL-site)만 익명 허용 |
| 산출물 | `/storage/cutouts/<jobId>/` · 보존 cron 기본 7일(`CUTOUT_RETENTION_DAYS`) |
| 멱등 | 같은 (fileId, model) 24h 내 성공 잡 재사용 — 단 **산출물 실존 확인 후** |

정본: `CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md`(+ [부록 2026-08-06] 실측) · `docs/02_SOFTWARE_ARCHITECTURE_KR.md` §2.3.1-b

---

## 4. 함정 — 이 세션에서 새로 확립(반드시 읽을 것)

### 4-1. rembg `model` 은 쿼리가 아니라 **multipart 바디 필드** ★
`POST /api/remove` 의 쿼리 파라미터는 `bgc`·`extras` 뿐이다(GET 만 `model` 을 쿼리로 받는다).
쿼리로 보내면 **에러 없이 무시되고 기본 모델로 추론** — HTTP 200 + 정상 PNG 라 어떤 자동 검증도 통과하고,
`CutoutJobResult.model` 만 거짓이 되어 라이선스 감사가 틀어진다. 모델 캐시 파일명으로만 발각된다.
→ 수정 `3f6fd20`, 회귀 잠금 스펙 있음. **문서의 curl 예시도 `-F "model=..."` 로 고쳐져 있다.**

### 4-2. enum 확장은 admin 프로덕션 빌드를 깬다 ★
`WorkerJobType` 에 값을 추가하면 `apps/admin/.../WorkerJobList.tsx` 의
`Record<WorkerJobType, string>` 이 **exhaustive 라 TS2741** 로 터진다. **CI 는 통과하는데 Vercel admin
배포만 red** 가 되고, editor 는 `vite build` 단독(타입체크 없음)이라 더 늦게 드러난다.
→ enum 을 늘릴 땐 admin 라벨 맵을 **같은 커밋에서** 갱신하고 `pnpm --filter @storige/admin exec tsc --noEmit` 로 확인.

### 4-3. `.env` 만 넣고 compose `environment` 매핑을 빠뜨리면 죽는다 (4회째)
이번엔 silent no-op 이 아니라 **기능 100% FAILED** 였다(`CUTOUT_ENABLED` 가 api 에만 매핑).
플래그성 env 는 **소비하는 컨테이너 전부**에 매핑하고, 진리값 술어(`true`|`1`)도 양쪽을 맞출 것.

### 4-4. 배포 전에 롤백 태그를 먼저 찍어라
`docker compose build` 가 기존 태그를 덮은 뒤에는 구 이미지가 GC 돼 **태그를 만들 수 없다**(이번에 실패).
순서: `docker tag storige-api storige-api:pre-<슬러그>` → **그다음** build.
현재 롤백 경로는 git: `git checkout 5e95a20 && docker compose up -d --build api worker` (+nginx 재시작).

### 4-5. 사이드카 콜드스타트 ~2분 · 모델 다운로드는 **요청 시점**
python + onnxruntime import 로 첫 리슨까지 약 2분. healthcheck `start_period` 를 짧게 잡으면 오탐.
모델 가중치는 기동이 아니라 **첫 요청** 때 받는다(973MB) → 예열 없이 첫 잡을 태우면 타임아웃 위험.

### 4-6. 브라우저 팬 조작 함정
도구 버튼은 `aria-label` 이 아니라 **`title` 속성**이다. 팬이 숨겨진 상태에서 `computer` 클릭은 30s 타임아웃 →
`javascript_tool` 로 `document.querySelector('button[title="이미지"]').click()` 우회.
로컬 dev 는 zoom=0 으로 초기화되므로 `setViewportTransform` 이 필요할 수 있다.

### 4-7. 워커 컨테이너에 `curl` 이 없다 (문서의 스모크 명령이 실행 불가였다)
alpine 베이스라 `wget` 만 있고 multipart 를 못 만든다. 사이드카 계약 스모크는 **워커의 실제 클라이언트
코드를 직접 호출**한다(`require('/app/apps/worker/dist/services/rembg.service.js')`) — 조립·모델 필드·
PNG 매직 검증까지 프로덕션 경로와 동일해 curl 보다 강하다. 명령 전문은 `docs/DEPLOYMENT.md` §②-b.

### 4-8. 게스트 이미지의 `files` 등록 통로는 **`/storage/upload-public` 하나뿐이다** ★
`/files/upload`·`/files/upload/external` 은 `mimetype !== 'application/pdf'` → 400 이고, presigned 는
`STORAGE_DRIVER=local` 이라 503 이다. 반면 `POST /storage/upload-public` 은 `@Public` 이면서 내부에서
`filesService.registerExternalFile` 까지 수행해 **`files.id` 를 돌려준다**(2026-07-13 통합 균열 수정분).
컷아웃 잡이 요구하는 것이 그 id 라, 샤드3 는 이 경로를 쓴다.

> ⚠️ 정정: 08-06 중간 기록에 "게스트 이미지를 files 에 등록할 경로가 없다"고 적었으나 **틀렸다** —
> `/files/*` 와 presigned 만 보고 storage 모듈을 확인하지 않은 결과다. 브릿지는 이미 있었다.
> 다만 편집기의 일반 이미지 업로드(`storageApi.uploadFile` → `/storage/upload?category=uploads`)는
> **JWT 라우트이고 files 레코드도 만들지 않는다** — 게스트 경로와 다르다는 점은 여전히 주의.

### 4-9. lazy 로더는 **진입점이 아니라 실사용 분기**에서 불러야 한다 ★
`getObjectPath` 가 "공개 진입점에서 명시(멱등)"이라는 선의로 `ensureCvReady()` 를 선행 호출한
탓에, OpenCV 를 한 줄도 쓰지 않는 경로(알파 없는 이미지 칼선)가 10MB 파싱·컴파일을 떠안아
브라우저가 '응답 없음'까지 갔다(2026-08-06 실적발, `b3d26df`).
멱등 캐시가 있다고 해서 **호출 위치가 공짜인 것은 아니다** — 첫 호출자가 비용을 전부 문다.
같은 패턴이 남아 있는지 볼 것: `ensureCvReady()` 호출부 중 그 함수가 정말 cv 를 쓰는지.

### 4-10. 계속 유효한 기존 함정
- **api recreate 후 nginx 재시작 필수**(리터럴 `proxy_pass` + resolver 없음 → 502)
- CI 유출 게이트가 **주석·테스트명의 외부 벤치 식별자**까지 DENY (editor `postbuild` 도 dist 스캔)
- 로컬 canvas-core 의 fabric import 테스트 4스위트는 `canvas.node` 미빌드로 실패(**기준선** — CI 무관)
- api 빌드 46 에러는 대개 `@storige/types` 미빌드
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="origin/master..HEAD"`

---

## 5. 상태 스냅샷 (2026-08-06 11:30 KST 실측)

- master **`4a4cd9b`** · 작업 브랜치 전부 머지·삭제(**코드 잔여 0**) · 미커밋 = 사용자 소유 1건
- 프로덕션: api/health **ok**(큐 4종) · rembg **healthy** · 디스크 **34%** · api/worker/nginx 재기동 완료
- 메모리(호스트 7.9GB): rembg 상한 3g(u2net 피크 RSS 1.0GB) · worker 4g · 여유 ~5.6GB
- **`CUTOUT_ENABLED=true`(api·worker) · `REMBG_MODEL=u2net`** — `.env` 명시 + compose·코드 기본값도 u2net
- 롤백: `storige-worker:pre-cutout-u2net` · `storige-api:pre-cutout-u2net` · `.env.bak.pre-cutout-on`
  (기능만 끄려면 `.env` `CUTOUT_ENABLED=false` → `up -d api worker` → **nginx restart**)
- 모델 캐시(named volume `storige_rembg_models`): u2net 168MB · birefnet-general 928MB · -lite 214MB
- 테스트 기준선: api **930** · worker **511** · **editor 45스위트 581**(신규 cutout 16) ·
  canvas-core **42스위트 479**(로컬 실패 4 = `canvas.node` 미빌드 기준선)
  · 이번 회귀 확인: worker rembg 11/11 · worker cutout processor 10/10 · api worker-jobs 170/170
- ⚠️ **editor lint 는 기준선이 red** 다(`src/test/setup.ts` 의 `no-undef` 2건) — 내 변경 전에도 동일.
  샤드3 작업과 무관하므로 손대지 않았다. 정리하려면 eslint env 에 `browser` 전역(Storage)을 열면 된다.

---

## 6. 정본 문서 포인터

| 주제 | 정본 |
|---|---|
| 컷아웃 스택·라이선스·실측 | `.cursor/plans/CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md` (+부록 08-06) |
| 오너 결정표 | `.cursor/plans/OWNER_DECISIONS_2026-07-07.md` (D-6·D-12) |
| 배포·활성화 절차 | `docs/DEPLOYMENT.md` §배경제거(CUTOUT) 사이드카 |
| 아키텍처 | `docs/02_SOFTWARE_ARCHITECTURE_KR.md` §2.3.1-b · `docs/04_DATABASE_ERD.md` |
| edicus 트랙 프롬프트 | `/Users/yohan/Developer/edicus-analysis/EDICUS_DEV_WORK_PROMPTS.md` |
| 직전 상세(08-04~05) | `.cursor/plans/RESUME_PROMPT_2026-08-04.md` |
| 병행 트랙(api/admin) | `.cursor/plans/RESUME_PROMPT_2026-08-05_MULTITENANCY.md` |

---

## 7. 새 세션 시작 프롬프트 (복사해서 그대로 사용)

```
storige 프로젝트를 이어서 진행합니다.

착수 전:
1. CLAUDE.local.md (SSH/Vercel/키/레시피 실값)
2. .cursor/plans/RESUME_PROMPT_2026-08-06.md — 이 문서가 정본. §0 착수 전 확인 → §2 다음 할 일 순서로.
3. git fetch && git log --oneline -5 && git status -sb
   (미커밋 RESUME_PROMPT_2026-07-30.md 는 사용자 소유 — 보존)

현재 상태: 컷아웃 서버 오프로드가 프로덕션에서 **켜져 있고**(CUTOUT_ENABLED=true, REMBG_MODEL=u2net),
**샤드3(편집기 연결)까지 머지·배포 완료**. imgly(AGPL) 제거로 D-12d 도 종결. 오너 결정 대기 0건 · 코드 잔여 0.

다음 할 일은 §2-4 의 **컷아웃 실기 QA** — 프로덕션 editor 에서 사람 사진으로 모양컷·일반 캔버스
각 1회. 자동 검증이 닿지 않는 것은 품질(u2net 경계)과 모바일 UX 다.

주의: §4 함정 10건 — rembg model 은 바디 필드(4-1), enum 확장 시 admin 라벨 맵 동반 갱신(4-2),
compose env 매핑 누락(4-3), 배포 전 롤백 태그(4-4), 워커에 curl 없음(4-7),
게스트 files 등록은 /storage/upload-public 뿐(4-8), lazy 로더 위치(4-9), api recreate 후 nginx 재시작(4-10).
로컬 테스트는 PATH="/opt/homebrew/opt/node@22/bin:$PATH" 로 Node 22 를 앞세울 것.
```
