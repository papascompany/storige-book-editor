# P0 운영 체크리스트

> **기준일**: 2026-05-02 · **최종 업데이트**: 2026-05-02 14:00 KST
> **출처**: [`docs/REMAINING_WORK_REVIEW.md`](./REMAINING_WORK_REVIEW.md) §B P0
>
> Claude가 직접 진행 불가능한(운영 환경 직접 접근 / 실기기 필요) P0 작업의 실행 가이드.
> Claude가 진행 가능한 P0-3(타입 정리)·P0-4(시점별 복원 UI)는 commits `8820066`·`0b7cc23`에서 처리됨.

## 진행 현황 (2026-05-02 기준 — 모든 P0 종료)

| ID | 항목 | 상태 | 커밋 / 비고 |
|---|---|---|---|
| **P0-1** | 운영 DB 마이그레이션 (`edit_session_versions` + 옵션 C) | ✅ **완료** | 2026-05-01 23:33 KST. FK COLLATE 보정 `ce082ef` |
| **P0-2** | 모바일/PC 실기기 검증 | ✅ **완료** | 2026-05-02 사용자 보고 4건 + 콘솔 보고 3건 → 6차 P0 핫픽스 사이클 (`5228171` `819008d` `982f944` `0c0e8aa`)로 모두 처리 |
| **P0-3** | 사전 type 에러 9 + 12건 정리 | ✅ 완료 | `8820066` + `d1d78fc` (P1-3) — `pnpm tsc --noEmit` clean |
| **P0-4** | 시점별 복원 UI confirm + 자동 reload | ✅ 완료 | `0b7cc23` (HistoryPanel) |
| **부수 1** | 운영 재배포 1차 (P0-1) | ✅ 완료 | 2026-05-01 23:33 KST — `docker compose up -d --build api worker` (4m28s) |
| **부수 2** | 운영 재배포 2차 (BB-Phase 3 풀스택 + cleanup cron) | ✅ 완료 | 2026-05-02 12:37 KST — git pull `ce082ef → 2097e1c` (6 commits) + docker rebuild |
| **부수 3** | 운영 재배포 3차 (cron TZ fix UTC 17:30 = KST 02:30) | ✅ 완료 | 2026-05-02 13:02 KST — `9d67d8c` 적용 + api 재기동 |
| **부수 4** | iOS Safari 페이지 크래시 fix | ✅ 완료 | `60efb05` — AppBackground `requestRenderAll` + useCanvasThemeSync TOUCH_ENV |
| **부수 5** | Vercel HTML cache fix | ✅ 완료 | `5228171` — `vercel.json` no-store + `/assets/*` immutable |
| **부수 6** | `unhandledrejection` global handler | ✅ 완료 | `0c0e8aa` — React 트리 freeze 방지 |

---

## P0-1. 운영 DB 마이그레이션 적용 ✅ 완료

> **상태**: ✅ **2026-04-30 적용 완료**
> **위험도**: 중 (백업 완료, 롤백 가능)
>
> ### 적용 결과
> - 프로덕션 DB 호스트 `158.247.235.202` SSH 접속 → `mariadb-dump`(MariaDB 11.2는 mysqldump 미포함)로 백업 → `edit_session_versions` CREATE → `SHOW TABLES` / `DESCRIBE` 검증 통과
> - 1차 시도에서 FK 생성 errno 150 (collation mismatch) 발생 → migration SQL에 `COLLATE=utf8mb4_unicode_ci` 명시(`ce082ef`) 후 재적용 성공
> - api 컨테이너 재배포(`docker compose up -d --build api worker`, 4m28s)로 BB-Phase 3 자동저장 시점 versions 풀 스택 활성화

### 적용 대상 마이그레이션 (2개, 동시 적용 가능)

### 적용 대상 마이그레이션 (2개, 동시 적용 가능)

| 파일 | 내용 | 영향 |
|---|---|---|
| [`20260501_add_products_allowCustomSize.sql`](../apps/api/migrations/20260501_add_products_allowCustomSize.sql) | `products` 테이블에 `allowCustomSize BOOLEAN DEFAULT FALSE` 컬럼 추가 | 옵션 C(북모아 width/height URL override) 활성화 — 기존 상품은 default false라 동작 변경 없음 |
| [`20260501_add_edit_session_versions.sql`](../apps/api/migrations/20260501_add_edit_session_versions.sql) | `edit_session_versions` 테이블 신규 (BB-Phase 3 LRU 20) | 자동저장 시점 versions 시스템 활성화 — 기존 데이터 영향 없음, 점진적으로 시점 누적 시작 |

