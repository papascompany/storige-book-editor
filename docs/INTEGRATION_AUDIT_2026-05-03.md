# 통합 검증 감사 보고서 (2026-05-03)

> **목적**: Admin/Editor/Worker 전 모듈 기능 검증 + 샘플 데이터 등록 시도 결과 분석
> **방법론**: 운영 API에 직접 시드 시도 → DTO 불일치/결함 식별 → 코드베이스 교차 검증
> **결론**: 🔴 **운영 baseline 미흡 + Admin↔API DTO 불일치로 일부 메뉴 작동 불능 + 라이브러리/상품/카테고리 데이터 0건**

---

## 🚨 Executive Summary

운영 환경(`api.papascompany.co.kr`) 데이터 현황:

| 영역 | 운영 상태 | 정상 여부 |
|------|----------|----------|
| Templates | 5개 (1 cover + 4 page) | ⚠️ 최소 시드만 |
| **Template Sets** | **0개** | 🔴 **에디터 작동 불가** |
| **Library 카테고리** | **0~4개 (방금 일부 추가)** | 🔴 **font 타입 미지원** |
| **Library 자산 (fonts/backgrounds/shapes/cliparts/frames)** | **0개 (전 카테고리)** | 🔴 **에디터 비어있음** |
| **Products** | **0개** | 🔴 **상품 관리 작동 불능** |
| Edit Sessions | 0개 | ✅ (사용자 작업물 없음) |
| Worker Jobs | 10개 (대부분 실패) | ⚠️ 옛 데이터 |

**가장 심각한 발견 3건**:
1. 🔴 **Admin Product 관리 메뉴 작동 불능** — Admin UI ↔ API DTO 모델 완전 불일치
2. 🔴 **Library 카테고리 `font` 타입 미지원** — Admin에서 폰트 카테고리 생성 불가
3. 🔴 **운영 베이스라인 데이터 부재** — 실제 사용자가 에디터를 열면 빈 화면

---

## 🔴 Critical 결함 (즉시 수정 필요)

### 결함 #1 — Admin Product 관리 페이지 작동 불능

**원인**: Admin UI와 API의 Product 모델이 완전히 다름.

**Admin UI 가정 모델** (`apps/admin/src/api/products.ts`):
```typescript
{
  id, name, code, categoryId, templateSetId, price,
  isActive, allowCustomSize, createdAt, updatedAt
}
```

**API 실제 모델** (`apps/api/src/products/entities/product.entity.ts`):
```typescript
{
  id, title, productId, description, template (object),
  editorTemplates (array), isActive, allowCustomSize, templateSet
}
```

**증거**:
- 시드 시도 결과 (admin UI 형식 사용):
  ```
  {"message":["property name should not exist","property code should not exist",
   "property categoryId should not exist","property price should not exist",
   "title must be a string"],"error":"Bad Request","statusCode":400}
  ```
- Admin UI에서 "상품 추가" 버튼 누르면 **400 에러** 발생

**영향**:
- Admin "상품 관리" 메뉴 **사실상 사용 불가**
- bookmoa PHP 연동 시 상품 매핑 할 곳이 없음
- 옵션 C (`allowCustomSize`) 토글 적용 불가

**수정 방향**:
- **옵션 A (단기)**: API DTO를 Admin UI 모델로 정렬 (name/code/categoryId/price 추가)
- **옵션 B (중기)**: Admin UI를 API 모델로 정렬 (title/productId 사용)
- **옵션 C (권장)**: 두 모델은 다른 용도임 → Admin UI는 Bookmoa 상품 매핑 (별도 테이블 필요), API의 Product는 templateSet 프리셋 — 명확히 분리

**우선순위**: 🔴 P0 (운영 시작 시 즉시 발견됨)

---

### 결함 #2 — Library 카테고리 `font` 타입 미지원

**원인**: `LibraryCategoryType` enum에 `font` 누락.

**현재**: `apps/api/src/library/entities/category.entity.ts`
```typescript
export type LibraryCategoryType = 'background' | 'shape' | 'frame' | 'clipart';
```

**증거**:
```bash
POST /api/library/categories {"type":"font"}
→ {"message":["type must be one of: background, shape, frame, clipart"]}
```

**영향**:
- Admin "라이브러리 → 폰트" 메뉴에서 카테고리 등록 불가
- 폰트 자산이 카테고리 미할당 상태로만 존재

