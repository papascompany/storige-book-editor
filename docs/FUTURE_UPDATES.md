# Storige 향후 업데이트 이슈 트래커

> **작성일**: 2026-05-03
> **목적**: 즉시 차단되지는 않지만 시점이 되면 처리해야 할 인프라/플랫폼 업데이트 이슈를 누적 관리.
> **갱신 정책**: 각 이슈는 발견 시점에 등록하고, 처리 완료 시 ✅ 표시 후 `완료된 항목` 섹션으로 이동.

---

## 🟡 진행 중 / 대기 중

### 1. Node 20 → Node 22 LTS 마이그레이션
- **상태**: ⏳ 대기 (현재 로컬은 22, Docker/Vercel은 20)
- **발견 시점**: 2026-05-03
- **컨텍스트**:
  - 로컬 개발 환경은 이미 Node `22.22.2` LTS 사용 중
  - 운영 환경 (Docker/Vercel)은 Node `20.x` 유지
  - **Node 20 LTS EOL: 2026-04-30** (지난주 만료) — 곧 보안 업데이트 종료
  - **Node 22 LTS EOL: 2027-04-30**
- **임시 조치 (2026-05-03)**:
  - root `package.json` engines를 `"20.x"` → `">=20"` 으로 완화 (커밋 미정 시 갱신)
  - 로컬 Node 22 사용 시 pnpm warning 제거됨
- **마이그레이션 작업 (별도 사이클)**:
  - [ ] `docker/api/Dockerfile`: `FROM node:20-alpine` → `FROM node:22-alpine`
  - [ ] `docker/worker/Dockerfile`: 동일
  - [ ] `docker/editor/Dockerfile`: 동일
  - [ ] `docker/admin/Dockerfile`: 동일
  - [ ] Vercel 프로젝트 설정 (admin/editor): Node Version 20.x → 22.x
  - [ ] CI/CD 환경 (있다면): GH Actions setup-node 22로 변경
  - [ ] native 의존성 재빌드 검증
    - `canvas@2.11.2`: Node 22 prebuild 제공됨 ✅
    - `sharp`: 0.33+ Node 22 prebuild 제공됨 ✅
    - `@sentry/profiling-node`: Alpine에서 native build 실패 → 이미 제거됨 (`f5e22d9`)
  - [ ] 운영 검증: API/Worker 정상 기동, 큐 처리, Webhook 송수신 등
  - [ ] 다운그레이드 롤백 시나리오 작성
- **권장 일정**: 2026-06 ~ 2026-07 (PHP 통합 완료 후)
- **위험도**: 🟡 중 (운영 환경 변경 — 별도 검증 사이클 필요)

---

### 2. (예약) PHP 양측 통합 검증 후 후속 정리
- 상태: ⏳ 대기 (P0-1)
- 핵심: bookmoa PHP 측 코드 적용 + 양측 E2E
- 별도 트래커: `REMAINING_WORK_REVIEW.md` §B

---

### 3. (예약) Admin 비밀번호 강제 교체
- 상태: ❌ 미진행 (P0-2)
- 핵심: 시드값 `admin@storige.com` / `admin123` → 강한 값
- 별도 트래커: `NEXT_DEVELOPMENT_PLAN.md`

---

## ✅ 완료된 항목

(아직 없음 — 본 문서는 2026-05-03 신설)

---

## 📋 등록 가이드

새 이슈 등록 시 다음 형식 사용:

```md
### N. 이슈 제목
- **상태**: ⏳ 대기 / 🟡 진행 중 / ✅ 완료
- **발견 시점**: YYYY-MM-DD
- **컨텍스트**: (배경 설명)
- **임시 조치**: (즉시 적용된 미봉책 — 있을 시)
- **본 작업 (별도 사이클)**: (체크리스트)
- **권장 일정**: (대략적 타임라인)
- **위험도**: 🟢 저 / 🟡 중 / 🔴 고
```

---

## 🔗 관련 문서

- `REMAINING_WORK_REVIEW.md` — 트랙별 잔존 작업 마스터 트래커
- `NEXT_DEVELOPMENT_PLAN.md` — 다음 1~2주 sprint 계획
- `AUTOPILOT_SESSION_2026-05-02.md` — 직전 사이클 결과
- `DEPLOYMENT.md` — 배포 가이드 (Node/Docker 환경 명세 포함)
