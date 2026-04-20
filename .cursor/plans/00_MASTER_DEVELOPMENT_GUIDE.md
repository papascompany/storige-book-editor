# Storige 통합 개발 가이드 (Master Development Guide)

> **이 문서의 목적**
> Storige 프로젝트를 처음 접하는 사람이 이 문서 하나만 따라가면 **환경 세팅 → 코드 이해 → 개발/수정 → 배포 → 운영**까지 순서대로 할 수 있도록 만든 단일 진입점(index).
> `.cursor/plans/`의 다른 모든 문서는 이 가이드에서 가리키는 참고 자료다.
>
> **기준 시점**: 2026-04-16, 커밋 `f2680ec` 기준
> **문서 버전**: v1.0 (통합 최초 작성)

---

## 0. 이 문서를 읽는 법

```
아무것도 모름
  │
  ▼
[1. 문서 지도]  ← 있는 문서들 관계 파악 (읽기만)
  │
  ▼
[2. 5분 요약]   ← 이 시스템이 뭐 하는 건지
  │
  ▼
[3. 환경 세팅]  ← 내 PC에서 돌려보기
  │
  ▼
[4. 코드베이스 이해]  ← 어디에 뭐가 있는지
  │
  ▼
[5. 현재 상태]  ← 뭐가 끝났고 뭐가 남았는지 (P0~P16)
  │
  ▼
[6. 개발 흐름]  ← 기능 추가/수정 실제 절차
  │
  ▼
[7. 배포 & 운영]
  │
  ▼
[8. 장애 대응 & FAQ]
```

**읽기 순서는 반드시 위→아래**. 건너뛰지 말고, 막히면 해당 섹션이 가리키는 참고 문서를 읽고 돌아와라.

---

## 1. 문서 지도 (Document Map)

### 1.1 `.cursor/plans/` 폴더 전체 파일

| # | 파일 | 역할 | 언제 읽나 | 상태 |
|---|------|------|-----------|------|
| 0 | **`00_MASTER_DEVELOPMENT_GUIDE.md`** | **이 문서. 모든 입구** | 맨 처음 | 🟢 최신 |
| 1 | `takeover_report.md` | 최초 기술 인수인계 (ChatGPT-5.4 작성) | 배경 이해할 때 | 🟡 참고용 |
| 2 | `HANDOFF_GUIDE.md` | P0~P16 우선순위 + 12개 위험지점 심층 분석 | 작업 우선순위 정할 때 | 🟢 최신 |
| 3 | `P0A_START_HERE_결정가이드.md` | P0-A(DB 스키마) 처리 방법 선택 가이드 | DB 작업 시작 전 | 🟢 최신 |
| 4 | `P0A_DB_SCHEMA_FIX.md` | `init.sql` 수동 수정 실행 플레이북 | P0-A 결정 (b) 택했을 때 | 🟢 최신 |
| 5 | `WORKER_FLOW_전체정리.md` | 워커/PDF 파이프라인 end-to-end 흐름 | PDF/큐 관련 작업 시 | 🟢 최신 |
| 6 | `admin_api_testphp_checklist.md` | Admin→API→test-php 연동 검증 절차 | 외부 연동 검증 시 | 🟢 최신 |
| 7 | `admin_api_testphp_sample.php` | `by-product` 조회 샘플 PHP | 외부 연동 개발 시 | 🟢 최신 |
| 8 | `admin_api_testphp_verify.php` | 외부 연동 검증 스크립트 | 외부 연동 검증 시 | 🟢 최신 |

### 1.2 문서 관계도

```
takeover_report.md  (원본 인수 보고서, 배경만)
        │
        ▼ (요약/우선순위 추출)
HANDOFF_GUIDE.md  (P0~P16 작업 목록 + Deep Scan 12개 이슈)
        │
        ├─────────▶ P0A_START_HERE_결정가이드.md
        │               │
        │               ├─▶ (b) 수동 택) P0A_DB_SCHEMA_FIX.md
        │               └─▶ (c) 마이그 택) 아직 문서 없음
        │
        ├─────────▶ WORKER_FLOW_전체정리.md   (워커 전용 횡단 정리)
        │
        └─────────▶ admin_api_testphp_checklist.md
                        │
                        └─▶ admin_api_testphp_sample.php / verify.php
```

