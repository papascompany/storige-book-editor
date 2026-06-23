# 멀티테넌시 P1+P2a — 통합 배포 런북 (게이트 · 오너 실행)

> 작성 2026-06-17 · 커밋 P1=`5945570`, P2a=`8d9c13b` · **준비+게이트** 모드: 코드/마이그/검증은 완료,
> **프로덕션 적용은 오너가 점검 윈도우에 아래 절차로 실행**.
> 성격: **비파괴·ADDITIVE·외부영향 0**. P1=admin 인증 확장(외부 무변경), P2a=콘텐츠/소유 리소스에
> site_id 컬럼 추가(전부 NULL=시스템공유/레거시 → 동작 불변). **둘 다 미실행 상태로도 무중단.**
> ⚠️ 실제 조회 격리(운영자가 자기 것만 보기)는 **P2b(QueryScope 라우터 적용)** 에서 활성화 — 별도 사이클.
> 권고 순서: **이 게이트(P1+P2a) 실행 → 검증 → bookmoa 무중단 확인 → P2b 진행.**

## 0. 변경 요약 (무엇이 바뀌나)
- 🔑 **admin 비밀번호 변경 기능**(commit `81edae2`, 게이트와 무관한 P0급 핫픽스지만 **같은 API 재배포에 동승**):
  신규 `@Patch('/auth/change-password')`(JwtAuthGuard 보호). admin UI 프로필 페이지는 **Vercel 자동배포로 이미 반영**되나,
  **API 엔드포인트는 이 게이트의 API 재배포(§3) 후에야 동작**(그 전엔 404). 비파괴 additive.
- `UserRole` 에 `SITE_ADMIN`/`SITE_MANAGER` 추가, `SiteRoleClaim` 타입(types).
- 신규 테이블 `user_site_roles`(user_id+site_id+role, CHECK role∈{SITE_ADMIN,SITE_MANAGER}).
- `login()/refreshToken()` JWT 에 `siteRoles` 클레임 추가(있을 때만 — 기존 토큰 무영향).
- `RolesGuard`: SUPER_ADMIN 전역 통과(현재 SUPER_ADMIN 계정 없음 → 무영향).
- 신규 `TenantGuard`·`tenant-scope.helper`(QueryScope) — **정의만, 아직 라우터 미적용**(P3).
- ⚠️ **이번 P1 은 인증 기반만**. admin UI 스코핑·라우터 적용은 P3.

## 1. 선결 (필수)
```bash
# (a) 전체 백업 (DB+storage+.env)
ssh deploy@158.247.235.202 ~/backup.sh

# (b) 마이그레이션 dry-run 검토 — 신규 테이블 생성뿐(기존 테이블 ALTER 없음)
cat ~/storige/apps/api/migrations/20260617_add_user_site_roles.sql
```

## 2. 마이그레이션 실행 (additive)
```bash
# 최신 코드 pull
ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master'

# (P1) user_site_roles 신규 테이블 (lock 위험 없음)
ssh deploy@158.247.235.202 'cd ~/storige && source .env && \
  docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
  < apps/api/migrations/20260617_add_user_site_roles.sql'

# (P2a) site_id 컬럼+인덱스 12테이블 (ADD COLUMN=INSTANT, INDEX=INPLACE)
#   ⚠️ files/products 가 대형이면 인덱스 생성 부하 → 트래픽 낮은 시간대 권장.
ssh deploy@158.247.235.202 'cd ~/storige && source .env && \
  docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
  < apps/api/migrations/20260617_b_add_site_id_data_scoping.sql'

# 확인: P1 테이블 + P2a 컬럼
ssh deploy@158.247.235.202 'source ~/storige/.env && docker exec storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige -e "SHOW CREATE TABLE user_site_roles\G SHOW COLUMNS FROM templates LIKE \"site_id\"; SHOW COLUMNS FROM files LIKE \"site_id\";"'
```

## 3. API 재배포 (VPS 수동 — synchronize=false 라 마이그레이션 후 배포 순서 준수)
```bash
ssh deploy@158.247.235.202 'cd ~/storige && docker compose build api && docker compose up -d api'
# ⚠️ nginx 옛 IP 캐싱 502 가능 → 필요 시 nginx 재시작(또는 전체 배포)
ssh deploy@158.247.235.202 'cd ~/storige && docker compose restart nginx'
```

