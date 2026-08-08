# RESUME PROMPT — 2026-08-07 (세션 정본 · edicus/POD 트랙)

> **이 문서가 최신 날짜 정본이다.** 직전 정본 `RESUME_PROMPT_2026-08-06.md`(컷아웃 활성화~프리즈
> 종결의 상세 서사·실측 근거)는 **참조용**. 병행 트랙: `RESUME_PROMPT_2026-08-05_MULTITENANCY.md`
> (api/admin 소유 — 이 트랙이 건드리지 않는다).
>
> 작성 2026-08-07 17:10 KST · 기준 master **`32a34fd`**(해시를 믿지 말고 `git fetch`).
> **코드 잔여 0 · 전부 push+배포 Ready · 오너 결정 대기 0건.**

---

## 0. 착수 전 확인 (2분 — 순서 고정)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git status -sb && git log --oneline -8
ssh-add -l | head -1                 # 비면: ssh-add ~/.ssh/id_ed25519
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool | head -20
```

- `CLAUDE.local.md`(gitignored) 먼저 — SSH/Vercel/키/운영 레시피 실값.
- ⚠️ 미커밋 `.cursor/plans/RESUME_PROMPT_2026-07-30.md` 는 **사용자 소유** — 무접촉(rebase 시 `--autostash`).
- ⚠️ api·worker 는 **수동 배포**(editor/admin 만 master push 자동). api recreate 후 **nginx 재시작 필수**.
- 로컬 테스트는 Node 22: `PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.

## 1. 상태 스냅샷 (2026-08-07 17:00 실측)

**컷아웃(배경제거) 트랙 완결.** 서버 오프로드 + 편집기 연결 + 모델 확정 + 프리즈 종결까지 전부 LIVE.

| 항목 | 상태 |
|---|---|
| 서버 | `CUTOUT_ENABLED=true`(api·worker) · `REMBG_MODEL=u2net_human_seg`(D-12b 3차 확정) · isnet-general-use 화이트리스트 개방 · 롤백 태그 `pre-humanseg` |
| 편집기 | 모양컷 '효과' = 서버 왕복(`api/cutout.ts`) + **인물/일반 세그먼트 버튼**(`useUiPrefStore.cutoutSubject`, persist v9) |
| 칼선 | **OpenCV 제거 — `pureContour.ts`(순수 JS) 가 정본**. 실측: 단순 10ms/최악 50ms·renderWorkspace 133ms·UI 상시 응답 |
| 라이선스 | imgly(AGPL) 제거 완결(D-12d). ⚠️ u2net_human_seg/isnet 학습 데이터셋 상업 조항은 회색지대 수용(OWNER_DECISIONS D-12b) |
| 테스트 기준선 | canvas-core 44스위트 499(로컬 4스위트 실패=canvas.node 기준선) · editor 46스위트 588 · api 930 · worker 511 |
| 주요 커밋 | `f6da11a`(모델 3차) `0d289cc`(피사체 UI) `eba7b4e`(렌더 미실행/빈상태) `6120c80`(OpenCV 제거) `19b2854`(빈 칼선 폴백) |

## 2. ★ 다음 할 일 (우선순위순)

1. **[P1] 오너 실기 QA 마무리** — 이제 안 굳는다. 모양컷 → 업로드 → 인물/일반 → '효과' 를
   실사진(인물)·비인물(상품/캐릭터) 각 1회. 확인 포인트: 칼선 모양(각지면
   `CONTOUR_APPROX_EPSILON_RATIO` 0.0008 하향), '일반' 모델의 비인물 품질(미실측).
2. **[P1] 게스트 사진 등록 401** — 일반 이미지 업로드마다 콘솔에
   `POST /api/storage/upload?category=uploads → 401` + `[useImageStore.registerUploadedPhoto] 등록 실패`.
   원인: `storageApi.uploadFile` 이 JWT+Roles 라우트를 침. 게스트는 자동편집(배지/EXIF) 입력 등록이
   전량 실패 중. **수정 = `/storage/upload-public`(@Public, files 레코드까지 생성) 로 전환** —
   fire-and-forget 이라 편집 자체는 무영향이었지만 자동편집 데이터가 비어 있다.
3. **[P2] 레거시 cv 메서드 3종 이식** — `createOffsetPathFromShape`(모양틀)·
   `createPrecisePathFromObject`·`drawCaseOutlinePrecise` 는 여전히 opencv 의존 = **동작 불능**
   (단 getCv 20s 타임아웃으로 굳지는 않음). `pureContour.ts` 패턴으로 이식하면 된다.
   ⚠️ 모양틀은 사용자 도달 가능(setShapeAsMold).