### 1.3 어떤 작업 할 때 뭘 읽나 (빠른 참조)

| 내가 하려는 것 | 먼저 읽을 문서 |
|----------------|----------------|
| 프로젝트 처음 이해 | 이 문서 §2, §4 → `takeover_report.md` §1~§5 |
| 로컬 환경 세팅 | 이 문서 §3 |
| DB 스키마 문제 해결 (P0-A) | `P0A_START_HERE_결정가이드.md` → `P0A_DB_SCHEMA_FIX.md` |
| 에디터 기능 추가 | `HANDOFF_GUIDE.md` §3 + `canvas-core` 플러그인 패턴 |
| API 엔드포인트 추가 | `HANDOFF_GUIDE.md` §4 + 기존 컨트롤러 모방 |
| PDF/워커 처리 이해 | `WORKER_FLOW_전체정리.md` 전체 |
| 외부 쇼핑몰 연동 검증 | `admin_api_testphp_checklist.md` |
| 배포 | 이 문서 §7 + `docker-compose.yml` |
| 장애 대응 | 이 문서 §8 + `HANDOFF_GUIDE.md` §10 (장애 분류표) |

---

## 2. 5분 요약 (What is Storige?)

### 2.1 한 줄 정의
**Storige = 북모아(Bookmoa) 쇼핑몰에 붙는 "웹 에디터 + PDF 합성" 시스템**. 고객이 브라우저에서 템플릿을 편집하면 → 서버가 인쇄 가능한 PDF를 합성한다.

### 2.2 주요 구성요소

| 앱 | 역할 | 포트 | 프레임워크 |
|----|------|------|-----------|
| `apps/editor` | 고객이 쓰는 캔버스 에디터 | 3000 | React + Vite + **Fabric.js** |
| `apps/admin` | 운영자 템플릿 관리 | 3001 | React + **Ant Design** |
| `apps/api` | REST API 게이트웨이 | 4000 | **NestJS** + TypeORM |
| `apps/worker` | PDF 합성 워커 | 4001 | NestJS + **Bull** + pdf-lib |

```
고객 브라우저
  │
  ├─▶ editor(:3000) ─(edit-session 저장)─▶ api(:4000) ─▶ MariaDB
  │                                            │
  │                                            ├─▶ Bull/Redis ─▶ worker(:4001) ─▶ PDF 합성
  │                                            │                                      │
  │                                            └─◀──── 상태 콜백 ──────────────────┘
  │
  └─▶ (외부 쇼핑몰 → test-php 하네스 → editor 임베드)

운영자 브라우저
  └─▶ admin(:3001) ──▶ api(:4000)
```

### 2.3 인증 3종 병존 (⚠️ 가장 헷갈리는 부분)

1. **에디터 (고객)**: `localStorage.auth_token` — 직접 로그인 없음, 쇼핑몰 세션 토큰 재사용
2. **어드민 (운영자)**: `localStorage.accessToken` + `refreshToken` — 별도 로그인
3. **북모아 쇼핑몰 세션**: HttpOnly 쿠키 `storige_access` + `storige_refresh` — `/api/auth/shop-session` 경로

셋이 **같은 프로젝트 안에서 병렬로 존재**한다. `HANDOFF_GUIDE.md` §7.1 참고.

### 2.4 데이터 흐름 (핵심)

1. `edit_sessions` 테이블에 캔버스 JSON 저장 (고객 편집 중)
2. 편집 완료 → `worker_jobs` 테이블 + Bull 큐에 3종 잡 생성
3. 워커가 `pdf-validation` → `pdf-conversion` → `pdf-synthesis` 순서로 처리
4. 워커 완료 → API 콜백 → `status=completed`, `mergedUrl` 저장
5. 필요 시 외부 웹훅 전송 (HMAC 아님, base64 서명)

상세는 `WORKER_FLOW_전체정리.md`.

---

## 3. 환경 세팅 (처음 한 번만)

