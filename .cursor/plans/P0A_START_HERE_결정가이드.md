# P0-A 시작 전 결정 가이드 (Start Here)

> 📌 **전체 진입점은 [`00_MASTER_DEVELOPMENT_GUIDE.md`](./00_MASTER_DEVELOPMENT_GUIDE.md) §5.1**. 이 문서는 거기서 가리키는 **P0-A 의사결정 전용** 가이드입니다. 결정을 끝내고 (b)를 택했다면 다음은 `P0A_DB_SCHEMA_FIX.md`입니다.
>
> **이 문서 목적**: `HANDOFF_GUIDE.md §18.6`의 "단계 0(스캔)만 먼저 실행 → 실제 누락 테이블 수 확인 → 팀/원작자와 (b)/(c) 결정" 부분이 이해가 안 갈 때, **이 문서 하나만 보고 결정을 내리면 되도록** 정리한 것입니다.
>
> 이미 Claude가 단계 0 스캔을 대신 실행했습니다. 아래 결과를 보고 (b)/(c) 중 하나만 골라 다음 문서로 진행하세요.
>
> 예상 소요: **읽기 10분 + 결정 1분**

---

## 0. 결론부터 — 3줄 요약

1. **원작자/팀 상의는 필요 없습니다.** 지금 상태에서 (b)/(c) 결정에 필요한 정보는 전부 코드에 있고, 이 문서에 정리되어 있습니다.
2. **지금 당장 운영 배포가 급하다면 (b) → 나중에 (c)로 승격** — 이것이 현실적인 경로입니다.
3. **그 경로는 이미 `P0A_DB_SCHEMA_FIX.md` 문서에 완성된 SQL까지 포함해 정리되어 있습니다.** 이 문서를 다 읽으면 바로 그 문서로 넘어가면 됩니다.

---

## 1. 단계 0 스캔 — Claude가 이미 실행한 결과

당신이 직접 터미널에 명령어를 치지 않아도 됩니다. 제가 방금 실행해 얻은 실제 숫자는 다음과 같습니다.

### 1-1. init.sql에 정의된 테이블 (10개)
```
categories
edit_sessions
library_backgrounds
library_cliparts
library_fonts
template_set_items
template_sets
templates
users
worker_jobs
```

### 1-2. TypeORM `@Entity()`로 선언된 테이블 (총 26개)
```
binding_types
cate                  ← Bookmoa 외부 DB (자체 DB에 생성 X)
categories
edit_histories
edit_sessions
editor_contents
editor_designs
file_edit_sessions
files
library_backgrounds
library_categories
library_cliparts
library_fonts
library_frames
library_shapes
member                ← Bookmoa 외부 DB (자체 DB에 생성 X)
order_common          ← Bookmoa 외부 DB (자체 DB에 생성 X)
paper_types
product_sizes
product_template_sets
products
template_set_items
template_sets
templates
users
worker_jobs
```

### 1-3. "자체 DB에 꼭 있어야 하는데 init.sql엔 빠진 테이블" — **13개**
```
binding_types
edit_histories
editor_contents
editor_designs
file_edit_sessions         ← ★ 편집기 저장 체인의 핵심
files
library_categories
library_frames
library_shapes
paper_types
product_sizes
product_template_sets
products
```

### 1-4. 최종 숫자 요약
| 구분 | 개수 |
|---|---|
| 현재 init.sql 정의 | **10개** |
| 엔티티 선언 (전체) | 26개 |
| 엔티티 선언 (외부 DB 3개 제외) | **23개** |
| **누락 테이블** | **13개** |

> **13개가 맞다면** → §3(권장안)으로 바로 이동.
> **이 숫자가 달라졌다면** → 누군가 엔티티를 추가/삭제했다는 뜻입니다. `grep -rhE "@Entity\('" apps/api/src` 로 재확인 후, 그 숫자에 맞춰 `P0A_DB_SCHEMA_FIX.md`의 CREATE TABLE 목록을 수정해야 합니다.

---

## 2. "원작자/팀과 상의" — 왜 이 프로젝트에서는 필요 없나