## 4. 검증 (회귀 0 확인 — dual-mode)
```bash
# (a) API health
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool

# (b) 기존 admin 로그인(role=ADMIN) → 토큰 발급 정상(siteRoles 미포함=전역)
curl -s -X POST https://api.papascompany.co.kr/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@storige.com","password":"<ADMIN_PASSWORD>"}' | python3 -m json.tool
#   → accessToken 발급되면 OK. (JWT decode 시 siteRoles 없음 = 전역, 정상)

# (c) admin UI 로그인 → 기존 페이지(Templates/Sites/EditSessions 등) 정상 접근 확인(@Roles(ADMIN) 무영향)

# (d) 외부 X-API-Key(shop-session) 무영향 확인 — bookmoa template-sets 200
curl -s -X POST https://api.papascompany.co.kr/api/auth/shop-session \
  -H 'X-API-Key: <bookmoa editorAuthCode>' -H 'Content-Type: application/json' \
  -d '{"memberSeqno":1,"memberId":"test","memberName":"t"}' -o /dev/null -w '%{http_code}\n'
#   → 200(또는 기존과 동일). site_id 자동 주입 동작 무변경.
```
**합격 기준**: (b)(c)(d) 모두 기존과 동일하게 동작 = 회귀 0.

```bash
# (e) 🔑 비밀번호 변경 엔드포인트 활성 확인 — 무인증 PATCH 는 401(엔드포인트 존재·가드 동작)
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH https://api.papascompany.co.kr/api/auth/change-password \
  -H 'Content-Type: application/json' -d '{"currentPassword":"x","newPassword":"xxxxxxxx"}'
#   → 401 이면 OK(엔드포인트 배포됨+인증가드 동작). 404 면 API 재배포(§3) 미완.
#   이후 admin 프로필 페이지에서 현재→새 비번 변경 → 임시 비번 폐기(rm ~/storige/.admin-password-reset.txt).
```

## 5. 롤백 (문제 시 — additive 라 안전)
```bash
# (P1) 신규 테이블만 제거하면 P1 이전 상태로 완전 복귀(기존 데이터 무손상)
ssh deploy@158.247.235.202 'source ~/storige/.env && docker exec storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige -e "DROP TABLE IF EXISTS user_site_roles;"'
# API 는 직전 이미지로 롤백 (git checkout <직전> && build api && up -d api)
```
**P2a(site_id 컬럼) 롤백** — **권장: 컬럼을 그대로 둠**. 12개 컬럼은 nullable·전부 NULL·미사용이라
직전(P2a 이전) API 이미지로 롤백하면 구 코드가 site_id 를 참조하지 않아 완전히 inert(무해). 별도 DROP 불필요.
완전 스키마 복원이 필요할 때만(선택) 점검 윈도우에 12테이블 DROP:
```bash
# (선택) P2a 컬럼 완전 제거 — 인덱스 동반 삭제됨. 평소엔 불필요.
for T in templates template_sets product_template_sets categories library_categories \
  library_frames library_backgrounds library_cliparts library_shapes library_fonts products files; do
  ssh deploy@158.247.235.202 "source ~/storige/.env && docker exec storige-mariadb mariadb -ustorige -p\"\$DATABASE_PASSWORD\" storige -e \"ALTER TABLE $T DROP COLUMN IF EXISTS site_id;\""
done
```

## 6. 운영 주의 (적대검증 반영)
- ⚠️ **SUPER_ADMIN 계정 생성 신중**: RolesGuard 에서 SUPER_ADMIN 은 모든 @Roles 를 통과. 슈퍼관리자만 부여(현재 admin@storige.com=ADMIN, 무영향).
- ⚠️ **JWT siteRoles 는 발급 시점 스냅샷**: 운영자 권한 회수 시 access token TTL(현 7d) 동안 반영 지연. P3 민감 라우터는 DB `user_site_roles` 재검증 또는 TTL 단축 검토.
- `UserSiteRole.role` 은 DB CHECK 로 SITE_ADMIN/SITE_MANAGER 만(전역역할 주입 차단).

## 7. 다음 단계
- ✅ **P2a 완료**(이 런북에 포함): site_id 컬럼 12테이블 추가(8d9c13b).
- ⏳ **P2b**(다음·회귀주의): 조회 격리 — controller 에서 `getTenantScope(req.user)` → service 에 전달 →
  `applySiteScope(qb, alias, scope, {includeNull})` 적용(template/library=true, product/file=false).
  ⚠️ 외부 계약: `findByProduct`(bookmoa /by-product) 는 `includeNull=true`/전역 fallback 강제(무중단).
  **이 게이트(P1+P2a) 실행·검증 후 진행 권장**(격리가 실제 데이터에서 동작하는지 확인 가능).
- ⏳ P3: admin UI 테넌트 스위처·페이지 스코핑·권한 게이팅·운영자 계정 관리(user_site_roles CRUD + role 입력검증).
- ⏳ P4 편집기 런타임 · P5 워커 공정성 · P6 운영(스토리지 네임스페이스/쿼터).