### 3.1 필수 설치

| 도구 | 버전 | 확인 |
|------|------|------|
| Node.js | 20.x 권장 (18.x도 가능) | `node -v` |
| pnpm | 9.x | `pnpm -v` (없으면 `npm i -g pnpm`) |
| Docker Desktop | 최신 | `docker -v` |
| Git | 최신 | `git -v` |

Ghostscript는 `docker-compose.yml`의 `worker` 컨테이너 안에 들어있으므로 **호스트에 설치할 필요 없음**.

### 3.2 최초 클론 & 설치

```bash
git clone <repo-url>
cd storige

# 1) 환경변수 복사
cp .env.example .env
# 필요한 값 수정 (DB 비밀번호, JWT_SECRET 등). 기본값도 동작하지만 운영은 반드시 교체

# 2) 의존성 설치 (루트에서 한 번만)
pnpm install

# 3) types 패키지 먼저 빌드 (다른 앱이 의존)
pnpm --filter @storige/types build
```

### 3.3 인프라 기동 (MariaDB + Redis)

```bash
# DB/Redis만 먼저 띄우기 (앱은 로컬에서 돌리고 싶을 때)
docker-compose up -d mariadb redis

# 또는 전체 스택 통으로 띄우기
docker-compose up -d
```

MariaDB 컨테이너가 처음 뜰 때 `docker/mysql/init.sql`이 실행된다. **⚠️ 이 파일은 현재 10개 테이블만 정의되어 있어 엔티티 26개와 불일치**. 상세는 §5.1 P0-A 참고.

### 3.4 개발 서버 기동

```bash
# 루트에서 전부 한 번에
pnpm dev

# 또는 개별로 (별도 터미널)
pnpm --filter @storige/api dev       # :4000
pnpm --filter @storige/worker dev    # :4001
pnpm --filter @storige/editor dev    # :3000
pnpm --filter @storige/admin dev     # :3001
```

### 3.5 최초 동작 확인 체크리스트

1. `http://localhost:4000/api/health` → `{status: "ok"}`
2. `http://localhost:3001` → 어드민 로그인 화면 (이메일 `admin@storige.com` / 비밀번호는 `.env`의 `ADMIN_PASSWORD`)
3. 어드민 로그인 성공
4. 템플릿셋 1개 생성 시도 → **여기서 500 에러 나면 P0-A 문제**. §5.1로.
5. `http://localhost:3000` → 에디터 진입. 템플릿셋 ID가 있어야 실제 편집 가능.

---

## 4. 코드베이스 이해

### 4.1 최상위 구조

```
storige/
├── apps/
│   ├── editor/          # 고객 캔버스 에디터 (React + Fabric.js)
│   ├── admin/           # 운영자 대시보드 (React + AntD)
│   ├── api/             # REST API (NestJS)
│   └── worker/          # PDF 워커 (NestJS + Bull)
├── packages/
│   ├── types/           # 공유 타입 (먼저 빌드 필수)
│   ├── canvas-core/     # Fabric.js 래퍼 + 플러그인 시스템
│   ├── ui/              # 공유 React 컴포넌트
│   └── ai/              # (⚠️ 아직 문서화 안 됨. README 업데이트 필요)
├── docker/
│   ├── mysql/init.sql   # ⚠️ P0-A 이슈 지점
│   ├── nginx/           # 리버스 프록시 설정
│   └── api, admin, editor, worker/  # 각 앱 Dockerfile
├── test-php/            # 외부 쇼핑몰 연동 검증용 PHP 하네스
├── .cursor/plans/       # 이 가이드 포함 모든 인수 문서
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── CLAUDE.md            # Claude Code 프로젝트 지침
```

### 4.2 `apps/api` 모듈 맵 (Feature 모듈 13개 + 조건부 1개)

`app.module.ts` 기준 `imports` 배열에 실제 등록되는 Feature 모듈은 **13개** + `BOOKMOA_DB_PASSWORD` 환경변수 설정 시 `BookmoaModule` 1개가 조건부 로드되어 최대 **14개**다. (이 외에 `ConfigModule`, `TypeOrmModule`, `BullModule` 인프라 모듈 3개가 추가로 등록됨)