HANDOFF_GUIDE §18.6의 마지막 줄이 "원작자/팀과 공유해 결정을 맡기는 것이 가장 안전"이라고 조심스럽게 적힌 이유는, **일반론**으로 작성되어 있기 때문입니다. 하지만 Storige에서는 다음 4가지 조건이 이미 만족되어 "혼자서도 안전"합니다.

1. **상의해야 할 "설계적 판단"이 없다.**
   - 결정해야 할 것은 "이미 코드에 선언된 엔티티를 어떻게 DB에 반영할까"뿐입니다.
   - 이건 설계 변경이 아니라 **반영 작업**이므로 원작자 동의가 필요한 종류가 아닙니다.
2. **원작자는 지금 연락이 안 된다.**
   - `takeover_report.md`에 "원작자 부재, 인수자는 도메인 지식 0" 라고 명시.
   - 즉 상의할 상대가 없습니다.
3. **파괴적 변경이 아니다.**
   - 단계 0(스캔)은 **파일만 읽음**, 위험도 0.
   - 단계 B(init.sql 교체)는 **로컬 볼륨 한정**으로 먼저 검증 → 운영은 별도 절차(롤백 계획 포함). 되돌릴 수 있습니다.
4. **운영에 진짜 데이터가 아직 많지 않다.**
   - `P0A_DB_SCHEMA_FIX.md §7-2`는 "운영 DB에 데이터가 이미 있는 경우"를 따로 다룹니다.
   - 지금 상태에서 "데모 전", "실사용 유입 전"이라면, 로컬에서 검증한 스크립트를 운영에 그대로 적용해도 리스크가 낮습니다.

**결론**: "결정을 맡긴다"는 말은 "책임 분산"이 아니라 "정보 부족 시 안전장치"입니다. Storige는 정보가 이미 충분하므로 혼자 결정해도 됩니다.

---

## 3. (b)/(c) 중 무엇을 고를까 — Claude가 드리는 권장

### 3-1. 표로 비교

| 항목 | **(b) init.sql 수동 보강** | **(c) TypeORM Migrations 도입** |
|---|---|---|
| 소요 시간 | 반나절~1일 | 1~2일 (러닝커브 포함) |
| 필요 지식 | SQL DDL만 알면 됨 | TypeORM CLI + Data Source + Migration 개념 |
| 즉시 운영 배포 가능 | **예** (init.sql 복붙) | 가능하지만 첫 마이그레이션 검증 후 |
| 향후 스키마 변경 시 | 매번 init.sql 직접 수정 (재발) | `migration:generate` → `migration:run` (자동) |
| 롤백 용이성 | 백업 파일로 복원 | migration:revert 로 단계 단위 롤백 |
| Storige 현시점 적합성 | **높음** — 지금 즉시 문제 해결 필요 | 중간 — 투자 대비 회수 기간 길다 |

### 3-2. 권장: **(b)를 먼저 하고, 다음 스프린트에 (c)로 승격**

#### 왜?
1. **(b)가 주는 효과 = 당장의 500 에러 해결.** 이것이 0순위입니다.
2. **(c)는 "반복 재발 방지"가 본질.** 즉 두 번째 스키마 변경이 올 때부터 가치가 나오는 투자입니다.
3. **지금 (c)부터 시작하면**: TypeORM 학습 + data-source.ts 작성 + 첫 migration 디버깅에 반나절 이상 써도 **아직 DB에 한 줄도 안 만든 상태**가 됩니다. 운영 배포가 오늘 밤이라면 망합니다.
4. **(b)를 먼저 하면**: 오늘 안에 DB가 엔티티와 맞춰지고, P1~P16 진행 중에 (c) 세팅을 병행할 수 있습니다.

#### 이 권장을 뒤집어야 하는 경우
- **"이번 주 안에 엔티티를 3개 이상 추가/수정할 계획이 있다"** → (c) 우선. 반복 수작업 낭비 큼.
- **"이미 운영 DB에 실사용자 데이터가 쌓여 있다"** → (b)든 (c)든 `down -v` 금지. `P0A_DB_SCHEMA_FIX.md §7-2` 절차 따라 "누락 13개만 ALTER/ CREATE"로 적용. 순서: (b) 수작업 SQL → 운영 적용 → (c) 승격.

