# P0 운영 체크리스트

> **기준일**: 2026-05-01
> **출처**: [`docs/REMAINING_WORK_REVIEW.md`](./REMAINING_WORK_REVIEW.md) §B P0
>
> Claude가 직접 진행 불가능한(운영 환경 직접 접근 / 실기기 필요) P0 작업의 실행 가이드.
> Claude가 진행 가능한 P0-3(타입 정리)·P0-4(시점별 복원 UI)는 commits `8820066`·`0b7cc23`에서 처리됨.

---

## P0-1. 운영 DB 마이그레이션 적용

> **상태**: ⏳ 사용자 운영 환경 직접 적용 필요
> **위험도**: 중 (백업 필수, 복구 가능)

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

## P0-2. 모바일 실기기 검증

> **상태**: ⏳ 사용자 실기기 필요
> **위험도**: 낮음 (검증만, 코드 변경 없음)

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

## 진행 표시

- [x] P0-3 사전 type 에러 9건 정리 — `8820066`
- [x] P0-4 시점별 복원 UI confirm + 자동 reload — `0b7cc23`
- [ ] P0-1 운영 DB 마이그레이션 — **사용자 적용 대기**
- [ ] P0-2 모바일 실기기 검증 — **사용자 검증 대기**

P0-1·P0-2 완료 후 `docs/REMAINING_WORK_REVIEW.md` §B P0 표 + 본 체크리스트 진행 표 갱신.

## 잔여 P0-3 후속 (별도 PR 권장)

12건 — 외부 진입점/테스트 모델/codegen 충돌 등으로 신중 검토 필요:

- `embed.tsx` 5건 (TemplateSet.data, safeSize, EditorConfig 중복 export)
- `useEditorStore.test.ts` 4건 (EditPage.name 필드)
- `RecommendationPanel.tsx` 1건 (TemplateSetType 'book'/'leaflet' 미정의)
- `AppElement.tsx` 1건 (graphql codegen vs @storige/types EditorContent createdAt Date↔string)
- (1건 추가는 `tsc --noEmit` 출력 참조)

각각 별도 PR로 분할 권장 (트랙 명: `chore/type-cleanup-embed`, `chore/type-cleanup-test`, `chore/type-cleanup-graphql`).