Feature 모듈 등록 목록 (`app.module.ts:73~94`):
`HealthModule, AuthModule, TemplatesModule, LibraryModule, StorageModule, WorkerJobsModule, EditorModule, EditorDesignsModule, EditorContentsModule, ProductsModule, SeedModule, FilesModule, EditSessionsModule` (+조건부 `BookmoaModule`)

```
src/
├── app.module.ts        # 루트 모듈 (imports 전량 여기)
├── main.ts              # 부트스트랩 (글로벌 prefix /api)
├── auth/                # JWT 로그인, shop-session 쿠키 — 전역 JwtAuthGuard 등록 (auth.module.ts:42 APP_GUARD)
├── bookmoa/             # 북모아 쇼핑몰 read-only 연결 (조건부 로드)
├── bookmoa-entities/    # 북모아 DB 엔티티 (외부 3개, 모듈 아님)
├── common/              # 공통 필터 (PayloadTooLargeFilter 등록)
├── database/seeds/      # 초기 데이터 (SeedModule)
├── edit-sessions/       # 편집 세션 CRUD
├── editor/              # 에디터 지원 API
├── editor-contents/     # 편집 콘텐츠
├── editor-designs/      # 디자인
├── files/               # 파일 메타
├── health/              # 헬스체크
├── library/             # 라이브러리 (폰트/배경/클립아트)
├── products/            # 상품-템플릿 매핑
├── storage/             # 파일 업로드/다운로드
├── templates/           # 템플릿셋, 템플릿, 상품-템플릿 매핑
├── webhook/             # 외부 웹훅 전송 (WorkerJobs 등에서 주입 사용, 최상위 모듈 import는 아님)
└── worker-jobs/         # 워커 작업 생성/조회
```

> **주의**: `webhook/` 디렉터리는 `WebhookModule`이 있지만 `app.module.ts`의 imports에 직접 나열되지 않는다. `WorkerJobsModule` 등 사용처 모듈에서 import해서 쓰는 구조다. 따라서 "20개 모듈"로 세던 기존 표현은 부정확하며, 위 목록이 실제 상태다.

**새 API 추가하는 법**: 기존 `apps/api/src/templates/` 모듈을 그대로 복사해서 이름만 바꿔 시작. NestJS 표준 패턴 (module/controller/service/entities/dto).

### 4.3 `apps/editor` 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/embed.tsx` | 외부에서 `window.StorigeEditor.create()` 진입점 |
| `src/views/EditorView.tsx` | 메인 편집 뷰. `templateSetId` 있으면 template-set 모드 |
| `src/hooks/useWorkSave.ts` | 저장 로직 (line 666/675에 TODO 남아있음 — §5 참고) |
| `src/stores/*` | Zustand 상태 (canvas, history, ui, ...) |
| `packages/canvas-core/src/Editor.ts` | Fabric.js 래퍼 + 플러그인 등록 |

에디터 플러그인 등록: `apps/editor/src/utils/createCanvas.ts:241~270`에서 `editor.use(...)`를 최대 **19회** 호출한다. 이 중 3개(`spread`, `ruler`, `image`)는 옵션/모드에 따라 조건부 등록이라 실제 로드되는 플러그인 수는 상황에 따라 16~19개다.

플러그인 구현 파일: `packages/canvas-core/src/plugins/` 아래 21개 `*.ts`(테스트 제외). 실사용 목록: `AccessoryPlugin, AlignPlugin, ControlsPlugin, CopyPlugin, DraggingPlugin, EffectPlugin, FilterPlugin, FontPlugin, GroupPlugin, HistoryPlugin, ImageProcessingPlugin, LockPlugin, ObjectPlugin, PreviewPlugin, RulerPlugin, ScreenshotPlugin, ServicePlugin, SmartCodePlugin, SpreadPlugin, TemplatePlugin, WorkspacePlugin`.

새 편집 기능은 기존 플러그인을 모방해서 추가하고, 등록은 반드시 `createCanvas.ts`에서 **순서에 주의** (selection/controls 이후에 배치).

