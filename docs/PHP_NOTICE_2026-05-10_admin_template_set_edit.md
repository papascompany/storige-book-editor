# PHP 팀 통보 — 2026-05-10 Admin "템플릿셋 수정" 기능 추가

> **PHP 연동(고객 흐름)에는 변경이 없습니다.** 이 문서는 향후 혼동을 막기 위한 일방향 통보입니다.

## 1. 무엇이 바뀌었나

Storige Admin 페이지의 "템플릿셋 관리" 행 버튼이 다음과 같이 정리되었습니다:

| 이전 | 현재 | 동작 |
|---|---|---|
| 에디터 | **템플릿셋 수정** | 에디터로 진입해 모든 페이지 캔버스를 admin 이 직접 디자인. 저장 시 각 페이지 `templates.canvas_data` 가 PATCH 됨 |
| 편집 | **설정** | 템플릿셋 메타(이름/판형/페이지 구성/도구 메뉴 노출) form 수정 — 캔버스 무관 |

Admin 이 "템플릿셋 수정" 으로 진입할 때 URL 에 새로운 파라미터 `adminEdit=templateSet` 이 추가됩니다.

```
https://editor.papascompany.co.kr/?templateSetId=...&adminEdit=templateSet&token=<admin_jwt>
```

## 2. PHP 측 영향

**없음.** 이유는 다음 두 가지 가드가 모두 적용되어야 admin 저장 분기가 활성화되기 때문:

1. URL 에 `adminEdit=templateSet` 파라미터가 있어야 함 — PHP/bookmoa 측에서는 이 파라미터를 넣지 않음
2. `useIsAdmin() === true` 여야 함 — 고객 JWT 토큰은 ADMIN/SUPER_ADMIN 역할이 아니므로 자동 false

따라서 PHP 측이 기존처럼 `?productId=...&token=<customer_jwt>` 또는 `?templateSetId=...&token=<customer_jwt>` 로 호출하면 종전과 동일하게 고객 모드로 진입합니다.

## 3. 부수 효과 — Admin 디폴트 디자인 자동 적용 (긍정적)

Admin 이 "템플릿셋 수정" 으로 모든 페이지에 디자인을 입혀두면, 그 templateSetId 로 진입하는 고객은 **자동으로 그 디자인을 베이스로** 편집을 시작합니다 (templates.canvas_data 가 갱신됐으므로).

이전에는 admin 이 "에디터" 진입 후 저장해도 `editor_designs` 에 admin 본인 작품만 따로 생성되어 고객에게 노출되지 않았습니다.

## 4. PHP 측에서 확인할 것 (선택)

특별한 조치는 필요 없지만, 운영 중 다음을 모니터링하면 좋습니다:

- 고객이 templateSet 으로 첫 진입했을 때 빈 캔버스가 아니라 admin 이 입혀둔 디폴트 디자인이 잘 보이는지
- 저장 흐름은 그대로 `editSessionsApi` (iframe embed) 또는 standalone 모드로 동작

## 5. 관련 코드

- 라벨/URL: `apps/admin/src/pages/TemplateSets/TemplateSetList.tsx`
- Admin 분기 인식: `apps/editor/src/views/EditorView.tsx` (`isAdminTemplateSetEdit`)
- 저장 훅: `apps/editor/src/hooks/useTemplateSetSave.ts`
- Header 분기: `apps/editor/src/components/editor/EditorHeader.tsx` (`handleSaveForAdmin`)

## 6. 변경 이력

- 2026-05-10 — 최초 통보