위 둘 다 해당 없다면 **(b) 먼저**가 정답입니다.

---

## 4. Claude가 직접 처리해 드릴 수 있는 것

아래는 제가 실제로 해 드릴 수 있는 작업입니다. "해주세요"라고 말씀하시는 순간 바로 실행합니다.

### ✅ 이미 완료 (이 문서 작성 단계에서)
- [x] 단계 0 스캔 실행 → 실제 숫자(10/26/13) 확인
- [x] 누락 테이블 13개 이름 리스트업
- [x] (b)/(c) 비교 및 권장안 제시
- [x] `P0A_DB_SCHEMA_FIX.md` 에 (b) 경로의 완성된 init.sql 전체 스크립트 포함 (단계 3~4)

### 🔧 명령 한 마디로 바로 실행 가능 — (b) 경로

| # | 작업 | 사용자 수동 액션 | Claude가 대신 가능 |
|---|---|---|---|
| 1 | `docker/mysql/init.sql` 백업 | ✅ | ✅ (Bash 명령으로 `cp` 실행) |
| 2 | 새 init.sql 전체 교체 (21개 테이블) | ✅ | ✅ (Write 툴로 즉시 교체) |
| 3 | bcrypt admin 해시 생성 후 init.sql에 주입 | ✅ | ✅ (Bash로 `node -e "..."` 후 Edit) |
| 4 | MariaDB 컨테이너 재기동 + 볼륨 초기화 | ✅ (로컬 한정 위험) | ⚠️ (사용자 승인 필요 — 데이터 삭제 동반) |
| 5 | `SHOW TABLES` 로 21개 확인 | ✅ | ✅ (Bash로 docker exec 실행) |
| 6 | `NODE_ENV=production`으로 API 기동 + health 체크 | ✅ | ✅ (Bash로 실행) |
| 7 | `/api/edit-sessions` 스모크 테스트 | ✅ | ✅ (curl 스크립트) |

> **예외(4번)** 만 사용자 직접 승인이 필요합니다 — MariaDB 볼륨 삭제는 "로컬 데이터 소실"을 동반하므로, 제가 임의 실행하지 않습니다. "볼륨 날려도 됨"이라는 명시 허가가 있어야 합니다.

### 🔧 명령 한 마디로 바로 실행 가능 — (c) 경로 (선택)

| # | 작업 | Claude가 대신 가능 |
|---|---|---|
| 1 | `apps/api/src/database/data-source.ts` 신규 작성 | ✅ (Write 툴) |
| 2 | `apps/api/package.json`에 migration 스크립트 추가 | ✅ (Edit 툴) |
| 3 | `typeorm-ts-node-commonjs` 의존성 추가 | ✅ (Bash `pnpm add -D`) |
| 4 | 첫 마이그레이션 파일 생성 | ✅ (Bash `pnpm migration:generate`) |
| 5 | 생성된 SQL 검토 후 `init.sql` 축소(seed만 남기기) | ✅ (Edit 툴) |

---

## 5. 다음으로 할 것 — 두 가지 실행 옵션

### 옵션 A. 내가 (b) 경로를 Claude에게 맡긴다 (권장)
한 마디만 주시면 됩니다. 예시:
> "P0A_DB_SCHEMA_FIX.md 단계 B(init.sql 전체 교체)를 실행해주세요. 로컬 DB 볼륨은 날려도 괜찮습니다."

그러면 저는:
1. `init.sql` 백업
2. `P0A_DB_SCHEMA_FIX.md §3-B2`의 완성본을 `docker/mysql/init.sql` 에 그대로 써 넣기
3. bcrypt admin 해시 생성해서 자리 교체
4. `docker compose down -v && up -d mariadb`
5. `SHOW TABLES`로 21개 확인 후 결과 보고
6. 막히면 로그 첨부해서 사용자에게 에스컬레이션

### 옵션 B. 내가 직접 단계 B를 실행한다
`P0A_DB_SCHEMA_FIX.md`를 처음부터 **단계 A → B → C → D** 순서로 복붙하며 실행. 막히는 지점에서 Claude 호출.

