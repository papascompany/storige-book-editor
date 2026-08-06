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

**현재 프로덕션**: editor/admin 200 · `api/health` ok(**queues 4종 = validation·conversion·synthesis·cutout**) ·
rembg 사이드카 healthy · 디스크 34% · **`CUTOUT_ENABLED=true`(api·worker 양쪽) · `REMBG_MODEL=u2net`**.

---

## 2. ★ 다음 세션이 가장 먼저 할 일

### 2-1. ✅ [완료] D-12b `REMBG_MODEL` 확정 — **u2net**
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

### 2-3. 샤드 3 — 편집기 연결 (다음 구현)

**★ P0 선결 갭(2026-08-06 발견): 게스트 이미지를 `files` 에 등록할 경로가 없다.**
컷아웃 잡은 `files.id`(UUID)를 요구하는데 —
- 프로덕션은 `STORAGE_DRIVER=local` → `POST /files/presigned-upload-public` 은 **503 STORAGE_NOT_S3**
- `POST /files/upload` · `POST /files/upload/external` 은 **둘 다 `mimetype !== 'application/pdf'` 400 필터**
- 편집기의 실제 이미지 업로드는 `POST /storage/upload?category=uploads` = **storage 모듈이라 `files` 레코드가 없다**

→ 샤드 3 은 "base64 → fileId 참조 전환" 이전에 **이미지 → `files` 등록 경로**를 먼저 정해야 한다.
선택지: (i) `/files/upload` 계열의 MIME 필터를 이미지까지 확장(게스트용 무인증 라우트 신설 필요) /
(ii) `/storage/upload` 결과를 `files` 에 등록하는 브릿지 / (iii) R2(s3) 드라이버 전환으로 presigned 개통
(저장계층 R2 추상화는 이미 있고 오너 프로비저닝 대기 상태).


계약: `CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md` §5-10.
- `useImageStore.segmentImage(image, canvas, imagePlugin, loadingBar) → Promise<FabricImage>`
  **시그니처를 유지**하고 내부만 잡 요청/폴링으로 교체 → `AppClipping` 호출부 무변경.
- canvasData 를 base64 인라인 → **fileId/URL 참조**로 전환(**=D-6b③ 완결**). `ensureImageCrossOrigin`
  경로 확인, 신규 prop 은 `extendFabricOption` 등재 여부 판단(화면 전용이면 미등재).
- **동시 해소 필수**: 모양컷 진입 도달 불가 결함 — `AppClipping.currentImage` 가 컴포넌트 로컬 state 인데
  업로드 핸들러의 `hideSidePanel()` 이 언마운트시켜 소실된다. 복원 effect 는 `id==='innerItem' &&
  extensionType==='clipping'` 객체를 요구하는데 BOOK 템플릿에선 생성되지 않아 **'효과' 클릭이 무반응**이다.

### 2-4. 그 밖의 잔여(경미)
- S-E4: 자동편집 채움 사진 배지 정합 실기 — 포토북 템플릿셋 세션에서 1회.
- D-12d(AGPL): imgly 의존 제거로 해소하기로 결정됨 — 샤드 3에서 클라 추론 경로가 빠질 때 함께.
  **제거 전까지 SPA `/embed` 는 AGPL 코드 포함**(임베드 IIFE 는 이미 스텁 치환이라 파트너 배포물은 무관).
- 별건: 잡 폴링 `GET /worker-jobs/:id` 게스트 401(fix-bleed·render-pages·compose-mixed 3회 반복) — 공통 수정 판단.

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

### 4-8. `files` 등록 경로가 이미지에 대해 존재하지 않는다 (샤드 3 선결)
`/files/upload`·`/files/upload/external` 은 `mimetype !== 'application/pdf'` → 400 이고, presigned 는
`STORAGE_DRIVER=local` 이라 503 이다. 편집기 업로드는 `/storage/upload` 라 `files` 레코드를 만들지 않는다.
**컷아웃 잡은 `files.id` 를 요구하므로**, 이 갭을 메우기 전에는 실사용 종단이 성립하지 않는다(§2-3).

### 4-9. 계속 유효한 기존 함정
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
- 테스트 기준선: api **930** · worker **511** · editor 44스위트 · canvas-core(로컬 4스위트 실패=기준선)
  · 이번 회귀 확인: worker rembg 11/11 · worker cutout processor 10/10 · api worker-jobs 170/170

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

현재 상태: 컷아웃 서버 오프로드가 프로덕션에서 **켜져 있음**(CUTOUT_ENABLED=true, REMBG_MODEL=u2net,
D-12b 확정 완료). 오너 결정 대기 0건 · 코드 잔여 0.

다음 할 일은 §2-3 샤드3(편집기 연결)이고, **착수 전에 P0 갭부터 결정**해야 한다:
게스트 이미지를 files 에 등록할 경로가 현재 없다(§2-3 · §4-8). 3안 중 택1이 필요.

주의: §4 함정 9건 — rembg model 은 바디 필드(4-1), enum 확장 시 admin 라벨 맵 동반 갱신(4-2),
compose env 매핑 누락(4-3), 배포 전 롤백 태그(4-4), 워커에 curl 없음(4-7), files 등록 갭(4-8),
api recreate 후 nginx 재시작(4-9).
로컬 테스트는 PATH="/opt/homebrew/opt/node@22/bin:$PATH" 로 Node 22 를 앞세울 것.
```
