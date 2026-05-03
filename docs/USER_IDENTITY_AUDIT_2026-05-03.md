# 사용자 식별 / 주문 추적 메커니즘 감사 보고서

> **작성일**: 2026-05-03
> **목적**: PHP 웹 회원이 파일 업로드 / 편집 / 주문할 때 어떤 키로 식별되는지, 다른 사용자 데이터로부터 격리되는지 검증
> **결론**: ⚠️ **데이터 모델은 정확하지만 권한 검증 누락 4건 + JWT 페이로드 1건이 결함**. 즉시 수정 필요.

---

## 🟢 정상 동작하는 부분

### 1. 데이터 모델 — 사용자/주문 식별자 모두 보유

| Entity | `memberSeqno` | `orderSeqno` | 비고 |
|--------|--------------|--------------|------|
| `EditSessionEntity` | ✅ | ✅ | DB 컬럼 + 인덱스 |
| `FileEntity` | ✅ (nullable) | ✅ (nullable) | 업로드 시 주입 |
| `WorkerJob` | ❌ 직접 컬럼 없음 | ❌ 직접 컬럼 없음 | `editSessionId` FK 통해 간접 추적 |
| `EditSessionVersion` | ❌ | ❌ | `sessionId` FK로 간접 추적 |

### 2. PHP → Storige 호출 시 인증 + 식별자 흐름

```
[PHP 서버]
  └─ POST /api/auth/shop-session
     X-API-Key: {key}
     Body: { memberSeqno, memberId, memberName, phpSessionId }
  ↓
[JWT 발급]
  payload: { sub: memberSeqno, email, name, role: 'customer', source: 'shop' }
  ↓
[브라우저 (editor)]
  Authorization: Bearer {JWT} 으로 모든 요청
  ↓
[Editor URL 파라미터]
  ?token={JWT}&orderSeqno={N}&templateSetId={UUID}&sessionId={UUID, 재편집 시}
  ↓
[EditSession 생성/조회]
  - sessionId 있으면: 기존 세션 로드
  - 없으면: orderSeqno로 검색 → 없으면 새로 생성
  - JWT.sub → memberSeqno 자동 주입
```

### 3. Editor → API 호출 흐름 (✅ 정상)

`apps/editor/src/embed.tsx`:
```ts
// 1. sessionId 우선
if (sessionId) editSession = await editSessionsApi.get(sessionId)
// 2. orderSeqno fallback
else if (orderSeqno) {
  const { sessions } = await editSessionsApi.findByOrder(orderSeqno)
  editSession = sessions.find(s => s.canvasData) || sessions[0]
}
// 3. 신규 생성
if (!editSession) editSession = await editSessionsApi.create({ orderSeqno, ... })
```

### 4. Worker Job → EditSession 연결 (✅ 정상)

- `editSessionId` FK로 잡과 세션 연결
- 세션의 `memberSeqno` + `orderSeqno`를 통해 누구의 잡인지 추적 가능
- 합성 잡 webhook payload에 `orderSeqno` 포함 (line 1012)

---

## 🔴 발견된 결함 (즉시 수정 필요)

### 결함 #1 — `GET /api/edit-sessions/:id` 권한 검증 없음 ⚠️ **최고 위험**

**위치**: `apps/api/src/edit-sessions/edit-sessions.controller.ts:184-192`

```typescript
@Get(':id')
async findOne(@Param('id', ParseUUIDPipe) id: string) {
  const session = await this.editSessionsService.findById(id);
  return this.editSessionsService.toResponseDto(session);
}
```

**문제**:
- JWT 인증만 있고 **소유자 검증 없음**
- 사용자 A가 사용자 B의 sessionId를 알면 **canvasData(편집 내용 전체)** 조회 가능
- update/complete/delete는 권한 체크 있음 → **읽기만 무방비**

**악용 시나리오**:
1. 사용자 A가 자기 sessionId 확인
2. UUID 추측/유출 시 사용자 B의 작업물 노출

**수정 방향**:
```typescript
@Get(':id')
async findOne(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user: any,
) {
  const userId = user?.userId ? parseInt(user.userId) : 0;
  const session = await this.editSessionsService.findById(id);
  if (Number(session.memberSeqno) !== userId && user?.role !== 'admin') {
    throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
  }
  return this.editSessionsService.toResponseDto(session);
}
```

