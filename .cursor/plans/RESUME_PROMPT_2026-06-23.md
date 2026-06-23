# RESUME PROMPT — 2026-06-23

> 다음 세션 시작 시 이 파일 + `CLAUDE.local.md`(gitignored, 시크릿/SSH/Vercel) + `git log --oneline -15` 를 먼저 읽으세요.
> 직전 대형 작업 = **전체 코드베이스 전수감사 → P0/P1/Round4/분리4건 수정·배포 완결**.

---

## 0. ⚠️ 경로 (가장 먼저 확인)

- **정본(canonical) 경로** = `/Users/yohan/Developer/Bookmoa Storige editor/storige` ← 여기서 작업/커밋/푸시
- 비정본 중복 체크아웃 = `/Users/yohan/claude/Bookmoa Storige editor/storige` (2026-06-23 동일 커밋으로 동기화함). 같은 GitHub 리포를 가리킴. **혼선 방지를 위해 정본만 사용.**
- GitHub: `https://github.com/papascompany/storige-book-editor.git` (PUBLIC, master). 현재 master = **`5eaafc5`**.
- 푸시는 HTTPS 리모트로 동작(SSH 22 타임아웃 환경 있음). `git push origin master` 정상.

---

## 1. 현재 배포 상태 (전부 정상)

| 서비스 | 위치 | 배포 커밋 | 상태 |
|--------|------|-----------|------|
| API | VPS Docker (nginx→:4000) | `5eaafc5`(=helmet 포함 `7831c54` 코드) | health 200 |
| Worker | VPS Docker :4001 | `7e8df3a`(R4) | restarts 0 |
| Editor | Vercel `storige-editor` | `ounewexk3` = **jspdf 2.x** + EH-002/RACE-001 | Ready 200 |
| Admin | Vercel `storige-admin` | master 자동배포 | — |

- VPS 배포 레시피: `ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && docker compose build api worker && docker compose up -d api worker && docker compose restart nginx'`
  - ⚠️ **API recreate 시 nginx 반드시 재시작**(옛 IP 캐싱 502 방지).
- Editor 배포: **git 웹훅 미발화 → Vercel CLI 수동**. `cd apps/editor` → 토큰(`~/Library/Application Support/com.vercel.cli/auth.json`) → `vercel deploy --prod --scope yohans-projects-de3234df --token <T>`(원격빌드, **--prebuilt 금지**).
  - ⚠️ **CLI `vercel deploy` 는 `--prod` 없이도 이 프로젝트에서 자동 promote 됨**. 미검증 빌드를 prod에 올리지 말 것. "path does not exist(apps/editor/apps/editor)" 에러는 설정동기화만 실패하고 배포는 성사됨(rootDir 더블링, 무시 가능).
  - 롤백: `vercel promote <known-good-url> --yes`.

---

## 2. 직전 세션 완료 내역 (감사 162→114발견, 누적 무중단 배포)

- **P0 6건** (`f217009`): SSRF(stream-download url-safety + @IsSafeFileRef)·잡상태 인증·0페이지 가드·Bull lockDuration·tmp누수.
- **P1 16건** (`d441802`): 인가 IDOR(SEC-002~006)·정보누출(SEC-007/009)·SSRF/인젝션(SEC-010 execFile·WH-002)·웹훅 HMAC(WH-001 추가발송)·워커 신뢰성(EH-003/4/5·EH-001·PDF-006·BQ removeOn). 적대검증 2 MAJOR 적발수정(WH-002 16진 IPv4-mapped 우회·SEC-003 대소문자).
- **Round4 7건** (`7e8df3a`): DB-002/003 N+1 배치·multer 2.2.0(CVE)·CFG-001 warn-only·EH-002·RACE-001.
- **분리 4건 마무리**:
  - SEC-008 filePath DTO 제거 (`e9bc5e1`) — prod검증: GET /files/:id+워커키=401(미도달), 워커는 /download/external 사용.
  - DB-001 N+1 윈도우함수 (`e9bc5e1`).
  - jspdf 4.2.1 + svg2pdf 2.7.0 (`28fd486`) — 코드·카나리검증 완료, **prod는 2.x로 롤백(시각게이트)**.
  - AUTH-001 helmet (`7831c54`) — 배포완료. httpOnly는 미적용(승인 게이트).
- 테스트 그린: API 203 · worker 364 · editor 133 · canvas-core 309 · 린트 0 errors.

---

## 3. 🚦 다음 세션 우선 처리 — 사용자/오너 게이트