### 4.4 `apps/worker` 큐 3종

| 큐 이름 | Processor 파일 | 하는 일 |
|---------|----------------|---------|
| `pdf-validation` | `processors/validation.processor.ts` | 입력 PDF 검증 (페이지 수, 색 공간 등) |
| `pdf-conversion` | `processors/conversion.processor.ts` | 이미지/PDF 변환 |
| `pdf-synthesis` | `processors/synthesis.processor.ts` | 최종 합본 PDF 생성 |

상세 흐름은 `WORKER_FLOW_전체정리.md`.

### 4.5 DB 엔티티 (⚠️ 26개 중 init.sql엔 10개만)

**엔티티 선언 위치**: `apps/api/src/*/entities/*.entity.ts` (23개) + `apps/api/src/bookmoa-entities/` (외부 3개 read-only)

**현재 `docker/mysql/init.sql`에 있는 10개**:
`categories, edit_sessions, library_backgrounds, library_cliparts, library_fonts, template_set_items, template_sets, templates, users, worker_jobs`

**빠져 있는 주요 테이블 (16개)**:
- `products` (상품), `product_template_mappings` (상품-템플릿)
- `editor_designs`, `editor_contents`, `editor_*`
- `shop_sessions` (쿠키 세션)
- `files`, `file_versions`
- 기타 서브 테이블들

이게 **P0-A 문제**. 개발 환경은 TypeORM `synchronize: true`로 돌아가서 안 보일 수 있지만, 운영에선 치명적.

---

## 5. 현재 상태 스냅샷 (2026-04-16 기준)

### 5.1 반드시 먼저 해결할 것 — P0-A (DB 스키마 불일치) 🔴

**증상**: `docker/mysql/init.sql` = 10개 테이블, 엔티티 = 26개
**영향**: 운영에서 컨테이너 재기동 시 "테이블 없음" 오류
**의사결정**:
1. **[지금 가장 필요한 것]** `P0A_START_HERE_결정가이드.md`를 먼저 읽어 (b) 수동 수정 vs (c) TypeORM 마이그레이션 결정
2. (b) 선택 시 → `P0A_DB_SCHEMA_FIX.md`의 Step A~E 따라서 실행
3. (c) 선택 시 → `apps/api/src/database/migrations/` 디렉토리 생성하고 TypeORM 마이그 구축 (문서 별도 작성 필요)

**작업 후 검증**:
```bash
docker-compose down -v  # 기존 DB 볼륨 날리고
docker-compose up -d mariadb
# 컨테이너 안 들어가서 테이블 수 확인
docker exec -it storige-mariadb mysql -u storige -p storige -e "SHOW TABLES;"
# 26개 나오면 성공
```

### 5.2 P0~P16 우선순위 (HANDOFF_GUIDE.md §2 요약)

| 단계 | 제목 | 상태 | 참고 |
|------|------|------|------|
| P0-A | DB 스키마 일치화 | 🔴 미해결 | §5.1 |
| P0-B | `.env.example` 필수값 표시 | 🟡 부분 | `.env.example` 이미 있음, 필수/선택 구분 추가 필요 |
| P0-C | 워커 API 키 검증 흐름 점검 | 🟡 확인 필요 | `WORKER_API_KEY` |
| P1 | EditSession 완료 API 연동 | 🔴 미해결 | `useWorkSave.ts:666,675` TODO |
| P2 | 썸네일 Sharp 구현 | 🔴 미해결 | `storage.service.ts:163` TODO |
| P3 | 템플릿 사용 여부 확인 | 🔴 미해결 | `template-sets.service.ts:210` TODO |
| P4 | 중철 페이지 순서 구현 | 🔴 미해결 | `pdf-synthesizer.service.ts:259` TODO |
| P5 | PDF 내보내기 엔드포인트 | 🔴 미해결 | `editor.service.ts:700` placeholder |
| P6~P16 | 테스트/로깅/모니터링 등 | 🟡 | `HANDOFF_GUIDE.md` §2 |

### 5.3 코드에 남아있는 TODO (직접 확인됨)