---

### 결함 #2 — `GET /api/files/:id` 권한 검증 없음 ⚠️

**위치**: `apps/api/src/files/files.controller.ts`

```typescript
@Get(':id')
@ApiBearerAuth()
async getFile(@Param('id', ParseUUIDPipe) id: string) {
  const file = await this.filesService.findById(id);
  return this.filesService.toResponseDto(file);
}
```

**문제**: 다른 사용자 파일의 메타데이터(filePath, fileSize, originalName 등) 노출

**수정 방향**: `@CurrentUser()` 추가 + memberSeqno 일치 검증

---

### 결함 #3 — `GET /api/files/:id/download` 인증 자체가 없음 ⚠️ **최고 위험**

**위치**: `apps/api/src/files/files.controller.ts`

```typescript
@Get(':id/download')
@Public()  // ← 인증 없음!
async downloadFile(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response)
```

**문제**:
- `@Public()` 데코레이터로 **JWT 인증조차 우회**
- UUID만 알면 누구나 PDF 다운로드 가능
- PHP에서 fileId를 클라이언트 노출 시 즉시 유출

**수정 방향**:
- `@Public()` 제거 또는
- 다운로드 토큰(short-lived) 시스템 도입 (`/files/:id/download-token` → 1회용 토큰)

---

### 결함 #4 — `GET /api/files?orderSeqno=&memberSeqno=` 무차별 조회 ⚠️

**위치**: `apps/api/src/files/files.controller.ts`

```typescript
@Get()
async getFiles(
  @Query('orderSeqno') orderSeqno?: string,
  @Query('memberSeqno') memberSeqno?: string,
)
```

**문제**:
- 인증된 사용자라면 **임의의 orderSeqno/memberSeqno로 다른 사용자의 파일 목록 조회 가능**
- 주문번호 추측만으로 타인 주문의 cover/content 파일 ID 획득

**수정 방향**:
```typescript
async getFiles(
  @Query() params,
  @CurrentUser() user: any,
) {
  const userId = parseInt(user.userId);
  // memberSeqno는 JWT 값으로 강제 주입 (URL 파라미터 무시)
  if (user.role !== 'admin') {
    params.memberSeqno = userId;
  }
  // ...
}
```

---

### 결함 #5 — JWT 페이로드에 `orderSeqno` 부재 ⚠️ **PHP 연동 영향**

**위치**: `apps/api/src/auth/auth.service.ts:107-119`

```typescript
const payload = {
  sub: dto.memberSeqno.toString(),  // memberSeqno만 있음
  email, name, role: 'customer', source: 'shop',
  permissions: ['edit', 'upload', 'validate'],
};
```

**문제**:
- JWT에 **주문 컨텍스트(orderSeqno) 없음**
- 사용자 A가 자기 주문 #100 용 JWT를 받아 → 주문 #200으로 EditSession 만들 수 있음
- DTO `orderSeqno` 값을 무차별 신뢰

**수정 방향 (옵션 A — 권장)**:
- JWT에 `orderSeqno`(또는 `allowedOrders`) 포함
- 매 호출 시 `dto.orderSeqno`가 JWT의 `orderSeqno`와 일치하는지 검증

**수정 방향 (옵션 B — 보수적)**:
- JWT는 그대로 두되, `dto.orderSeqno`의 주문이 PHP 측에서 해당 회원에 속하는지 확인
- Storige 측은 `orderSeqno + memberSeqno` 조합이 다른 EditSession에 이미 사용된 경우 차단

---

## 🟡 고려해야 할 추가 이슈

### 이슈 #6 — 사용자별 "보관함" UI 부재
- `EditSession`은 있지만 사용자가 "내 작업 목록"을 보는 UI 없음
- PHP 측에서 마이페이지 → 작업 이어가기 시:
  - PHP가 `findByMemberSeqno(memberSeqno)` 또는 `findByOrderSeqno`로 직접 호출 필요
  - **현재 endpoint에서 권한 검증 없음 → 결함 #1/#4와 같은 위험**

### 이슈 #7 — Library는 전역 카탈로그 (의도된 동작)
- `library_categories`, `library_backgrounds`, `library_shapes` 등은 **admin 관리** 자산
- 사용자별 분리 X = 모든 사용자가 같은 폰트/배경/도형 사용 ✅ 정상

