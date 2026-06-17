# 다음 개발 이슈 정리 (2026-06-17 기준)

> **작성일**: 2026-06-17
> **이전 사이클 결과**: 멀티테넌시 **P1(인증/테넌트 기반) + P2a(site_id 데이터모델)** 프로덕션 배포·전수검증 회귀 0 + admin 비번변경 기능 LIVE + 배포 파이프라인(Vercel ignoreCommand) 복구
> **기준 문서**: `.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md` (설계 정본), `.cursor/plans/MULTITENANCY_P1_DEPLOY_RUNBOOK_2026-06-17.md` (런북), 이전 `NEXT_ISSUES_2026-05-03.md` (포맷 참고)

---

## 🟢 이번 사이클까지 완료된 항목 (LIVE)

| 트랙 | 커밋 | 상태 |
|------|------|------|
| 멀티테넌시 P1 — 인증/테넌트 기반 (types·UserSiteRole·JWT siteRoles 클레임·RolesGuard·TenantGuard·tenant-scope.helper) | `5945570` | ✅ LIVE (정의만, 라우터 적용은 P3) |
| 멀티테넌시 P2a — `site_id` VARCHAR(36) NULL 12테이블 + 인덱스 | `8d9c13b` | ✅ LIVE (전부 nullable·additive, NULL=시스템공유) |
| P2a 마이그레이션 멱등성 (`IF NOT EXISTS`) | `8a193ff` | ✅ LIVE |
| admin 로그인 핫픽스 (401 시 `//login` 리다이렉트 오류 수정) | `59c660a` | ✅ LIVE |
| admin 비밀번호 변경 기능 (Profile 페이지 + `PATCH /auth/change-password`) | `81edae2` | ✅ LIVE |
| admin/editor `vercel.json` ignoreCommand 견고화 (배포 파이프라인 복구) | `640e3e6` | ✅ LIVE |

> **핵심 상태**: P1+P2a는 LIVE이나 **격리는 아직 비활성**. `site_id` 전부 NULL(시스템공유), 실제 조회 격리(P2b)는 미착수 → 현재 모든 데이터가 종전처럼 전역 노출(동작 불변, 비파괴, bookmoa 무중단).

---

## 🟡 멀티테넌시 잔여 (P2b ~ P6)

> **권고 순서**: **P2b → P3 → (P4 편집기런타임 / P5 워커공정성 / P6 운영)**
> P2b(조회격리) + P3(admin UI)가 멀티테넌시 가치 실현의 임계 경로. P4/P5/P6은 P2b·P3 완료 후 병렬 가능.

---

### P2b — 조회 격리 (QueryScope 라우터 적용)
- **우선순위**: **[P0]** (멀티테넌시 임계 경로 1순위)
- **목표**: P1에서 정의만 해둔 `tenant-scope.helper`(QueryScope)를 실제 컨트롤러/서비스 조회 경로에 배선하여, 사이트별 데이터 격리를 **활성화**.
- **핵심 작업**:
  - 컨트롤러: `getTenantScope(req.user)` → 서비스에 scope 전달.
  - 서비스: `applySiteScope(qb, alias, scope, { includeNull })` 를 QueryBuilder에 적용.
  - **includeNull 정책 (회귀 핵심)**:
    - `template` / `library`(categories·frames·backgrounds·cliparts·shapes·fonts) = `includeNull: true` (시스템공유 자산은 모든 사이트에 노출).
    - `product` / `file` = `includeNull: false` (사이트 전용).
  - **⚠️ findByProduct (bookmoa `/by-product`) 특례**: `includeNull: true` + **전역 fallback 강제**. bookmoa 무중단을 위해 site 스코프가 없거나 매칭 실패 시 전역 조회로 폴백해야 함.
- **위험**: **[위험 — 회귀 高]**
  - `includeNull` 오설정 시 자산이 사라지거나(편집기 빈 패널) 교차 노출됨.
  - `findByProduct` 폴백 누락 시 **bookmoa 메인 주문 화면 데이터 소실** → 운영 장애.
  - 모든 site_id가 현재 NULL이므로 스코프 적용 후에도 NULL row가 정상 노출되는지(includeNull true 경로) 회귀 테스트 필수.
