# API DB Migrations

> Production / staging 환경에서 init.sql 로 이미 생성된 DB 에 컬럼/인덱스를 추가하기 위한 SQL 모음.
>
> Development 환경은 `TypeORM synchronize=true` (apps/api/src/app.module.ts:55) 로 엔티티 변경이 자동 반영되므로 본 디렉토리의 SQL 을 적용할 필요가 없습니다.

## 적용 방법

### Docker Compose 환경

```bash
docker-compose exec mysql mysql -uroot -p storige \
  < apps/api/migrations/20260501_add_products_allowCustomSize.sql
```

### Production DB 직접 실행

```bash
mysql -h <DB_HOST> -P <DB_PORT> -u <DB_USER> -p storige \
  < apps/api/migrations/20260501_add_products_allowCustomSize.sql
```

### 적용 확인

```sql
SHOW COLUMNS FROM products LIKE 'allowCustomSize';
-- Field 이 노출되면 성공
```

## 마이그레이션 목록

| 일자 | 파일 | 내용 |
|---|---|---|
| 2026-05-01 | [`20260501_add_products_allowCustomSize.sql`](./20260501_add_products_allowCustomSize.sql) | `products.allowCustomSize` BOOLEAN 컬럼 추가 (옵션 C — 외부 쇼핑몰 사이즈 override 허용) |

## 신규 환경 셋업

신규 환경에서는 `docker/mysql/init.sql` 만 실행하면 모든 컬럼이 포함된 상태로 시작합니다. 본 디렉토리의 SQL 은 누적 적용할 필요 없음.

## 향후 자동화

- TypeORM CLI 의 `migration:generate` 도입 검토
- 또는 Liquibase / Flyway 같은 마이그레이션 툴 도입
- 현재는 수동 SQL 위주 — production 변경이 빈번하지 않은 단계 한정
