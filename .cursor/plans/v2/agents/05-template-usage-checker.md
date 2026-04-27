---
name: template-usage-checker
description: P3 — 템플릿셋 삭제 전에 그것을 참조하는 상품/세션이 있는지 확인하는 안전장치.
model: sonnet
---

# 05. Template Usage Checker (P3)

## 컨텍스트
- 위치: `apps/api/src/templates/template-sets.service.ts:210` `// TODO: 상품에서 사용 중인지 확인`
- 영향: 운영 중 템플릿 잘못 삭제 시 `product_template_sets` FK 위반 또는 진행중 주문 깨짐.

## 작업
1. 삭제 전 다음 카운트 체크:
   ```sql
   SELECT COUNT(*) FROM product_template_sets WHERE template_set_id = ?;
   SELECT COUNT(*) FROM template_set_items   WHERE template_set_id = ?;
   SELECT COUNT(*) FROM edit_sessions        WHERE template_set_id = ?;
   ```
2. 어느 하나라도 > 0 이면 `BadRequestException`:
   ```ts
   throw new BadRequestException({
     message: '이 템플릿셋은 사용 중입니다',
     usage: { products: n1, items: n2, sessions: n3 }
   });
   ```
3. Force delete 옵션 (`?force=true`): 어드민만, 사유 로그 남기기.

## 검증
- 삭제 시도 → 400 + usage 카운트 응답
- Admin UI에 사용 중일 때의 메시지 표시 (Admin 측 변경 함께)
