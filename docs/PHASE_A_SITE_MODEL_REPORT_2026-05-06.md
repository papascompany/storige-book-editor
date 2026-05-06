# Phase A 완료 보고서 — Site/Tenant 모델 도입 (2026-05-06)

> **상태**: ✅ 완료 (운영 배포 + 검증 완료)
> **작업 기준**: [`ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md`](./ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md) Phase A
> **PHP 측 영향**: **0건** — 기존 `STORIGE_API_KEY` 그대로 작동 검증 완료

---

## 1. 변경 요약

### API (`apps/api/src/`)
| 파일 | 변경 |
|------|------|
| `sites/entities/site.entity.ts` | 신규 — Site 엔티티 (name, domain, return_url_base, upload_callback_url, editor_auth_code [unique], worker_auth_code [unique], status) |
| `sites/dto/site.dto.ts` | 신규 — CreateSiteDto / UpdateSiteDto |
| `sites/sites.service.ts` | 신규 — CRUD + `findByEditorAuthCode` / `findByWorkerAuthCode` + `regenerateAuthCodes` + `onModuleInit` 자동 시드 |
| `sites/sites.controller.ts` | 신규 — `/api/sites` (admin only, JWT + RolesGuard) |
| `sites/sites.module.ts` | 신규 — **`@Global()`** (모든 feature module이 SitesService 주입 받을 수 있도록) |
| `auth/strategies/api-key.strategy.ts` | `.env API_KEYS` 단순 비교 → SitesService DB 조회로 전환. `req.user`에 `siteId/siteName/role` 추가 |
| `auth/guards/api-key.guard.ts` | 동일 패턴 — DB 조회로 전환 |
| `auth/decorators/current-site.decorator.ts` | 신규 — `@CurrentSite()` 데코레이터 (컨트롤러에서 site 컨텍스트 추출) |
| `auth/auth.module.ts` | `SitesModule` import 추가 |
| `app.module.ts` | `SitesModule` 등록 |

### Admin (`apps/admin/src/`)
| 파일 | 변경 |
|------|------|
| `pages/Sites/SiteList.tsx` | 신규 — 사이트 CRUD + 인증코드 발급/재발급 모달 + status 토글 |
| `api/sites.ts` | 신규 — sitesApi (list/get/create/update/regenerate/remove) |
| `App.tsx` | 라우트 `/sites` 추가 |
| `components/Layout/MainLayout.tsx` | 사이드바 "기본설정" 메뉴 (대시보드 바로 아래) |

### 문서
| 파일 | 변경 |
|------|------|
| `docs/PHP_INTEGRATION_FINAL_v3.md` | v3.0 → **v3.1** (§2 헤더에 멀티사이트 안내 박스 1단락 + 변경이력 갱신) |
| `docs/PHP_INTEGRATION_FINAL_v3.html` | 동일 + 사이드바/메타칩 v3.1 갱신 + changelog row 추가 |
| `docs/php연동가이드.zip` | 패키지 v3.1로 갱신 |

---

## 2. 운영 배포 검증

### 빌드
- `pnpm --filter @storige/api build` ✅
- `pnpm --filter @storige/admin build` ✅
- Vercel admin 자동 빌드 ✅ Ready (35s duration)

### VPS 배포 (커밋 `99a7397`)
- `docker compose build api && docker compose up -d api` ✅
- 회귀 1건 발견 + 즉시 fix:
  - **회귀**: `Nest can't resolve dependencies of the ApiKeyGuard ... in TemplatesModule context`
  - **원인**: ApiKeyGuard가 여러 feature module에서 사용되는데 SitesModule이 일반 모듈
  - **fix**: `SitesModule`을 `@Global()`로 변경 → 모든 모듈 scope 자동 가용

### 운영 마이그레이션 (수동 SQL)
운영은 `synchronize: false`라 entity 변경이 자동 적용 안 됨. 수동 실행:
```sql
CREATE TABLE IF NOT EXISTS sites (
  id varchar(36) NOT NULL,
  name varchar(100) NOT NULL,
  domain varchar(500) DEFAULT NULL,
  return_url_base varchar(500) DEFAULT NULL,
  upload_callback_url varchar(500) DEFAULT NULL,
  editor_auth_code varchar(200) NOT NULL,
  worker_auth_code varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_sites_editor_auth_code (editor_auth_code),
  UNIQUE KEY idx_sites_worker_auth_code (worker_auth_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 자동 시드 검증
API 재기동 시 `SitesService.onModuleInit()`이 `.env API_KEYS` 값 3개 자동 시드:
```
Seeded Site row for env API key (prefix=7e0f40be…)
Seeded Site row for env API key (prefix=31e2717e…)
Seeded Site row for env API key (prefix=sk-stori…)
SitesService initialized — 3 site(s) registered
```

### DB 시드 결과 (sites 테이블)
| name | status | editor_auth_code (prefix) |
|------|--------|---------------------------|
| 북모아 메인 | active | `sk-storige-l3YVceH0sB7…` |
| Default Site | active | `7e0f40be525867c8610374…` |
| Default Site | active | `31e2717e3d77ef70c329c8…` |

> 첫 행은 admin UI에서 "북모아 메인"으로 이미 rename 완료. 나머지 2개 키는 사용자가 admin에서 의미 있는 이름으로 변경 가능.

### PHP 영향 0 검증 (실 운영 호출)
```
$ curl -X POST https://api.papascompany.co.kr/api/auth/shop-session \
    -H "X-API-Key: sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g" \
    -d '{"memberSeqno":1,"memberId":"test","memberName":"PhaseA"}'