| 파일 | 라인 | 내용 |
|------|------|------|
| `apps/editor/src/hooks/useWorkSave.ts` | 666 | `// TODO: API 연동 (EditSession 완료 엔드포인트)` |
| `apps/editor/src/hooks/useWorkSave.ts` | 675 | `console.log('[useWorkSave:Spread] TODO: EditSession 완료 API 호출')` |
| `apps/api/src/storage/storage.service.ts` | 163 | `// TODO: Implement thumbnail generation using Sharp` |
| `apps/api/src/templates/template-sets.service.ts` | 210 | `// TODO: 상품에서 사용 중인지 확인` |
| `apps/worker/src/services/pdf-synthesizer.service.ts` | 259 | `// TODO: Implement saddle stitch page ordering` |
| `apps/api/src/editor/editor.service.ts` | 693~700 | PDF 내보내기 placeholder (`jobId: 'placeholder-job-id'`) |
| `apps/editor/src/hooks/useEditorContents.ts` | 824 | `// TODO: GraphQL로 콘텐츠 데이터 가져와서 로드` (P6 진입점, HANDOFF §21도 참고) |
| `apps/admin/src/pages/Reviews/ReviewDetail.tsx` | 84, 101 | 승인자 ID 하드코딩 (HANDOFF P3) |

### 5.4 최근 커밋 맥락 (f2680ec ~ db499fa)

최근 5개 커밋은 모두 **스토리지 URL/Vite 빌드 문제 수정**에 집중:
- `f2680ec` — 유령 `vite.config.js` 제거
- `a31a75b`, `9c1dab2` — admin의 `resolveStorageUrl` 개선 (운영 호환)
- `187582b` — 클립아트 업로드/썸네일 로딩 버그
- `db499fa` — 에디터 미사용 UI 정리

즉, **기능 추가보다 운영 환경 맞추기 단계**에 있음.

---

## 6. 개발 흐름 (실제 작업 절차)

### 6.1 새 기능 추가 표준 플로우

```
1. HANDOFF_GUIDE.md에서 해당 기능이 P?에 있는지 확인
2. 관련 도메인의 참고 문서 읽기 (§1.3 빠른 참조 표)
3. 브랜치 생성:   git checkout -b feat/<영역>-<기능>
4. 엔티티/DTO 필요한 경우 먼저 정의
5. API 먼저 (컨트롤러/서비스) → 테스트 → 프론트 연동
6. pnpm --filter @storige/types build (타입 변경 시)
7. pnpm lint && pnpm test
8. 커밋 메시지: feat/fix/refactor/chore/test (conventional commits)
9. PR
```

### 6.2 에디터 기능 추가 (예: 새 도형 도구)

1. `packages/canvas-core/src/plugins/` 기존 `shape.plugin.ts` 복사
2. `Editor.ts`에 등록 (순서 주의 — selection 뒤에)
3. `apps/editor/src/components/toolbar/` UI 추가
4. Zustand 스토어 필요하면 `stores/`에 추가

### 6.3 API 엔드포인트 추가 (예: 새 CRUD 모듈)

1. `apps/api/src/templates/` 전체 디렉토리 복사 → 이름 교체
2. `app.module.ts`에 import 추가
3. `main.ts`의 `/api` prefix 자동 적용됨
4. 엔티티 추가했으면 **`docker/mysql/init.sql`에도 DDL 추가 필수** (P0-A 해결 후)
5. 가드 필요하면 `@UseGuards(JwtAuthGuard)` 또는 `ApiKeyGuard`

### 6.4 워커 잡 추가

1. `apps/worker/src/processors/`에 새 프로세서
2. Bull 큐 이름을 API와 맞추기
3. `apps/api/src/worker-jobs/`에 잡 생성 컨트롤러 추가
4. 웹훅 알림 필요하면 `webhook.service.ts` 호출
5. 상세 패턴은 `WORKER_FLOW_전체정리.md` §3 참고

### 6.5 Admin 기능 추가

1. `apps/admin/src/pages/`에 페이지 추가 (React Query 기반)
2. `apps/admin/src/api/`에 API 호출 래퍼
3. AntD 컴포넌트 우선. 스토리지 URL은 **반드시 `resolveStorageUrl` 거쳐서** (최근 3커밋 교훈)