### 이슈 #8 — Webhook callbackUrl 검증 없음
- `EditSession.callbackUrl`, `WorkerJob.options.callbackUrl` 모두 사용자 입력 그대로 저장
- 악의적 URL 주입 시 storige 서버가 외부 임의 endpoint로 POST 요청 보냄
- **SSRF 위험** — allowlist 또는 도메인 검증 필요

### 이슈 #9 — `EditSessionVersion`에 memberSeqno 없음
- 버전 히스토리는 sessionId FK로만 추적
- 세션 삭제 시 cascade 없으면 orphan version 가능
- (이미 cascade 처리됐을 가능성 — 별도 확인)

---

## 📐 PHP 연동안 vs 현재 구현 일치 여부

### ✅ 일치하는 부분
- PHP가 `memberSeqno` 기반 JWT 발급 → 정상
- Editor URL에 `orderSeqno` + `sessionId` 전달 → 정상
- 재편집 시 sessionId 우선 + orderSeqno fallback → 정상
- File 업로드 시 `memberSeqno`/`orderSeqno` 메타 저장 → 정상
- Webhook 콜백 시 `orderSeqno` 포함 → 정상

### ⚠️ 미고려/누락
- ⚠️ JWT 페이로드에 orderSeqno 없음 → 결함 #5
- ⚠️ Read API 4종 권한 검증 누락 → 결함 #1~#4
- ⚠️ Webhook callbackUrl SSRF 방어 부재 → 이슈 #8
- ⚠️ "내 작업 목록" 사용자 페이지 부재 → PHP 측에서 별도 구현 필요 (현재는 storige API 직접 호출 → 보안 결함과 결합 시 위험)

### 💡 PHP 팀이 알아야 할 것
1. **`fileId`를 절대 클라이언트(브라우저)에 노출 금지** — 결함 #3 미수정 상태에서 외부 유출 시 즉시 다운로드 가능
2. **`sessionId` 클라이언트 노출도 위험** — 결함 #1 미수정 시 canvasData 조회 가능
3. **재편집 URL에는 PHP 측에서 인증된 사용자의 sessionId만 포함**해야 함
4. **PHP 측 마이페이지에서 storige API 직접 호출 시 PHP 서버에서 X-API-Key로 호출** (브라우저 직접 호출 X)

---

## 🎯 대응 전략

### 🔴 즉시 처리 (보안 패치 — 1~2시간)