**수정**:
```typescript
// 한 줄 수정
export type LibraryCategoryType = 'background' | 'shape' | 'frame' | 'clipart' | 'font';
```
+ DTO `IsEnum` 갱신 + 마이그레이션 (기존 enum 컬럼 확장).

**우선순위**: 🔴 P0 (간단한 수정)

---

### 결함 #3 — TemplateSet enum 대소문자 불일치 의심

**API DTO**: `@IsEnum(['book', 'leaflet'])` (소문자)
**Admin UI**: `TemplateSetType.BOOK` 사용 (확인 필요 — string 'book'을 가리키는지)

**증거**:
```bash
POST /api/template-sets {"type":"BOOK"}  # 시드 스크립트 사용
→ {"message":["type must be one of the following values: "],"error":"Bad Request"}
```

(에러 메시지의 enum 값 부분이 빈 문자열인 점도 의심 — enum 형식 깨짐 가능성)

**확인 필요**:
- `packages/types/src/index.ts`의 `TemplateSetType` enum이 string 'book'/'leaflet' 인지
- Admin TemplateSetForm.tsx 동작 검증

**우선순위**: 🟡 P1 (수동 점검)

---

## 🟠 Major 결함 (단기 수정 권장)

### 결함 #4 — Library 자산 0건 (전 카테고리)

**현황**:
- fonts: 0
- backgrounds: 0
- shapes: 0
- cliparts: 0
- frames: 0
- categories: 0~4 (직전 시드로 일부 추가)

**영향**:
- 에디터에서 사이드바 텍스트/이미지/요소/배경/프레임 메뉴 클릭 시 **빈 화면**
- 사용자가 자체 업로드 외에 사용할 자산 없음
- AI 패널의 "추천" 기능도 빈 결과

**수정 방향**:
- 운영 시작 전 **최소 자산 시드** 필요
  - 폰트 5~10개 (한글: Pretendard / 본고딕 / NanumGothic, 영문: Helvetica/Arial)
  - 배경 20~30개 (파스텔/그라디언트/패턴)
  - 도형 50개 (기본 도형 + 화살표 + 말풍선)
  - 프레임 20개
  - 클립아트 100개
- Admin UI에서 일괄 업로드 또는 시드 SQL

**우선순위**: 🟠 P1

---

### 결함 #5 — Template Set 0건

**현황**: `template-sets` API에서 0건 반환.

**영향**:
- Editor 진입 시 `templateSetId` 필수인데 사용 가능한 ID 없음
- Bookmoa 측에서 `templateSetId` 받을 곳 없음

**수정 방향**:
- 운영용 기본 템플릿셋 시드 (적어도 책자/리플렛 각 1~2개)
  - A4 책자 (210x297, 16P, perfect 제본)
  - A5 책자 (148x210, 8P, saddle 제본)
  - A4 리플렛 (3단 접지)

**우선순위**: 🟠 P0 (운영 차단)

---

### 결함 #6 — Product↔TemplateSet 연결 부재

**현황**:
- Products: 0
- TemplateSets: 0
- 연결 매핑 테이블도 비어있음

**영향**:
- Bookmoa PHP에서 상품 ID → templateSet ID 변환 불가
- 옵션 B (`?size=N`) 의 `productId + sizeNo` 조회 불가

**수정 방향**:
- Product DTO 결함 #1 해결 후
- 상품 등록 시 templateSet 자동 연결 또는 별도 매핑 UI