4. **[P2] D-6b③** — 컷아웃 결과가 canvasData 에 base64 dataURL 로 들어감(세션 payload 비대).
   fileId/URL 참조 전환은 트림 재업로드 또는 트림 서버 이관 필요.
5. **[P3] 08-06 잔여** — S-E4 자동편집 배지 실기(포토북 세션에서) · 잡 폴링 `GET /worker-jobs/:id`
   게스트 401 공통수정 판단 · 모양컷 '효과' 샘플 썸네일의 전/후 대비 소실(코기→포메 교체 여파, 선택).

## 3. 함정 (이 트랙에서 실증된 것 — 위반 시 재발)

- ★ **opencv-js(dist/opencv.js)는 실행 불능** — ESM/`<script>`/Web Worker 모두 실측 실패.
  칼선은 `pureContour.ts` 가 정본. **cv 를 칼선 경로에 되살리지 말 것.**
- 멈춘 탭 디버깅: 트레이스가 **localStorage `__storigeTrace`** 로 즉시 flush 된다 —
  블록된 탭 콘솔이 안 열려도 같은 origin 다른 탭에서 `▶ 미완료 마커` = 멈춘 지점.
- 게스트 이미지의 files 등록 통로는 **`POST /storage/upload-public` 하나뿐**
  (`/files/upload*`=PDF 전용, presigned=local 드라이버 503).
- `cutout-status` 의 status 는 **대문자**(COMPLETED/FAILED) — 소문자 정규화 제거 금지.
- `renderWorkspace` 는 `canvas.clear()` 로 시작 — 모양컷 밖 캔버스에서 호출하면 디자인 전체 소실.
  컨텍스트 판별(`isClippingWorkspace`) 유지할 것.
- rembg `model` 은 **multipart 바디 필드**(쿼리는 무시됨) · 워커 컨테이너에 **curl 없음**
  (스모크는 dist 의 `RembgService` 직접 require) · compose env 매핑 누락=silent no-op ·
  배포 전 롤백 태그 선행 · birefnet 계열은 현 VPS 에서 cgroup OOM.
- editor lint 는 기준선 red(`src/test/setup.ts` no-undef 2건 — 내 변경과 무관).

## 4. 정본 포인터

| 주제 | 정본 |
|---|---|
| 프리즈 종결 상세 서사·실측 | `RESUME_PROMPT_2026-08-06.md` §2-3b~2-3c·§4 |
| 순수 JS 칼선 구현 | `packages/canvas-core/src/utils/pureContour.ts`(+test) |
| 컷아웃 스택·모델 결정 | `OWNER_DECISIONS_2026-07-07.md` D-12 · `CUTOUT_WORKER_STACK_SPIKE_2026-08-05.md` |
| 서버 활성화·운영 절차 | `docs/DEPLOYMENT.md` §배경제거(CUTOUT) |
| 병행 트랙(api/admin) | `RESUME_PROMPT_2026-08-05_MULTITENANCY.md` |

## 5. 새 세션 시작 프롬프트 (복사해서 그대로 사용)

```
storige 프로젝트를 이어서 진행합니다.

착수 전:
1. CLAUDE.local.md (SSH/Vercel/키/레시피 실값)
2. .cursor/plans/RESUME_PROMPT_2026-08-07.md — 이 문서가 정본. §0 확인 → §2 우선순위 순서로.
3. git fetch && git log --oneline -8 && git status -sb
   (미커밋 RESUME_PROMPT_2026-07-30.md 는 사용자 소유 — 보존)

현재 상태: 컷아웃 트랙 완결 — 서버 오프로드+편집기 연결+u2net_human_seg(인물/일반 UI)+
'효과' 프리즈 종결(OpenCV 제거, pureContour 순수 JS 칼선)까지 전부 LIVE. 코드 잔여 0.

다음 할 일(§2): ①오너 실기 QA(인물/비인물 각 1회 — 칼선 모양·'일반' 품질 확인)
②게스트 registerUploadedPhoto 401 수정(/storage/upload → /storage/upload-public 전환)
③레거시 cv 메서드 3종을 pureContour 패턴으로 이식(모양틀이 사용자 도달 가능)
④D-6b③ base64→fileId ⑤기타 §2-5.

주의(§3): opencv-js 는 어디서도 실행 불능 — 칼선에 cv 복원 금지. 멈춤 디버깅은
localStorage __storigeTrace. 게스트 files 등록은 /storage/upload-public 뿐.
cutout-status 는 대문자. renderWorkspace 는 canvas.clear() 로 시작(컨텍스트 판별 유지).
api/worker 수동배포+nginx 재시작. 로컬 테스트 PATH="/opt/homebrew/opt/node@22/bin:$PATH".
```
