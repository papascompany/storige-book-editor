---
name: menu-icon-asset-system
description: D2-NEW — Editor 좌측 사이드 메뉴(업로드·템플릿·이미지·텍스트·배경·프레임·QR/바코드·모양컷·편집도구)의 아이콘을 admin에서 PNG로 업로드/관리하는 시스템 구축. 운영자가 코드 변경 없이 아이콘을 교체 가능.
model: sonnet
---

# 10. Menu Icon Asset System (D2-NEW)

## 배경
원래 D2(phosphor 66종 → Lucide 일괄 교체) 대신, **admin에서 PNG 아이콘을 업로드해 동적 적용**하는 시스템으로 전환.

장점:
- 코드 변경 최소 (ToolBar의 icon 렌더 추상화 1곳)
- 운영자가 언제든 아이콘 교체 가능 (브랜딩, 시즌 캠페인 등)
- 신규 메뉴 추가 시에도 PNG 업로드만으로 시각화

## 1. DB 스키마 신규 (init.sql 추가)

```sql
CREATE TABLE IF NOT EXISTS menu_icons (
  id          VARCHAR(36) PRIMARY KEY,
  menu_key    VARCHAR(50) UNIQUE NOT NULL,    -- 'upload','template','image','text','background','frame','smart_code','clipping','edit'
  display_name VARCHAR(100) NOT NULL,         -- '업로드'
  icon_url    VARCHAR(500),                   -- /storage/menu-icons/<key>.png  (NULL = phosphor 기본)
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  VARCHAR(36),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_menu_icons_active (is_active),
  INDEX idx_menu_icons_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 기본 9개 시드 (icon_url=NULL → editor가 phosphor 기본 fallback)
INSERT INTO menu_icons (id, menu_key, display_name, sort_order) VALUES
  ('mi-upload',    'upload',          '업로드',      1),
  ('mi-clipping',  'clipping',        '모양컷',      2),
  ('mi-template',  'template',        '템플릿',      3),
  ('mi-image',     'image',           '이미지',      4),
  ('mi-text',      'text',            '텍스트',      5),
  ('mi-background','background',      '배경',        6),
  ('mi-frame',     'frame',           '프레임',      7),
  ('mi-smartcode', 'smart_code',      'QR/바코드',   8),
  ('mi-edit',      'edit',            '편집도구',    9)
ON DUPLICATE KEY UPDATE menu_key=menu_key;
```

## 2. API 엔드포인트 신규 (apps/api/src/menu-icons/)

```
GET    /api/menu-icons                    # public: 활성화된 모든 아이콘 + URL  (editor가 호출)
GET    /api/admin/menu-icons              # ADMIN: 전체 (비활성 포함)
PUT    /api/admin/menu-icons/:menuKey     # ADMIN: PNG 업로드 (multipart)
       (display_name, sort_order, is_active 갱신도 가능)
DELETE /api/admin/menu-icons/:menuKey/icon # ADMIN: 아이콘만 제거 (phosphor 기본으로 복원)
```

PNG 저장 위치: `/storage/menu-icons/<menuKey>-<timestamp>.png` (timestamp로 캐시 무효화)

## 3. Editor 변경 (apps/editor)

### 3.1 새 hook: `useMenuIcons.ts`
```ts
// 앱 시작 시 한 번 fetch + zustand 스토어에 캐시
const { data } = useQuery(['menu-icons'], () =>
  axios.get('/api/menu-icons').then(r => r.data)
)
// returns: { upload: '/storage/menu-icons/upload-1234.png', template: null, ... }
```

### 3.2 `MenuIcon.tsx` 컴포넌트 (추상화 레이어)
```tsx
import { UploadSimple, Layout, Image, ... } from '@phosphor-icons/react'

const FALLBACK = {
  upload: UploadSimple, template: Layout, image: Image, text: TextT, ...
}

export function MenuIcon({ menuKey, size = 24 }: { menuKey: string, size?: number }) {
  const icons = useMenuIcons()
  const url = icons?.[menuKey]
  if (url) {
    return <img src={url} alt={menuKey} width={size} height={size} />
  }
  const Fallback = FALLBACK[menuKey] || Image
  return <Fallback className="..." />
}
```