**우선순위**: 🟠 P0 (운영 차단, 결함 #1 종속)

---

## 🟡 Medium 결함 (점검 필요)

### 결함 #7 — 시드 비밀번호 미변경 + 노출

**상황**: `admin@storige.com` / `admin123`이 여전히 작동.

**증거**: 본 검증 중 로그인 성공.

**영향**:
- 깃 히스토리 + 문서 + 채팅에 노출
- 누구나 운영 admin 권한 획득 가능

**수정**:
```sql
-- VPS DB에서 직접 변경
UPDATE users SET password = bcrypt('<강한_비번>') WHERE email = 'admin@storige.com';
```

또는 admin UI에서 비번 변경.

**우선순위**: 🔴 P0 (이전 보고서에서도 지적, 미해결)

---

### 결함 #8 — Worker Job 5건 모두 FAILED 상태 (옛 데이터)

**현황**: 운영 worker_jobs 테이블에 10개 잡 중 보이는 5개 모두 FAILED.

**최신 5건**:
- `6bea80f2` VALIDATE FAILED (2026-05-02) — 본 세션 ENOENT 핫픽스 전
- `330d19a2` SYNTHESIZE FAILED (2026-04-29)
- `93c6beba` SYNTHESIZE FAILED (2026-04-29)
- `89a77e58` VALIDATE FAILED (2026-04-28)
- `8bb8c3c6` SYNTHESIZE FAILED (2026-04-28)

**영향**:
- 큐 모니터 위젯에 "failed: 5"로 표시됨 (Sentry 알람도 발송됐을 가능성)
- 운영 진단 시 노이즈

**수정 방향**:
- 옛 잡 cleanup (created_at < 2026-05-01 AND status = FAILED 삭제)
- 또는 별도 archive 테이블로 이동
- 또는 단순 무시 (실제 사용자 jobs 시작되면 자연 희석)

**우선순위**: 🟢 P2 (운영 영향 없음, 가시성만)

---

### 결함 #9 — 검증되지 않은 영역 (시간 부족)

본 세션에서 **검증을 완료하지 못한** 영역:

| 영역 | 검증 안 된 이유 | 우선순위 |
|------|----------------|---------|
| Editor 캔버스 도구 (텍스트/이미지/도형/배경/프레임) | 로컬 dev 미가동 + 운영에 자산 0건 | P1 |
| Editor 자동 저장/복원/버전 관리 | 위와 동일 | P1 |
| Editor AI 패널 추천/생성 | DSN+Sentry는 OK, AI 모델 호출은 미검증 | P1 |
| Editor 다크모드 / 반응형 | 검증 미완료 | P2 |
| Worker PDF 검증 (15단계 파이프라인) | 운영 PDF 없음, Admin 테스트 페이지 시나리오만 가능 | P1 |
| Worker PDF 합성 (3가지 모드 normal/split/spread) | 동일 | P1 |
| Bookmoa 옵션 A/B/C URL 동작 | PHP 측 적용 미완 | P0 (P0-1 의존) |
| Webhook callback 양방향 (synthesis.completed 등) | PHP 미적용 | P0 (P0-1 의존) |

---

## 🔍 검증된 영역 (정상 동작)

| 영역 | 결과 |
|------|------|
| API health endpoint | ✅ HTTP 200, queues 정상 |
| 보안 패치 A-E (이전 작업) | ✅ smoke test 통과 (401/403) |
| Sentry 운영 추적 | ✅ 활성화 + DSN 작동 (이전 작업) |
| Bull 큐 모니터링 | ✅ 1분 폴링 + Sentry 알람 (이전 작업) |
| Admin 인증 (시드 계정) | ✅ JWT 발급 (단, 비번 노출 결함 #7) |
| 카테고리 일부 등록 (4개) | ✅ font 제외 4개 성공 |

---

## 🛠 수정 우선순위 권장

### 🔴 P0 — 운영 차단 (이번 주 내 처리 필수)

| # | 결함 | 작업량 | 자동화 |
|---|------|--------|--------|
| 1 | Admin Product DTO 불일치 (결함 #1) | 2~4시간 | ⚠️ 설계 결정 필요 |
| 2 | Library `font` 타입 추가 (결함 #2) | 30분 | ✅ |
| 3 | Admin 비번 강제 교체 (결함 #7) | 30분 | ✅ |
| 4 | TemplateSet 운영 시드 (결함 #5) | 1시간 | ✅ |
| 5 | Library 자산 운영 시드 (결함 #4) | 4~8시간 (자산 수집) | ⚠️ 수동 (자산 준비) |

### 🟡 P1 — 단기 (1~2주)

| # | 결함 | 작업량 |
|---|------|--------|
| 6 | TemplateSet enum 정합성 검증 (결함 #3) | 1시간 |
| 7 | Editor 도구 운영 검증 (결함 #9) | 1일 |
| 8 | Worker E2E 시나리오 검증 (결함 #9) | 1일 |
| 9 | Product↔TemplateSet 연결 UI 보강 (결함 #6) | 0.5일 |

### 🟢 P2 — 중기

| # | 결함 | 작업량 |
|---|------|--------|
| 10 | 옛 worker_jobs 정리 (결함 #8) | 30분 |

---

## 📋 즉시 자동화 가능한 패치 묶음

다음 결함들은 **추가 설계 결정 없이 즉시 자동화 가능**:

```bash
# Patch Set #1 — 코드 수정 (1.5시간 내)
✅ #2 Library font 타입 추가 (enum + DTO + migration)
✅ #4 Library 자산 시드 스크립트 작성 (실제 자산은 별도 준비)
✅ #5 TemplateSet 시드 (5개 표준 템플릿셋)
✅ #10 옛 worker_jobs 정리 SQL

# Patch Set #2 — 운영 변경 (30분)
⚠️ #7 Admin 비번 교체 (사용자 결정 필요 — 새 비번 값)

# 결함 #1, #6 — 설계 결정 필요
🔴 #1 Product DTO 정렬 — Admin UI 우선? API 우선? 분리?
   → 사용자/PHP 팀과 결정 후 패치
```

---

## 🚦 권장 다음 액션

### 옵션 A — 핫픽스 패키지 (즉시, 2시간)
1. 결함 #2 (font 타입) 코드 수정 + 마이그레이션
2. 결함 #5 (TemplateSet 시드) 스크립트
3. 결함 #7 (admin 비번) — 사용자가 새 비번 결정 후 실행
4. 결함 #10 cleanup SQL

### 옵션 B — 결함 #1 설계 협의 후 일괄 (1~2일)
- Product DTO를 Admin UI/API 어느 쪽에 맞출지 결정
- 결정 후 패치 + 운영 마이그레이션
- 옵션 A의 작업과 함께 일괄 배포

### 옵션 C — 라이브러리 자산 본격 준비 (별도 사이클, 1~2주)
- 한글 폰트 라이선스 정리 + 업로드
- 배경/도형/프레임/클립아트 100~200개 큐레이션
- Admin 일괄 업로드 UI 또는 시드 스크립트

---

## 📐 요약 매트릭스

```
┌──────────────────────────────────────────────────────────┐
│  운영 시작 가능 여부 평가                                  │
├──────────────────────────────────────────────────────────┤
│  ❌ Bookmoa PHP 통합 가능?  → NO (Product DTO 불일치)      │
│  ❌ 사용자가 에디터 사용 가능?  → NO (TemplateSet/자산 0)  │
│  ❌ Admin이 콘텐츠 등록 가능? → 부분 (상품 작동 불능)      │
│  ✅ 인프라/모니터링 정상?   → YES (Sentry, 큐 모니터)      │
│  ✅ 보안 패치 적용?         → YES (A-E)                   │
└──────────────────────────────────────────────────────────┘

운영 시작 전 처리 필수: 결함 #1, #2, #4, #5, #7
처리 후 시작 가능 여부: ✅ (단, PHP 측 통합도 병행 필요)
```

---

## 🔗 참조 문서

- `USER_IDENTITY_AUDIT_2026-05-03.md` — 사용자 격리 감사 (결함 5건 해결됨)
- `SECURITY_PATCH_PHP_NOTICE_2026-05-03.md` — 보안 패치 PHP 통보
- `SYSTEM_INTEGRATION_OVERVIEW.md` (v2.4) — 시스템 통합 레퍼런스
- 본 보고서 — 통합 검증 감사 (운영 baseline + DTO 결함 9건)

---

## ⏱ 검증 작업 시간 분석 (실제 진행)

| 단계 | 계획 시간 | 실제 결과 |
|------|----------|----------|
| 환경 셋업 | 30분 | ✅ Preview MCP 로드, launch.json 확인 |
| 시드 스크립트 작성 | 1시간 | ✅ `seed-test-data.sh` 작성 |
| 시드 실행 | 30분 | 🔴 다수 결함 발견 (DTO 불일치) |
| 결함 분석 | 1시간 | ✅ 9건 식별 + 코드 교차 검증 |
| Admin UI 검증 | 2시간 | ⏳ 미진행 (시드 실패로 의미 없음) |
| Editor 검증 | 2시간 | ⏳ 미진행 (자산 0건) |
| Worker 검증 | 2시간 | ⏳ 미진행 (PHP 미적용) |
| 보고서 작성 | 1시간 | ✅ 본 문서 |

**총 진행**: 4시간 (계획 9시간) — 운영 데이터 부재로 후속 작업 차단됨

---

## 💡 핵심 인사이트

> **"운영 환경은 인프라는 완성되어 있으나 콘텐츠/데이터 baseline이 거의 없는 상태"**

이전 세션들에서:
- 코드 품질 (lint 0건) ✅
- 모니터링 (Sentry/큐 알람) ✅
- 보안 (Patch A-E) ✅
- 자동화 (Playwright, CI 일부) ✅

이번 세션에서:
- 데이터 baseline ❌
- DTO 정합성 ❌
- 운영 콘텐츠 등록 워크플로우 ❌

**다음 단계는 코드 추가가 아니라 데이터/콘텐츠 준비 + 결함 #1 설계 결정**.
