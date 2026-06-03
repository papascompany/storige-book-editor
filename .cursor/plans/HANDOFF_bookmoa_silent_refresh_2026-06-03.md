# [bookmoa 전달] 임베드 편집기 사일런트 리프레시 — refreshToken 전달 요청 (2026-06-03)

## 배경
포토북은 **며칠에 걸쳐** 편집하는 경우가 많은데, shop-session 액세스 토큰은 **1시간** 만료라
장시간/다일 편집 중 자동저장이 401로 끊겼습니다. Storige 측에 **사일런트 리프레시**를 구현·배포 완료했습니다.
이제 액세스 토큰이 만료돼도 편집기가 `refreshToken`(30일)으로 자동 갱신합니다.

## bookmoa 가 해야 할 일 (1가지)
**임베드 URL 에 `refreshToken` 파라미터를 추가**하면 끝입니다.

### 1) shop-session 응답에서 refreshToken 받기
`POST /auth/shop-session` 응답 **body 에 이제 `refreshToken` 이 포함**됩니다(신규):
```json
{
  "success": true,
  "accessToken": "eyJ...",      // 1h
  "refreshToken": "eyJ...",     // ★신규, 30d — 이 값을 편집기로 전달
  "expiresIn": 3600,
  "member": { "seqno": ..., "id": "...", "name": "..." }
}
```
(쿠키 `storige_refresh` 도 그대로 내려가지만, 크로스오리진 iframe 에선 못 쓰므로 **body 값을 사용**하세요.)

### 2) 편집기 임베드 URL 에 추가
기존:
```
/embed?templateSetId=...&token=<accessToken>&orderSeqno=...&parentOrigin=...
```
변경(`refreshToken` 1개 추가):
```
/embed?templateSetId=...&token=<accessToken>&refreshToken=<refreshToken>&orderSeqno=...&parentOrigin=...
```
재편집(`sessionId`) URL 도 동일하게 `&refreshToken=<refreshToken>` 추가.

> 끝. 그 외 편집기 내부 동작(401 감지 → 자동 갱신 → 재시도)은 Storige 가 처리합니다.

## 동작 방식 (참고)
1. 편집기가 `refreshToken` 을 localStorage(`auth_refresh_token`)에 저장.
2. 어떤 API 호출이든 **401** 이 나면 편집기가 `POST /auth/shop-refresh-body { refreshToken }` 로 새 accessToken 발급.
3. 갱신된 토큰으로 **원래 요청 자동 재시도** → 사용자는 끊김 없이 계속 편집.
4. refreshToken(30일)도 만료되면 그때 진짜 만료 처리(재진입 필요).

## 검증 완료 (Storige 측, 2026-06-03)
- `shop-session` 응답 body 에 refreshToken 포함 ✅
- `shop-refresh-body`: refreshToken → 새 accessToken(shop 컨텍스트·주문스코프 보존) ✅
- **실브라우저 E2E**: 일부러 깨진 accessToken + 유효 refreshToken 으로 편집기 로드 →
  첫 자동저장 401 → `[ApiClient] 사일런트 리프레시 성공` → `[EmbedAutoSave] 서버 저장 성공`,
  서버 세션 `draft→editing` 반영 확인 ✅ ("저장 실패" 토스트 없음)

## 참고: 토큰 수명 정책
- accessToken: **1h** (변경 없음 — 짧게 유지하고 자동 갱신하는 게 보안상 정석)
- refreshToken: **30d**
- 30일 넘게 묵힌 편집은 재진입(새 shop-session)이 필요합니다. 더 길게 원하면 Storige 측에서 조정 가능.

## 관련 커밋 (storige-book-editor master)
- `d40c599` 사일런트 리프레시 배선(API shop-refresh-body + 편집기 client 인터셉터 + embed refreshToken 파라미터)
- `57cd860` shop-session 응답 body 에 refreshToken 노출