### 3.3 `ToolBar.tsx` 변경 (단 1곳)
```tsx
// 이전:
{Icon && <Icon className={...} />}

// 변경:
<MenuIcon menuKey={menu.type.toLowerCase()} size={24} />
```

## 4. Admin UI 신규 (apps/admin)

`apps/admin/src/pages/MenuIcons/` 페이지:
- 9개 메뉴 행 (key, display_name, 미리보기, 업로드 버튼, 기본값 복원)
- 정렬 순서 드래그 앤 드롭 (또는 sort_order 입력)
- 활성/비활성 토글
- PNG 업로드 시 즉시 미리보기 + 저장

PNG 권장 사양: **64×64px, 투명 배경, 24px 표시 시 깨끗하게 보이도록 1.5~2x 해상도**.

## 5. P0-A init.sql 갱신

`docker/mysql/init.sql`에 위 §1 DDL + 시드 추가. 이미 운영중인 DB에는 `init.sql`이 다시 적용 안 되므로 **수동 마이그레이션 SQL** 별도 작성:

```sql
-- migrate/2026-04-XX-add-menu-icons.sql
-- (위 CREATE TABLE + INSERT 그대로 복붙. ON DUPLICATE KEY로 멱등성)
```

VPS에서:
```bash
docker exec -i storige-mariadb mariadb -uroot -p$MYSQL_ROOT_PASSWORD storige < migrate/2026-04-XX-add-menu-icons.sql
```

## 6. 작업 분할 (체크리스트)

- [ ] **6.1** init.sql + 마이그레이션 SQL 작성
- [ ] **6.2** API 모듈 `menu-icons/`: entity, controller, service, dto + Multer 업로드
- [ ] **6.3** API 모듈 등록 (`app.module.ts` imports에 추가)
- [ ] **6.4** Editor: `useMenuIcons` hook + `MenuIcon` 컴포넌트
- [ ] **6.5** Editor: ToolBar의 icon 렌더 부분만 `<MenuIcon>` 로 교체
- [ ] **6.6** Admin: `MenuIcons` 페이지 + 라우터 등록
- [ ] **6.7** 운영 DB에 마이그레이션 적용
- [ ] **6.8** Admin에서 PNG 1개 업로드 → editor 새로고침 → 반영 확인
- [ ] **6.9** PNG 제거 → phosphor 기본 fallback 동작 확인

## 7. 예상 작업량

- 백엔드(API + DB): 0.5~1일
- Editor 추상화: 0.5일
- Admin UI: 0.5일
- 통합 검증: 0.5일

**총 1.5~2.5일** (phosphor 일괄 교체와 비슷한 시간이지만, 결과는 운영자가 영구히 활용 가능한 시스템).

## 8. 우선순위 권장

| 시점 | 진행 |
|------|------|
| Day 2-4 (지금) | 코드 보완 P1·P5 우선 — 컷오버 가능 상태 만들기 |
| Day 6 컷오버 후 | D2-NEW 백엔드 구축 (운영 트래픽과 무관하게 점진) |
| 운영 시작 후 1주 내 | D2-NEW Admin UI + 첫 PNG 업로드 |

→ **컷오버를 막지 않는 후속 작업**으로 분류. 지금 D3·D4(페이지 네비)와 P1·P5에 집중.

## 9. 호환성 / 안전장치

- `menu_icons` 테이블이 비어있거나 API가 404를 반환하면 **무조건 phosphor 기본 사용**
- ToolBar는 Suspense fallback으로 첫 로드 동안 phosphor 표시 → flicker 없음
- PNG 업로드 실패 시 기존 PNG 유지 (transactional)
- DELETE 시 storage 파일도 동시 정리

## 10. 산출물

- `docker/mysql/init.sql` (DDL + 시드 추가)
- `migrate/2026-04-XX-add-menu-icons.sql`
- `apps/api/src/menu-icons/*` (NestJS 모듈)
- `apps/editor/src/hooks/useMenuIcons.ts`
- `apps/editor/src/components/editor/MenuIcon.tsx`
- `apps/admin/src/pages/MenuIcons/index.tsx`