### A. jspdf 4.x 시각검증 → promote (사용자 결정)
- 현 prod editor = jspdf **2.x**(안전). master = jspdf **4.x**.
- jspdf 4.x 빌드 = Vercel `storige-editor` 배포 **`oo0rn0w1p`**(고유 URL 401=SSO, 오너는 대시보드 Visit 가능).
- **할 일**: 대표 인쇄물(명함 1p·책 표지+내지 spread·봉투 칼선) PDF 생성 → Acrobat로 TrimBox/BleedBox/좌표/텍스트/색상 육안확인 → 이상無면 `oo0rn0w1p` promote.
- ⚠️ **주의**: master가 4.x라 어떤 이유로든 editor 재배포하면 jspdf 4.x가 prod로 올라감. 시각검증 전 editor 배포 금지(또는 검증 먼저).
- 카나리(`packages/canvas-core/src/plugins/ServicePlugin.pdf.test.ts`)는 박스주입 private API 생존만 보증(픽셀 미보증).

### B. AUTH-001 httpOnly 마이그레이션 (사용자 승인 후 착수)
- 설계 완료(직전 세션 워크플로). 정리:
  - admin(1st-party) = httpOnly 쿠키 이원화: `auth.controller` login/refresh 에 dual Set-Cookie(body 유지=비파괴) + `jwt.strategy` jwtFromRequest 다중 extractor(Bearer+쿠키) + admin axios `withCredentials`.
  - editor(크로스도메인 임베드) = httpOnly 불가 → Bearer 유지 + JWT_EXPIRES_IN 단축(현재 기본 **7d**, 30m→점진) + CSP(Report-Only 먼저).
  - CSRF = 별도 티켓.
- ⚠️ **인증 경로 = 실수 시 전체 잠금**. refresh 인터셉터(editor `/auth/shop-refresh-body`, admin `/auth/refresh`) e2e 선행 필수. TTL 단축은 eviction 위험 → 보수값+모니터링.
- `jwt-cookie.strategy.ts`/`jwt-cookie.guard.ts` 는 존재하나 전역 미배선. cookie-parser·CORS credentials 는 이미 설정됨.

### C. 오너 게이트 (외부 조율/위험)
- **P0-2 시크릿**: PUBLIC 레포 히스토리 시크릿 → git filter-repo 정화 + force-push + 키 회전. 정본 `.cursor/plans/SECRET_ROTATION_HANDOFF_2026-06-15.md`(gitignored).
- **WH-001 cutover**: 위조불가 HMAC 서명은 추가 헤더로 발송 중(비파괴). 파트너(bookmoa/ShareSnap/100p/MD2Books) 수신측 전환 후 base64 폐기.
- **Bull attempts / BQ-03**: 재시도(attempts>1)는 합성 비멱등이라 중복 위험 → 멱등키 도입 선결. BQ-03(updateJobStatus 최종실패 시 DB PROCESSING 잔류)은 sweeper 2h 보완 중, throw 전환은 멱등성 검토 후.
- **SEC-005 모니터링**: `[SEC-005]` 경고 로그 = 임베드 재편집 호스트가 shop-session 에 orderSeqno 미주입 신호(데이터 고아화 위험). 발생 시 호스트 토큰 계약 점검. `docker logs storige-api | grep SEC-005`.

### D. 휴면 버그 (별도, 비긴급)
- 워커 `getFileById`(synthesis.processor `handleMergeSynthesis`)가 `GET /files/:id`+X-API-Key 호출 → **401**(JwtAuthGuard 가 키 거부). 활성 합성경로(coverUrl/contentUrl)는 미사용이라 무영향(7일 401에러 0, SYNTHESIZE 10건 COMPLETED). merge-by-fileId 모드를 쓰게 되면 워커용 메타 엔드포인트(ApiKeyGuard) 필요.

---

## 4. 작업 방식 메모

- 이 프로젝트는 ultracode/Workflow 오케스트레이션으로 진행해 왔음: **감사→적대검증(거부전제·콜러영향·정확수정·파일충돌)→병렬수정→테스트→배포** 사이클. 적대검증이 실제 MAJOR(SSRF 16진 우회 등)를 반복 적발했으므로 보안/인증/PDF 변경은 반드시 적대검증 게이트 통과 후 배포.
- 운영 무중단이 최우선 제약. 위험항목(인증경로·인쇄출력·시크릿)은 사람 게이트로 분리.
- 감사 정본 = 메모리 `project_full_audit_2026-06-21`. 분리4건·게이트 상세도 거기.

---

## 5. 빠른 헬스체크 (세션 시작 시)
```bash
ssh-add -l | head -1            # 비면 ssh-add ~/.ssh/id_ed25519
git -C "/Users/yohan/Developer/Bookmoa Storige editor/storige" log --oneline -5
git -C "/Users/yohan/Developer/Bookmoa Storige editor/storige" status -s
curl -s -o /dev/null -w "API %{http_code}\n" https://api.papascompany.co.kr/api/health
curl -s -o /dev/null -w "editor %{http_code}\n" https://editor.papascompany.co.kr/
```
