# P0-2 — 시크릿 히스토리 정화 + 마지막 키 cutover: 준비 완료(게이트 대기)

> 2026-06-23 ⓒ PREP. **실값 절대 미기재.** 전제 핸드오프: `SECRET_ROTATION_HANDOFF_2026-06-15.md`(gitignored).
> 핵심 원칙(핸드오프 인용): **"정화는 노출면 축소일 뿐 — 회전이 본질."** 누출 키는 회전으로 이미 대부분 무력화됨.

---

## 0. 현재 상태 (2026-06-23 실측)

| 항목 | 상태 |
|------|------|
| 현 HEAD 백엔드 시크릿 추적 | ✅ 없음 (`apps/api/.env.production`·`apps/worker/.env.production` = HEAD 미추적, 히스토리만) |
| 현 HEAD 프론트 env | ✅ `apps/admin/.env.production`·`apps/editor/.env.production` 추적되나 **VITE 공개값만**(시크릿 0건) — 누출 아님 |
| storige 단독 시크릿 회전 (§1) | ✅ 완료·검증 (JWT/DB/root/worker/admin/grafana) |
| bookmoa-mobile 키 cutover | ✅ 완료 (site `26183a7c` inactive, 신 `b5aef7a9` active) |
| **bookmoa PHP 키 cutover** | 🔴 **미완 — 구 키(site `1391c5b4` 북모아 메인) 여전히 active = 마지막 활성 누출 자격증명**. 신 키 `dc81d27f` 발급·active(additive 무중단) |
| git 히스토리 백엔드 env 블롭 | ⚠️ 존재 (19 커밋이 `.env*` 터치; 백엔드 `.env.production`/`.env.development`/`.bak` 가 과거 추가됨) |

---

## 🚦 게이트 A — bookmoa PHP 키 cutover  ⏸️ **보류 (2026-06-23, bookmoa PHP 연동 당분간 보류)**

> **상태 변경(2026-06-23):** bookmoa PHP 쇼핑몰 **연동 자체가 당분간 보류** → 키 cutover 도 보류.
> 연동 재개 시점에 본 게이트를 재개한다. 그 전까지 아래 절차는 **대기**.

**⚠️ 보류 중 수용되는 잔여 보안 노출(반드시 인지):**
- 구 키(site `1391c5b4` 북모아 메인)는 **PUBLIC git 히스토리에 노출된 상태로 active 유지**됨 = 악용 가능한 활성 자격증명이 남아있음.
- **판단 필요**: bookmoa PHP 쇼핑몰이 *현재 운영 중이고 구 키를 실제 사용*하면 → 비활성화 시 장애 → 보류 유지 불가피.
  *연동 보류 = PHP 가 storige 를 호출하지 않는 상태*라면 → **구 키를 지금 비활성화해도 무중단**이고 노출을 즉시 제거 가능(권장).
  → 연동 보류의 의미(PHP 쇼핑몰 storige 호출 여부)를 확인 후 결정. 현재는 **무장애 우선으로 active 유지**.
- 신 키(`dc81d27f`)는 이미 발급·active(additive). 연동 재개 시 PHP 가 신 키 채택 → 그때 구 키 비활성.

**연동 재개 시 절차(보존):**
1. 신 키(`dc81d27f-…`, 안전 채널)로 PHP 설정 교체·배포 **회신 확인**. 지시문 `STORIGE_KEY_SWAP_bookmoa-PHP_2026-06-15.md`.
2. 확인 후 트리거(1줄):
```sql
UPDATE sites SET status='inactive' WHERE id='1391c5b4-5055-42f3-8e86-aff3b31ca528';
```
3. 사후 검증: 구 키 `POST /auth/shop-session` → **401**, 신 키 → **200**, PHP 임베드 진입 정상.

> ⚠️ PHP 가 구 키를 쓰는 중이면 교체 확인 **전** 비활성화 금지 = 북모아 메인 즉시 장애.

---

## 🚦 게이트 B — git 히스토리 정화 + force-push (비가역, 오너 승인)

전제: 게이트 A 완료(모든 누출 키 회전·폐기) + **오너 force-push 승인**. 정화는 방어심층(노출면 축소)일 뿐.

**정화 대상(히스토리 전체에서 블롭 제거):**
```
apps/api/.env.production   apps/api/.env.development   apps/api/.env.development.bak
apps/worker/.env.production   apps/worker/.env.development
(+ 안전상 모든 백엔드 .env.production/.development 블롭. 프론트 VITE 공개값은 무해하나 동반 제거 무방)
```

**실행 절차(미러 클론에서, 원본 보존):**
```bash
# 0) 사전: 전체 백업 + 모든 PR/브랜치 머지·정리(정화는 모든 SHA 재작성)
git clone --mirror https://github.com/papascompany/storige-book-editor.git purge.git
cd purge.git
# 1) filter-repo 로 대상 블롭 제거 (git-filter-repo 설치 필요: pip install git-filter-repo)
git filter-repo --invert-paths \
  --path apps/api/.env.production --path apps/api/.env.development --path apps/api/.env.development.bak \
  --path apps/worker/.env.production --path apps/worker/.env.development \
  --path-glob '*.env.production' --path-glob '*.env.development'
# 2) 검증: 히스토리에서 시크릿 패턴 0건
git log --all -p | grep -ciE 'sk-storige|JWT_SECRET=.+|DATABASE_PASSWORD=.+' # = 0 이어야
# 3) force-push (⚠️ 비가역 — 모든 협업자 재클론 필요)
git push --force --mirror
```
**사후 필수:**
1. **VPS 재동기화**: `~/storige` 는 옛 히스토리 → `git fetch origin && git reset --hard origin/master`(로컬 .env 는 untracked 라 보존되나 사전 백업 권장).
2. **모든 협업자/CI 재클론** (옛 SHA 기반 작업 폐기).
3. **GitHub Support 티켓**: force-push 후에도 GitHub 는 옛 commit 을 SHA 직접 접근으로 캐싱 → 캐시 제거 요청.
4. Vercel(admin/editor)·VPS 빌드 = 새 HEAD 기준 재배포 1회.

> 회전이 끝났으면 정화는 *긴급하지 않음*. 협업/CI 영향이 크니 한가한 시점에 일괄 수행 권장.

---

## 🧹 사후 정리 (게이트 A·B 후)
- VPS `~/storige/.rotated-secrets-2026-06-15.txt`·`rotate_*.sh`·`.env.pre-rotation*` 안전 보관 후 삭제.
- 회전 후 오너 GitHub/SSH 비번 교체 권장.

## ✅ 정정 (이 PREP 중 발견)
- 핸드오프 §5 "WEBHOOK_SECRET 코드 미사용(no-op)" = **stale**. d441802 로 사용됨 + 2026-06-23 ⓓ 에서 컨테이너 미주입 적발·수정(HMAC 활성). HMAC-SHA256 보강 권장도 WH-001 로 완료.