- **마이그/외부영향**: 마이그레이션 없음(컬럼은 P2a에서 완료). 외부영향 = bookmoa `/by-product` 경로 직접 영향 → **반드시 전역 fallback 검증 후 배포**.
- **의존성**: P1(helper 정의), P2a(site_id 컬럼) — **둘 다 완료**. 즉시 착수 가능.
- **권고**:
  1. read 경로별 includeNull 매트릭스를 코드 주석/표로 먼저 고정.
  2. `findByProduct` 폴백을 단위/통합 테스트로 못박기.
  3. 배포 전 4렌즈 적대검증 + 활성 사이트 7곳 shop-session 200 회귀(P1 배포 시 검증 패턴 재사용).
  4. site_id 전부 NULL 상태에서 먼저 배포 → 동작 불변 확인 → 이후 일부 데이터에 site_id 채워 격리 실증.

---

### P3 — admin UI 멀티테넌시
- **우선순위**: **[P1]** (P2b 직후, 운영자 자율 관리 진입점)
- **목표**: admin 대시보드에 테넌트 개념을 노출. SUPER_ADMIN은 전체, SITE_ADMIN/SITE_MANAGER는 자기 사이트만 관리.
- **핵심 작업**:
  - 테넌트 스위처(상단 사이트 선택) + 각 페이지 목록/생성 스코핑.
  - 권한 게이팅(ROLE_PERMISSIONS 기반 UI 노출/숨김).
  - 운영자 계정 CRUD: `user_site_roles` 관리(사이트별 role 부여/회수), **role 입력 검증**(허용 enum만).
- **위험**: **[위험 — 中]**
  - admin은 Vercel 자동배포 + axios 핫픽스/Profile UI가 최근에야 LIVE → **배포 state 모니터링 필수**(아래 운영 항목 참조).
  - 권한 게이팅 누락 시 SITE_MANAGER가 타 사이트 데이터 조작 가능 → P2b의 서버측 스코프가 최종 방어선이어야 함(UI 게이팅만 믿지 말 것).
- **마이그/외부영향**: 마이그레이션 없음(user_site_roles는 P1에서 생성). 외부영향 없음(admin 내부).
- **의존성**: **P2b 완료 후** 착수 권고(서버측 스코프가 있어야 UI 스코핑이 의미를 가짐). 단, 운영자 계정 CRUD/테넌트 스위처 골격은 P2b와 일부 병렬 가능.
- **권고**: 서버 권한 검증(RolesGuard/TenantGuard 라우터 적용)을 UI보다 먼저/동시에. role 입력은 서버에서도 화이트리스트 검증.

---

### P4 — 편집기 런타임 Site 메타 적용
- **우선순위**: **[P2]**
- **목표**: 편집기가 사이트별 메타(단위·CSS·버전·라이브러리 필터)를 런타임에 반영.
- **핵심 작업**:
  - 단위 `mm` 하드코딩 제거 → Site 메타에서 단위 주입.
  - `editorCss` 사이트별 주입.
  - 버전 핀(사이트별 편집기 버전 고정).
  - 라이브러리 패널을 site 필터로 스코핑(P2b 서버 스코프와 정합).
- **위험**: **[위험 — 中]**
  - 좌표/단위 규약 회귀 주의(중앙원점@150dpi 규약, `COORDINATE_SYSTEM.md` 준수). 단위 하드코딩 제거가 PDF/반응형 좌표에 파급될 수 있음.
  - 라이브러리 site 필터가 P2b includeNull(시스템공유) 정책과 어긋나면 빈 패널 재발(과거 라이브러리 빈 패널 3버그 전례).
- **마이그/외부영향**: 마이그레이션 없음. 외부영향 = 임베드 외부사이트의 편집기 표시 → /embed 경로 회귀 확인.
- **의존성**: **P2b(서버 라이브러리 스코프) + P3(Site 메타 admin 입력)** 후 권고.
- **권고**: P5/P6과 병렬 가능. 단위/좌표 변경은 PDF 출력 육안검증까지 포함.