### 6.6 외부 쇼핑몰 연동 변경 시

반드시 `admin_api_testphp_checklist.md`의 §6 점검 순서로 **로컬에서 검증 후** 운영 반영:

```bash
# 1. Admin에서 매핑 확인
# 2. curl -G 'http://localhost:4000/api/product-template-sets/by-product' ...
# 3. test-php editor.php 접속
# 4. callback.php 결과 확인
# 5. webhook.php logs/results/ 확인
```

---

## 7. 배포 & 운영

### 7.1 배포 옵션

| 방식 | 언제 | 파일 |
|------|------|------|
| Docker Compose | 단일 서버 | `docker-compose.yml` |
| PM2 | Node 직접 | `ecosystem.config.js` |
| Vercel | editor/admin 프론트만 | 프로젝트별 .env.production |

### 7.2 Docker Compose 배포 (기본 경로)

```bash
# 서버에서
git pull
pnpm install
pnpm --filter @storige/types build
docker-compose build
docker-compose up -d

# 로그 추적
docker-compose logs -f api worker
```

### 7.3 환경변수 체크리스트 (`.env`)

운영 배포 전 반드시 교체:
- `JWT_SECRET` — 랜덤 64자 이상
- `DB_PASSWORD` — 기본값 X
- `ADMIN_PASSWORD` — 초기 운영자
- `WORKER_API_KEY` — 워커 → API 콜백 인증
- `API_BASE_URL` — 외부에서 보는 API URL
- `API_KEYS` — 외부 쇼핑몰 연동 키(들)

### 7.4 운영 시 꼭 보는 로그

```bash
docker-compose logs -f api       # REST 요청, 가드 실패
docker-compose logs -f worker    # Bull 큐, PDF 처리
docker exec -it storige-redis redis-cli LLEN bull:pdf-synthesis:wait  # 적체
```

### 7.5 백업

| 대상 | 위치 | 빈도 |
|------|------|------|
| MariaDB | Docker 볼륨 `storige_mariadb_data` | 매일 |
| 업로드 파일 | Docker 볼륨 `storige_storage` (`/app/storage`) | 매일 |
| Redis (큐 상태) | 볼륨 있어도 소실 가능 | 없음 (재시작 시 재처리) |

---

## 8. 장애 대응 & FAQ

### 8.1 빠른 장애 분류표 (`HANDOFF_GUIDE.md` §10 + 본 문서 통합)

| 증상 | 첫 번째로 볼 것 | 원인 후보 |
|------|----------------|-----------|
| 컨테이너 기동 직후 "테이블 없음" | `docker exec ... SHOW TABLES` | **P0-A** (§5.1) |
| Admin에서 템플릿셋 저장 500 | API 로그 | 엔티티와 DB 컬럼 불일치 |
| 에디터가 템플릿 못 불러옴 | `templateSetId` 값 | 쿼리 키 오타, 매핑 비활성 |
| 편집 완료 후 sessionId 빈 값 | `useWorkSave.ts:675` TODO | **P1 미구현** |
| 썸네일 안 나옴 | `storage.service.ts:163` | **P2 미구현** |
| 외부 쇼핑몰 `by-product` 빈 배열 | `sortcode`, `stanSeqno`, `X-API-Key` | 매핑 없음 또는 키 틀림 |
| PHP 로그인 실패 | `test-php/php/config.php` | 테스트 계정 문제 |
| 웹훅 파일 안 생김 | `callbackUrl` 도달성 | `webhook.php` 접근 불가 |
| 운영에서만 스토리지 URL 404 | admin `resolveStorageUrl` | 최근 3커밋 참고 |

### 8.2 자주 묻는 것

**Q. `pnpm dev`가 types를 못 찾아요**
A. `pnpm --filter @storige/types build` 먼저.

**Q. Docker 빌드가 node-canvas/ghostscript에서 실패해요**
A. `docker/worker/Dockerfile`의 apt 의존성 확인. 빌드 환경이 Apple Silicon이면 `--platform linux/amd64` 명시.