→ accessToken len=285 ✅
```

기존 PHP `STORIGE_API_KEY` 값 그대로 사용 → JWT 발급 정상. **PHP `.env` / 코드 변경 0**.

---

## 3. 사용 흐름 (운영팀 관점)

### 새 사이트 추가
1. admin → **기본설정** 메뉴 → "사이트 등록" 버튼
2. 사이트명/도메인/콜백URL 입력 (인증코드는 자동 생성)
3. 저장 → **모달에 신규 인증코드 자동 표시** (편집기 + 워커)
4. 안전 채널(메신저/메일)로 PHP 팀에 전달
5. 그 사이트 PHP `.env`에 `STORIGE_API_KEY=<값>` 입력 → 즉시 인증 통과

### 키 재발급 (보안 사고)
1. admin → 기본설정 → 해당 사이트 → "키 재발급" 드롭다운
2. 편집기 / 워커 / 양쪽 중 선택
3. 신규 키 자동 발급, 이전 키 즉시 무효
4. 새 키를 PHP 팀에 전달

### 운영 중지
- admin 사이트 행의 "운영중" 토글을 끄면 status=suspended → 해당 키 401 응답

---

## 4. PHP 가이드 v3.1 갱신 (1단락)

`PHP_INTEGRATION_FINAL_v3.md` §2 헤더에 추가:

> **🆕 v3.1 (2026-05-06) — 멀티사이트 안내** (PHP 측 영향 0)
>
> Storige는 2026-05-06부터 단일 시스템에서 여러 외부 사이트(예: 북모아 메인,
> 점보포토, 스튜디오북, Storywork, Printcard studio, MD2Books, 100p Books)의
> 편집기·워커 연동을 동시 지원합니다. 각 사이트는 **고유 인증코드**(편집기용 +
> 워커용)를 발급받아 같은 가이드를 그대로 따릅니다.
>
> **북모아 측 변경 0** — 기존 `STORIGE_API_KEY` 값은 부팅 시 자동으로 DB에
> 마이그레이션돼 그대로 인증 통과합니다. 새 값으로 교체할 필요 없음.
>
> **새 사이트 추가 시** (예: 점보포토): Storige 운영팀이 admin 콘솔에서 사이트
> 등록 → 인증코드 자동 발급 → 안전 채널로 전달 → 그 사이트 PHP `.env`에 입력.
> 코드는 동일.

HTML 가이드도 동일 박스 + 사이드바/메타칩 v3.1 / changelog 추가 완료.

---

## 5. 커밋 history

```
99a7397 fix(phase-a): SitesModule @Global — ApiKeyGuard 의존성 주입 회귀 즉시 해소
3643397 feat(phase-a): Site/Tenant 모델 도입 — 멀티사이트 플랫폼화 기반
```

---

## 6. 후속 사이클 (FUTURE_UPDATES 트래커)

- **Phase B**: SiteWorkerSettings 엔티티 — 사이트별 워커 옵션 (PDF 변환 여부 / Before-After URL / 단위 / 작업서·재단선·안전선 default), 1.5일
- **Phase C**: edit_sessions / worker_jobs 테이블에 `site_id` 외래키 + admin 사이트별 필터, 1.5일
- **Phase D** (선택): 라이브러리 사이트 분리 (private 자산), 1일
- **Phase E** (선택): 카테고리 페이지표기 옵션 + 라이브러리 QR코드, 1일

---

## 7. 알려진 제약

- **TypeORM Migration 자동화 X**: 운영 `synchronize: false`라 entity 변경 시 SQL 수동 실행 필요. 향후 TypeORM Migration 파일 도입 권장 (별도 사이클).
- **외부 사이트 endpoint별 사이트 라벨링은 컨텍스트만 가용**: `req.user.siteId`로 모든 외부 호출에서 사이트 식별 가능하나, 잡 entity에 `site_id` 외래키 추가는 Phase C에서 진행.
- **Sentry/Grafana 사이트별 통계**: 자동 태그 부여 미구현 — Phase B 또는 후속 사이클에서 모든 외부 호출에 자동 태그 인터셉터 추가.