---

### P5 — 워커 공정성 (큐 site 스코프)
- **우선순위**: **[P2]**
- **목표**: 현재 3개 글로벌 큐(validation/conversion/synthesis)에 site 인지를 추가해 공정성·쿼터·메트릭 확보.
- **핵심 작업**:
  - 큐 페이로드(`job.data`)에 `site_id` 전달.
  - 사이트별 쿼터/우선순위.
  - site별 메트릭(현재 글로벌 큐는 공정성 없음 → 한 사이트가 큐 독점 가능).
- **위험**: **[위험 — 低~中]**
  - job.data 스키마 변경 → 워커/API 양측 배포 순서 주의(워커는 VPS 수동 배포). 구 페이로드(site_id 없음) 하위호환 처리 필수.
  - 우선순위/쿼터 도입 시 기존 처리량 회귀 모니터링.
- **마이그/외부영향**: 마이그레이션 없음(또는 메트릭 테이블 추가 시 additive). 외부영향 = 외부 사이트의 PDF 합성/검증 처리 지연 가능 → 쿼터값 보수적으로.
- **의존성**: P2b(site_id 데이터 흐름)에서 job 생성 시 site_id가 채워져야 의미. P4와 독립.
- **권고**: P4/P6과 병렬 가능. job.data에 site_id 기본값(null→전역) 하위호환 우선.

---

### P6 — 운영 (스토리지 네임스페이스·쿼터·nginx 인증)
- **우선순위**: **[P2]**
- **목표**: 파일 저장·접근 계층을 사이트 단위로 격리.
- **핵심 작업**:
  - 파일 `storageKey`에 site 네임스페이스 부여.
  - 사이트별 스토리지 쿼터.
  - nginx `/storage` 인증(교차테넌트 파일 접근 차단).
- **위험**: **[위험 — 中]**
  - nginx `/storage` 인증 추가가 기존 워커/편집기 파일 접근 경로를 끊을 수 있음(워커는 `/storage/*` 직접 접근). 저장계층 R2 추상화(`STORAGE_DRIVER`)와 정합 필요.
  - storageKey 네임스페이스 변경은 **기존 파일 경로 마이그레이션** 위험 → 신규 파일만 네임스페이스, 기존은 유지(비파괴) 권고.
- **마이그/외부영향**: 데이터 마이그레이션 가능성(기존 파일 경로) → 신규 적용·기존 보존 전략으로 회피. 외부영향 = 외부사이트 파일 다운로드 URL.
- **의존성**: P2b(file 스코프, includeNull:false). nginx 변경은 인프라 작업(VPS).
- **권고**: 가장 마지막. nginx 변경 전 워커/편집기 파일 접근 경로 전수 확인. R2 추상화 경로와 함께 설계.

---

### 멀티테넌시 권고 순서 요약

| 단계 | 트랙 | 우선순위 | 마이그 | 외부영향 | 선행 의존성 |
|------|------|---------|--------|----------|-------------|
| 1 | **P2b 조회격리** | 🔴 P0 | 없음 | bookmoa `/by-product` (전역 fallback 필수) | P1·P2a (완료) |
| 2 | **P3 admin UI** | 🟡 P1 | 없음 | 없음 | P2b |
| 3a | P4 편집기 런타임 | 🟢 P2 | 없음 | /embed 외부사이트 | P2b·P3 |
| 3b | P5 워커 공정성 | 🟢 P2 | (additive) | PDF 처리 지연 | P2b |
| 3c | P6 운영 | 🟢 P2 | (파일경로 주의) | 파일 다운로드 URL | P2b |

---

## 🔵 즉시 / 단기 운영 항목

### O-1. admin 임시 비밀번호 본인 교체 + 임시파일 삭제
- **우선순위**: **[P0]** (사용자 액션)
- **상태**: 2026-06-15 보안회전으로 admin 비번 변경 → 임시 비번으로 재설정됨(VPS `~/storige/.admin-password-reset.txt`, chmod600). 비번변경 UI는 이번 사이클 LIVE.
- **필요 작업**:
  1. admin 로그인(임시 비번) → Profile 페이지 → 비밀번호 변경(현재→본인 비번, 최소 8자·일치검증).
  2. 교체 확인 후 VPS의 `~/storige/.admin-password-reset.txt` **삭제**.