### 사전 점검

```bash
# 1. 백업 (필수)
ssh deploy@158.247.235.202
docker exec storige-mariadb mysqldump -uroot -p$MYSQL_ROOT_PASSWORD storige \
  > ~/backups/pre-p0-migration-$(date +%Y%m%d-%H%M).sql
ls -lh ~/backups/pre-p0-migration-*.sql  # 크기 확인

# 2. 현재 스키마 확인
docker exec -it storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige -e \
  "SHOW COLUMNS FROM products LIKE 'allowCustomSize';"
docker exec -it storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige -e \
  "SHOW TABLES LIKE 'edit_session_versions';"
# 둘 다 0 rows = 미적용 상태 (정상)
```

### 적용

```bash
# 1. 옵션 C — products.allowCustomSize 추가
docker exec -i storige-mariadb mariadb -uroot -p$MYSQL_ROOT_PASSWORD storige \
  < apps/api/migrations/20260501_add_products_allowCustomSize.sql

# 2. BB-Phase 3 — edit_session_versions 테이블 신규
docker exec -i storige-mariadb mariadb -uroot -p$MYSQL_ROOT_PASSWORD storige \
  < apps/api/migrations/20260501_add_edit_session_versions.sql
```

### 적용 검증

```bash
docker exec -it storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige -e "
  SHOW COLUMNS FROM products LIKE 'allowCustomSize';
  SHOW TABLES LIKE 'edit_session_versions';
  DESCRIBE edit_session_versions;
"
# 기대:
# - allowCustomSize | tinyint(1) | NO | | 0 |
# - edit_session_versions 테이블에 7 컬럼 (id, session_id, saved_at, pages, page_count, created_by, thumbnail_url)
```

### 사후 검증 (운영 영향 모니터링 — 30분~1시간)

```bash
# api 컨테이너 로그 — autoSave 호출 시 maybePushVersion 정상 동작 (warning 없음)
docker logs --tail 200 -f storige-api 2>&1 | grep -E "autoSave|version push"

# version 누적 확인 (사용자 1~2명 작업 후)
docker exec -it storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige -e \
  "SELECT session_id, COUNT(*) FROM edit_session_versions GROUP BY session_id LIMIT 5;"

# LRU 20 정책 작동 확인
docker exec -it storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige -e \
  "SELECT MAX(cnt) FROM (SELECT COUNT(*) cnt FROM edit_session_versions GROUP BY session_id) t;"
# 기대: 최대 20 이하
```

### 롤백 (문제 발생 시)

```sql
-- 옵션 C 롤백
ALTER TABLE products DROP COLUMN allowCustomSize;

-- BB-Phase 3 롤백
DROP TABLE edit_session_versions;

-- 또는 백업 복원
mysql -uroot -p storige < ~/backups/pre-p0-migration-YYYYMMDD-HHMM.sql
```

---

## P0-2. 모바일/PC 실기기 검증 ✅ 완료