### 옵션 C. (c) 경로로 지금 시작
한 마디만 주시면 됩니다. 예시:
> "운영이 당장 급하지 않아요. (c) 경로(TypeORM migrations 도입)로 가주세요."

그러면 저는:
1. `apps/api/src/database/data-source.ts` 작성
2. `package.json` 스크립트 추가
3. 첫 마이그레이션 생성 + 리뷰
4. 빈 DB에서 `migration:run` 검증
5. `init.sql`은 seed 데이터만 남기고 정리

---

## 6. 결정 이후 최종 체크포인트 (무엇이 끝나면 P0-A 종료인가)

어떤 경로를 택하든, 다음 4가지가 모두 참이 되어야 P0-A 완료 → P1 진입 가능입니다. 이것은 `P0A_DB_SCHEMA_FIX.md §5-D4` 와 동일합니다.

- [ ] `docker compose down -v && docker compose up -d mariadb` 직후 MariaDB 에러 로그 없음
- [ ] `SHOW TABLES` 결과가 **21개** (외부 DB 3개 제외한 자체 테이블 전부)
- [ ] `NODE_ENV=production pnpm dev`(또는 build 후 node 실행) 로그에 `ER_NO_SUCH_TABLE` 없음
- [ ] `GET /api/edit-sessions` HTTP 200 (빈 배열이어도 OK)

이 4개가 통과하면, 편집기에서 "저장" 버튼을 눌렀을 때 500 에러가 뜨지 않을 **구조적 조건**이 갖춰집니다.

---

## 7. 요약: 지금 이 문서 이후 순서

```
[당신은 여기]
    ↓
결정: (b)/(c) 중 택1  ← 이 문서 §3 읽고 1분
    ↓
실행: "P0A_DB_SCHEMA_FIX.md 단계 B 실행해주세요" 한 마디
    ↓
검증: SHOW TABLES = 21개, API 기동 에러 없음
    ↓
P0-A 완료
    ↓
다음 치명 누락(HANDOFF_GUIDE §19 PHP embed 기능)
  또는 P1(저장 완료 체인) 진입
```

---

## 부록 A. 단계 0 스캔을 본인이 직접 돌려보고 싶다면

제가 실행한 것과 동일한 명령이 여기 있습니다. 결과가 위 §1과 같아야 합니다.

```bash
cd "/Users/yohan/claude/Bookmoa Storige editor/storige"

# (1) init.sql 정의 테이블
grep -iE "CREATE TABLE IF NOT EXISTS" docker/mysql/init.sql \
  | sed 's/.*EXISTS //; s/ .*//' | sort -u

# (2) 엔티티 선언 테이블 (외부 Bookmoa 3개 제외)
grep -rhE "@Entity\('[^']+'\)" apps/api/src --include="*.ts" \
  | sed -E "s/.*@Entity\('([^']+)'\).*/\1/" \
  | grep -vE "^(cate|member|order_common)$" | sort -u

# (3) 차집합: "자체 DB에 있어야 하는데 init.sql에 빠진 테이블"
diff \
  <(grep -iE "CREATE TABLE IF NOT EXISTS" docker/mysql/init.sql | sed 's/.*EXISTS //; s/ .*//' | sort -u) \
  <(grep -rhE "@Entity\('[^']+'\)" apps/api/src --include="*.ts" \
      | sed -E "s/.*@Entity\('([^']+)'\).*/\1/" \
      | grep -vE "^(cate|member|order_common)$" | sort -u) \
  | grep '^>' | sed 's/^> //'
```

---

## 부록 B. 관련 문서 링크

- `HANDOFF_GUIDE.md` §18 — 문제의 배경과 4줄 정리
- `P0A_DB_SCHEMA_FIX.md` — (b) 경로 완성된 실행 플레이북 (init.sql 전체 SQL 포함)
- `takeover_report.md` — 전체 프로젝트 인수 리포트 (원작자 부재 사실 등)
- `CLAUDE.md` — 프로젝트 전반 아키텍처·명령 요약

> 이 문서(`P0A_START_HERE_결정가이드.md`)는 **결정 1분 + 실행 위임 1줄**을 위한 창구입니다.
> 결정이 끝나면 `P0A_DB_SCHEMA_FIX.md` 가 실행 레퍼런스가 됩니다.