- **위험**: **[위험 — 低]** 임시 비번 파일이 남으면 평문 노출 위험. 교체 직후 삭제.
- **의존성**: 없음. 비번변경 UI는 이미 프로덕션 번들에 반영(LIVE).
- **권고**: 즉시. 평문 비번은 어떤 문서에도 기재 금지.

### O-2. Vercel 배포 state 모니터링 습관화
- **우선순위**: **[P1]** (운영 습관)
- **배경**: admin Vercel 빌드가 마지막 성공 `ba0734013` 이후 **모든 커밋에서 ERROR**였고 라이브가 옛 빌드에 고착됨(P1/P2a는 admin 무관이었으나 axios 핫픽스·Profile UI 미배포). 근본원인 = `vercel.json` ignoreCommand가 얕은 클론에서 PREVIOUS_SHA 부재 시 `fatal: bad object`로 git 비정상종료(128) → 배포 ERROR 자기영속. 수정 `640e3e6`으로 복구.
- **필요 작업**: master push 후 admin/editor Vercel 배포 state(READY/ERROR)를 확인하는 습관. ERROR면 빌드 로그 확인.
  - `vercel inspect <deployment-url>` 또는 Vercel MCP(`get_deployment` / `list_deployments`).
- **위험**: **[위험 — 中]** 침묵 실패 시 프론트가 옛 빌드에 장기 고착(이번처럼 핫픽스/기능이 라이브에 미반영).
- **의존성**: 없음. `640e3e6`으로 자기영속 ERROR 루프는 해소됨.
- **권고**: 배포 후 1회 state 확인을 루틴화. (선택) `/schedule` 또는 알림으로 ERROR 감지 자동화.

---

## 🟣 오너 대기 (외부 조율 — storige 단독 진행 불가)

> 모두 외부 측 작업 또는 비가역 게이트. storige 측 준비는 완료, 오너 트리거 대기.

### W-1. 북모아 메인(PHP) 키 cutover — **마지막 외부 cutover**
- **우선순위**: **[P1]** (오너 트리거)
- **상태**: 2026-06-15 보안회전으로 신 키 additive 발급(무중단). bookmoa-mobile·ShareSnap·100p Books 등은 cutover 완료, **북모아 메인(PHP, site `1391c5b4`)만 남음**.
- **필요 작업**: 북모아 PHP 측이 신 키 반영 확인 → cutover 명령 실행(구 누출키 폐기/inactive).
- **위험**: **[위험 — 中]** cutover 전까지 구 누출키가 active 유지(무중단 우선). PHP 측 미반영 상태에서 폐기하면 북모아 메인 주문 장애.
- **의존성**: 북모아 PHP 팀. 핸드오프: `.cursor/plans/SECRET_ROTATION_HANDOFF_2026-06-15.md`.
- **권고**: 평문 키는 안전 채널로만 전달, 문서 기재 금지. PHP 반영 확인 후에만 cutover.

### W-2. 깃 히스토리 정화 force-push 게이트
- **우선순위**: **[P1]** (오너 승인 비가역)
- **상태**: PUBLIC 레포 히스토리에 과거 시크릿 누출 → 정화 스크립트 준비됨. force-push는 비가역이라 게이트.
- **위험**: **[위험 — 高(비가역)]** force-push 후 협업자 클론/CI/외부 참조 깨질 수 있음. 누출 시크릿은 이미 회전됐으므로 정화는 위생 목적.
- **의존성**: 오너 승인 + 협업자 사전 공지.
- **권고**: 외부 키 cutover(W-1) 완료 후 실행 권장(구 키가 히스토리에서 사라져도 이미 inactive여야 안전). 실행 타이밍·백업 확인 필수.