**Patch A — 권한 검증 추가** (결함 #1, #2)
```typescript
// apps/api/src/edit-sessions/edit-sessions.controller.ts
// apps/api/src/files/files.controller.ts
// → @Get(':id') 에 @CurrentUser() + memberSeqno 일치 검증 추가
```

**Patch B — 다운로드 인증 강화** (결함 #3)
```typescript
// apps/api/src/files/files.controller.ts
// 옵션 1: @Public() 제거 + JWT 인증 + 권한 검증
// 옵션 2: 단기 토큰 시스템 (short-lived signed URL)
```

**Patch C — 목록 조회 강제 필터** (결함 #4)
```typescript
// apps/api/src/files/files.controller.ts
// admin 외에는 JWT.memberSeqno 강제 주입
```

**Patch D — JWT 페이로드 + 검증 강화** (결함 #5)
```typescript
// apps/api/src/auth/auth.service.ts (createShopSession DTO + payload)
// + DTO에 allowedOrders[] 또는 orderSeqno 추가
// + EditSession create 시 검증
```

### 🟡 중기 처리 (1~2일)

**Patch E — Webhook callbackUrl 검증** (이슈 #8)
- 환경변수 `ALLOWED_CALLBACK_HOSTS` (예: `papascompany.co.kr,bookmoa.com`)
- URL 호스트 매칭 후 매치 안 되면 거부

**Patch F — 사용자 작업 목록 endpoint** (이슈 #6)
- `GET /api/edit-sessions/me` (JWT memberSeqno 자동 사용)
- PHP 마이페이지에서 활용 가능

### 🟢 장기 처리 (1~2주, 별도 사이클)

**Patch G — File 다운로드 토큰 시스템**
- `POST /files/:id/download-url` → 1분 유효 signed URL 발급
- PHP에서 사용자에게 보여줄 때 매번 새 URL 발급

---

## 📊 영향도 평가

| 결함 | 발생 가능성 | 영향 범위 | 즉시성 |
|------|-----------|----------|--------|
| #3 다운로드 인증 부재 | 🔴 매우 높음 (UUID 유출 시) | 모든 PDF 노출 | **🔴 즉시** |
| #1 EditSession 읽기 무방비 | 🟡 중간 (UUID 추측 어려움) | canvasData 노출 | **🔴 즉시** |
| #4 무차별 파일 목록 조회 | 🟡 중간 (orderSeqno 추측) | 주문 단위 정보 | **🔴 즉시** |
| #2 File 메타 조회 | 🟢 낮음 (UUID 추측 어려움) | 파일 메타 노출 | 🟡 24h 내 |
| #5 JWT orderSeqno 부재 | 🟢 낮음 (PHP 측 검증 의존) | 잘못된 주문에 작업 연결 | 🟡 1주 내 |
| #8 SSRF callbackUrl | 🟢 낮음 (PHP만 호출) | 내부망 스캔 | 🟢 1개월 내 |

---

## 🚀 추천 진행 방식

### 1단계 — 즉시 보안 패치 (오늘)
- Patch A + B + C 일괄 적용 (`feat(security): 사용자 격리 권한 검증 강화`)
- VPS API 재배포
- E2E smoke test

### 2단계 — JWT 페이로드 강화 (내일)
- Patch D 적용
- PHP 측 가이드 갱신 (`shop-session` 호출 시 orderSeqno 전달 안내)
- SYSTEM_INTEGRATION_OVERVIEW v2.4

### 3단계 — Webhook 보안 + 보관함 (이번 주)
- Patch E + F
- PHP 측 마이페이지 가이드

### 4단계 — 다운로드 토큰 (다음 주)
- Patch G

---

## 📋 운영 구조 변경 필요 여부

| 영역 | 변경 필요? | 비고 |
|------|----------|------|
| DB 스키마 | ❌ 불필요 | 식별자 컬럼 모두 존재 |
| API endpoint | ✅ **권한 검증 추가** | 코드만 수정, route 변경 없음 |
| JWT 페이로드 | ⚠️ **확장 권장** | PHP `shop-session` 호출 시 orderSeqno 추가 (호환 유지) |
| Worker | ❌ 불필요 | 식별은 EditSession FK로 처리 |
| Editor (브라우저) | ❌ 불필요 | URL 파라미터 그대로 |
| PHP 측 코드 | ⚠️ **가이드 갱신** | shop-session 호출 시 orderSeqno 전달 권장 (선택) |

> ✅ **운영 구조는 그대로 유지 가능**. API 코드 패치만으로 모든 결함 해결.

---

## 🔗 관련 코드 위치

- `apps/api/src/auth/auth.service.ts` — JWT 발급
- `apps/api/src/auth/dto/shop-session.dto.ts` — shop-session DTO
- `apps/api/src/edit-sessions/edit-sessions.controller.ts` — EditSession API
- `apps/api/src/edit-sessions/edit-sessions.service.ts` — 권한 검증 로직
- `apps/api/src/files/files.controller.ts` — Files API
- `apps/api/src/files/files.service.ts` — 파일 처리
- `apps/api/src/worker-jobs/worker-jobs.service.ts` — 워커 잡 (이미 잘 되어있음)
- `apps/editor/src/embed.tsx` — Editor 임베드 (이미 잘 되어있음)
- `docs/SYSTEM_INTEGRATION_OVERVIEW.md` (v2.3) — PHP 연동 레퍼런스

---

## 🎬 즉시 자동화 가능한 패치

위 결함 #1~#5는 **모두 자동화로 처리 가능**합니다 (운영 변경 없이 API 코드만 수정):

```
✅ Patch A — EditSession + Files findOne 권한 검증 (10분)
✅ Patch B — File download 인증 강화 (15분)
✅ Patch C — File list 강제 필터 (5분)
✅ Patch D — JWT orderSeqno 확장 + DTO 호환 (15분)
✅ Patch E — Webhook URL allowlist (10분)
✅ E2E smoke 테스트 추가 (15분)
─────────────────────────────────────
총 약 70분 + 운영 배포 5분 = 1.5시간 내 완료
```

진행 방식:
- 한 번에 일괄 패치 (single PR)
- 또는 Patch A/B/C 즉시 → D는 PHP 협의 후 → E/F 다음 주

진행할지 말씀해주세요.