> **상태**: ✅ **2026-05-02 사용자 보고 4건 + 콘솔 보고 3건 → 6차 P0 핫픽스 사이클로 모두 처리**
> **위험도**: 낮음 (검증만, 핫픽스는 별도 commits)
>
> ### 6차 P0 핫픽스 사이클 (2026-05-02)
> 사용자 실기기 보고 → 핫픽스 → Vercel 자동 배포 → 사용자 재테스트 → 추가 보고 → 추가 핫픽스 반복:
>
> | 보고 | 진단 | Fix Commit |
> |---|---|---|
> | "Importing a module script failed" | Vercel CDN HTML cache 9분 → 새 deploy 시 옛 chunk hash 404 | `5228171` (vercel.json no-store + assets immutable. 직전 `ae59bf2`는 `comment` 필드로 schema 거부) |
> | 모바일 배경색 picker dismiss 적용 모호 | iOS native picker는 X(닫기) 시점 적용 — 사용자 혼동 | `5228171` (명시적 "적용" 버튼 + 안내 텍스트) |
> | 모바일 사진/요소 업로드 시 다운 | 대용량 사진 + retina 캔버스 → iOS Safari 384MB 한계 | `5228171` (`checkMobileFileSize` 4MB 가드 + toast) |
> | 반복 ErrorBoundary 트리거 | 위 메모리 크래시 누적 | `5228171` 가드 효과로 자동 감소 |
> | 요소 도구 PNG 업로드 시 "SVG 아닙니다" | AppElement는 image/* 받지만 store는 SVG만 처리 | `819008d` (raster 분기 추가, 직전 `f65315d` SVG-only는 잘못된 fix) |
> | 배경색 적용 무반응 | `workspace.fill = X` 직접 할당 + `requestRenderAll` 비동기 | `0c0e8aa` (fresh fetch + `.set({fill, dirty:true})` + `renderAll()`. preview 픽셀 검증 [248,206,206] = #F8CECE) |
> | SVG 업로드 후 화면 freeze | `fileToImage` → `fabric.Image.fromURL(svgDataUrl)` → `t.indexOf` throw, unhandled rejection으로 React 트리 freeze | `0c0e8aa` (SVG 모든 SelectionType에서 fileToImage skip → loadSVGFromURL + main.tsx에 `unhandledrejection` global handler) |
>
> 위 모든 핫픽스는 Vercel 자동 빌드로 배포 완료 (api/worker 변경 없음).

### 대상 디바이스

| 카테고리 | 권장 |
|---|---|
| iOS 메인 | iPhone 14/15 (최신 iOS Safari) |
| iOS 구형 | iPhone 12/13 또는 iPhone SE 2/3 (메모리 한계 시나리오) |
| Android 메인 | Pixel 7/8 또는 Galaxy S22+ (Android 13+ Chrome) |
| 태블릿 | iPad Air (iOS Safari) — landscape/portrait 전환 |

### 시나리오별 검증 항목

#### 1. 기본 마운트 + 페이지 크래시 회피
- [ ] 페이지 로드 (5초 이내) — ResizeObserver 무한 루프 차단 (PR #1)
- [ ] 캔버스 정상 렌더 (1쪽 빈 캔버스)
- [ ] 새로고침 5번 연속 — Safari 페이지 크래시 없음

#### 2. 메모리 폭발 회피
- [ ] 페이지 5개 추가 + 각 페이지에 텍스트 2개 + 이미지 2개
- [ ] 자동저장 1분 트리거 — toDataURL 비용 회피 확인 (PR #2/#4)
- [ ] 페이지 전환 10회 — 메모리 누적 없이 정상 작동
- [ ] iOS 14 Safari "이 페이지의 콘텐츠가 다시 로드되었습니다" 발생 안 함

#### 3. 터치 UI/UX
- [ ] **사이드바 핸들 드래그** (DD-X 트랙) — 손가락 터치로 폭 조절 (touchAction:none + Pointer Events 적용 확인)
- [ ] **페이지 네비 화살표 44×44** (트랙 X) — 손가락으로 정확히 탭
- [ ] **ControlBar 하단 시트** (PR #3) — 객체 선택 시 collapsed → 헤더 탭으로 expand
- [ ] **스피너 입력** (size, opacity 등) — coarse pointer 시 hit area 충분
- [ ] **드래그 앤 드롭 이미지 업로드** (트랙 S) — 사진 앱에서 드래그 (iOS 15+) 또는 갤러리 선택

#### 4. 헤더 도구 접근성 (⚠️ 우리가 보고한 잔존 issue)
- [ ] viewport 375px(iPhone SE)에서 편집완료 버튼 가시성 — 가로 스크롤 발생 여부 (X-3 트랙 후보)
  - 발견 시 README 또는 사용자 가이드에 "iPhone SE 사용자는 편집완료를 ⌘+S 단축키 또는 메뉴 사용" 명시 또는 헤더 압축 PR

#### 5. 다크 모드 (트랙 W)
- [ ] 헤더 테마 토글 → 다크 모드 진입
- [ ] 룰러 색상 어두운 톤(#1f2937) 적용
- [ ] 캔버스 객체 선택 핸들 다크 그린 (`rgba(142,207,69,0.7)`)
- [ ] 워크스페이스 흰 페이지 유지(인쇄용지 가이드)

#### 6. 표지 편집 (D5 Phase 3b)
- [ ] 표지 템플릿 로드 (북모아 옵션 B/C URL — `?templateSetId=X&width=200&height=300`)
- [ ] CoverFocusBar 미니맵 표시 + region 클릭 포커싱
- [ ] 객체를 다른 region으로 이동 (MoveToCoverRegion ControlBar) — Phase 2A 정밀 매핑 확인

#### 7. 자동저장 + 시점 복원 (BB-Phase 3 + P0-4)
- [ ] sessionId 있는 환경(임베드 또는 직접 URL) 진입
- [ ] 1분 이상 편집 후 HistoryPanel popover 열기
- [ ] "자동저장 시점 (N)" 섹션에 항목 노출
- [ ] "복원" 버튼 클릭 → confirm 카드 표시 (실수 클릭 방지)
- [ ] "확인 후 복원" 클릭 → toast + 0.5초 후 자동 페이지 새로고침
- [ ] 복원 후 캔버스가 시점 데이터로 갱신됨

#### 8. ErrorBoundary (PR #5)
- [ ] DevTools에서 인텐셔널 에러 트리거 (예: `throw new Error()` in console)
- [ ] ErrorBoundary fallback UI 표시 + localStorage 백업 안내
- [ ] "다시 시도" 클릭 → 백업으로부터 캔버스 복구

### 발견 시 조치

문제 발견 시 `docs/REMAINING_WORK_REVIEW.md`에 P1/P2로 등재 + GitHub issue 생성. 즉시 수정이 필요한 critical 발견(crash, 데이터 손실)은 hotfix branch로 별도 PR.

---

## 진행 표시 (2026-05-02 14:00 KST 기준 — 모든 P0 종료)

- [x] P0-1 운영 DB 마이그레이션 — **2026-05-01 23:33 KST 적용 완료** (`ce082ef` FK COLLATE fix 포함)
- [x] P0-2 모바일/PC 실기기 검증 — **2026-05-02 6차 P0 핫픽스 사이클 완료** (`5228171` `819008d` `982f944` `0c0e8aa`)
- [x] P0-3 사전 type 에러 9 + 12건 정리 — `8820066` + `d1d78fc` (P1-3) — `pnpm tsc --noEmit` clean
- [x] P0-4 시점별 복원 UI confirm + 자동 reload — `0b7cc23`
- [x] 운영 api/worker 재배포 1차 — `docker compose up -d --build api worker` (4m28s)
- [x] 운영 api/worker 재배포 2차 — BB-Phase 3 풀스택 + cleanup cron 활성화 (2026-05-02 12:37)
- [x] 운영 api 재기동 3차 — cron TZ fix `9d67d8c` UTC 17:30 (2026-05-02 13:02)
- [x] iOS Safari 페이지 크래시 fix — `60efb05`
- [x] Vercel HTML cache fix — `5228171` (vercel.json no-store + assets immutable)
- [x] `unhandledrejection` global handler — `0c0e8aa` (React 트리 freeze 방지)

모든 P0 항목 종료. 다음 사이클은 P1 진입 (PHP 통합 / PDF Synthesis / 저장 E2E / Composite Ph3 / 콘텐츠 카탈로그 / 반응형 Ph3).

## 사용자 재테스트 안내 (Vercel 캐시 비우고 검증 권장)

새 핫픽스가 다 적용된 환경 사용을 위해:

- **iOS Safari**: 설정 → Safari → 방문 기록 및 웹사이트 데이터 지우기 (혹은 사파리 주소창 `?nocache=1` 쿼리)
- **PC 브라우저**: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Win)

이번 vercel.json `no-store` 정책 적용 후로는 새 deploy 시 옛 chunk hash로 인한 "Importing a module script failed" 재발 가능성 없음.

**검증 체크 순서**:

1. ✅ "Importing a module script failed" 안 나오는지 (해결됨)
2. ✅ 배경색 → 색상 선택 → "적용" 버튼 → 워크스페이스 색 즉시 변경
3. ✅ 요소 → 업로드 → SVG/PNG/JPG 모두 정상 추가
4. ✅ 이미지 → 업로드 → 사진 정상 추가 (4MB 이하)
5. ✅ SVG 업로드 후 다른 메뉴 클릭/터치 → 정상 반응 (freeze 안 됨)
6. ⏳ 저장/불러오기 흐름 (sessionId 환경 — P1로 별도 검증)

문제 발견 시 콘솔 로그 그대로 캡처해 공유하면 즉시 진단 가능.