### W-3. bookmoa DB 자격증명 회전
- **우선순위**: **[P1]** (북모아 측 작업)
- **상태**: bookmoa DB 자격증명은 북모아 측에서 회전 필요 → 요청문 준비됨: `.cursor/plans/BOOKMOA_DB_ROTATION_REQUEST_2026-06-15.md`.
- **위험**: **[위험 — 中]** 미회전 시 누출 자격 잔존.
- **의존성**: 북모아 운영팀.
- **권고**: 요청문 전달 후 회전 일정 협의.

---

## ⚙️ 별도 트랙 (멀티테넌시와 독립)

### T-1. 고객 PDF 업로드 검증 갭 — Tier0
- **우선순위**: **[P1]** (Tier0 즉시 수정)
- **목표**: worker의 고객 PDF 업로드 검증 갭 해소.
- **핵심 작업 (Tier0)**:
  - 폰트 배선 dead code 활성화(폰트 정규식 배선 먼저).
  - 별색(별색/spot color) 노티 누락 보강.
  - 해상도 메시지 불일치 수정.
  - 큐 미병합/이중폴백 버그 수정.
- **위험**: **[위험 — 中]** 워커 변경(VPS 수동 배포) + 큐 폴백 로직 회귀 주의. 모달은 bookmoa-mobile 주문 화면과 연동.
- **마이그/외부영향**: 외부영향 = bookmoa-mobile 주문 화면(검증 모달).
- **의존성**: 워커 단독 진행 가능(멀티테넌시 P5와는 별개, 단 P5 job.data 변경과 충돌 주의).
- **권고**: 멀티테넌시와 병렬 가능한 독립 트랙. 폰트 정규식 배선부터.

### 그 외 알려진 백로그 (참고)
- **WEBHOOK_SECRET 서명 보강**: 현재 서명이 HMAC이 아닌 base64 → 위조 가능. 코드 미사용(no-op)이라 회전 불필요했으나, 사용 시 HMAC 서명으로 보강 권장. **[P2]**
- **내지 PDF 표시전용 재설계 잔여(P1)**: SOFT→HARD 승격 보류(ENV 미주입·데이터 빈약). 래스터=GS 권장, 오너 결정 대기. **[P2]**
- **InDesign→템플릿 변환 오너 결정 3건**: 폰트 시딩(0건)·기본 pageCount·용지코드 매핑. **[P2, 오너 대기]**

---

## 💡 최우선 액션 권장 순서

1. **admin 임시 비번 본인 교체 + 임시파일 삭제** (O-1, 사용자 액션, 즉시)
2. **P2b 조회격리** (멀티테넌시 임계 경로 1순위 — includeNull 매트릭스 고정 + `findByProduct` 전역 fallback 테스트 → 적대검증 → 배포)
3. **P3 admin UI 멀티테넌시** (운영자 자율 관리 — 서버 권한 검증 동반)
4. **(병렬) T-1 고객 PDF 검증 Tier0** (워커 독립 트랙)
5. **P4 / P5 / P6** (P2b·P3 완료 후 병렬)
6. **오너 트리거 시**: W-1 북모아 메인 키 cutover → W-2 히스토리 정화 force-push → W-3 bookmoa DB 회전

---

## 🔗 관련 문서

- `.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md` — 멀티테넌시 설계 정본 (로컬, 커밋 안 함)
- `.cursor/plans/MULTITENANCY_P1_DEPLOY_RUNBOOK_2026-06-17.md` — P1+P2a 통합 런북 (비번변경 검증 §0/§4(e), P2a 롤백 §5)
- `.cursor/plans/SECRET_ROTATION_HANDOFF_2026-06-15.md` — 키 cutover 핸드오프 (W-1)
- `.cursor/plans/BOOKMOA_DB_ROTATION_REQUEST_2026-06-15.md` — bookmoa DB 회전 요청문 (W-3)
- `docs/COORDINATE_SYSTEM.md` — 좌표 규약 (P4 회귀 방지)
- `docs/NEXT_ISSUES_2026-05-03.md` — 이전 이슈 스냅샷 (포맷 참고)
- `CLAUDE.local.md` — 운영 정보 (gitignored, 평문 시크릿 위치만)
</content>
</invoke>