**Q. `.env`와 Vercel 환경변수가 따로 놀아요**
A. `storige-admin .env.production`이 Vercel 값을 override하는 구조. 커밋 `012e1e9`, `f2bab8d` 참고.

**Q. `synchronize: true` 이대로 두면 안 돼요?**
A. 개발은 편하지만 운영에선 반드시 false로 전환 후 마이그레이션 체제로 가야 함. P0-A 해결과 같이 진행.

---

## 9. 다음 작업 추천 순서 (Roadmap)

내가 **오늘 바로 시작할 수 있는 순서**:

```
Day 1: P0-A 해결
  1. P0A_START_HERE_결정가이드.md 읽고 (b) or (c) 선택
  2. (b) 선택 시: P0A_DB_SCHEMA_FIX.md Step A~E
  3. docker-compose down -v && up -d로 검증
  4. 커밋: fix(db): init.sql과 엔티티 26개 일치화

Day 2~3: P1 (EditSession 완료 연동)
  5. useWorkSave.ts:666 TODO 해결
  6. 에디터 → API → Bull 큐까지 실제 플로우 테스트
  7. test-php callback.php에서 sessionId 수신 확인

Day 4: P2 (썸네일)
  8. storage.service.ts:163의 Sharp 구현
  9. 어드민 썸네일 갤러리에서 실제 이미지 나오는지 확인

Day 5: P3~P5
  10. 템플릿 사용 여부 체크 / 중철 페이지 순서 / PDF 내보내기

Week 2+: P6 이후 (테스트/모니터링/문서 보완)
```

---

## 10. 이 문서를 갱신하는 법

이 가이드는 **인덱스**다. 내용은 각 하위 문서에 유지하고, 이 문서는 *어느 문서를 읽어야 하는지*만 관리한다.

- 새 문서 추가 → §1.1 표 + §1.2 관계도 업데이트
- P0-A 같은 이슈 해결 → §5.1, §5.2 체크박스 갱신 + 작업 후기 1줄 추가
- TODO 제거 → §5.3 표에서 해당 줄 지우기
- 기준 시점/커밋 해시 → 문서 최상단 업데이트

> **원칙**: 내용 중복 금지. 이 문서에서 설명이 길어지면 별도 파일로 분리하고 여기선 링크만.

---

## 부록 A. 한 줄 치트시트

```bash
# 개발 기동
pnpm install && pnpm --filter @storige/types build && docker-compose up -d mariadb redis && pnpm dev

# 테이블 수 확인
docker exec -it storige-mariadb mysql -u storige -p storige -e "SHOW TABLES" | wc -l

# 큐 적체 확인
docker exec -it storige-redis redis-cli LLEN bull:pdf-synthesis:wait

# 전체 배포
git pull && pnpm install && pnpm --filter @storige/types build && docker-compose up -d --build

# 로그
docker-compose logs -f api worker
```

## 부록 B. 파일-라인 레퍼런스 (실제 코드 진입점)

- 에디터 임베드: `apps/editor/src/embed.tsx:1`
- 편집 저장: `apps/editor/src/hooks/useWorkSave.ts:666`
- API 부트스트랩: `apps/api/src/main.ts:1`
- JWT 가드: `apps/api/src/auth/jwt.guard.ts`
- 워커 큐 처리: `apps/worker/src/processors/synthesis.processor.ts`
- 스토리지 URL: `apps/admin/src/utils/resolveStorageUrl.ts` (최근 3커밋 핵심)
- DB init: `docker/mysql/init.sql` (**P0-A**)
- 외부 샘플: `.cursor/plans/admin_api_testphp_sample.php`

---

**이 문서 마지막 업데이트**: 2026-04-16, 커밋 `f2680ec`
**작성**: Claude Code (이 세션)
**다음 작성자에게**: §10의 갱신 원칙만 지키면 이 문서가 썩지 않는다. 궁금하면 §1.3의 빠른 참조 표를 먼저 보고, 거기서 가리키는 문서를 읽어라. 이 문서에서 내용이 늘어지면 분리해라.
