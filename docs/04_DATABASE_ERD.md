# Storige 데이터베이스 ERD

## 문서 개요

| 항목 | 내용 |
|------|------|
| 작성일 | 2025-12-21 |
| 데이터베이스 | MariaDB 11.2 |
| ORM | TypeORM (synchronize mode in dev) |

---

## 1. 전체 ERD 개요

```mermaid
erDiagram
    %% 사용자 및 인증
    users ||--o{ templates : creates

    %% 상품 도메인
    products ||--o{ product_sizes : has
    products }o--|| template_sets : uses

    %% 템플릿 도메인
    categories ||--o{ categories : parent-child
    categories ||--o{ templates : belongs
    categories ||--o{ template_sets : belongs
    template_sets ||--o{ template_set_items : contains
    template_set_items }o--|| templates : references

    %% 편집 세션 도메인
    file_edit_sessions ||--o{ worker_jobs : creates
    file_edit_sessions }o--o| files : cover_file
    file_edit_sessions }o--o| files : content_file

    %% 책등 계산
    paper_types
    binding_types

    %% 라이브러리
    library_categories ||--o{ library_cliparts : has
    library_categories ||--o{ library_frames : has
    library_categories ||--o{ library_shapes : has
    library_categories ||--o{ library_backgrounds : has
```

---

## 2. 도메인별 상세 ERD

### 2.1 인증 및 사용자 도메인

```mermaid
erDiagram
    users {
        varchar(36) id PK "UUID"
        varchar(255) email UK "이메일"
        varchar(255) password_hash "비밀번호 해시"
        varchar(20) role "customer|admin|superadmin"
        timestamp created_at
        timestamp updated_at
    }
```

**테이블 설명:**
- `users`: 시스템 사용자 (관리자, 에디터 사용자)

---

### 2.2 상품 도메인

```mermaid
erDiagram
    products {
        uuid id PK
        varchar(255) title "상품명"
        varchar(255) product_id "외부 상품 ID"
        text description "설명"
        json template "에디터 프리셋"
        json editor_templates "에디터 템플릿 목록"
        boolean is_active "활성 여부"
        varchar(36) template_set_id FK "템플릿셋 ID"
        timestamp created_at
        timestamp updated_at
    }

    product_sizes {
        uuid id PK
        uuid product_id FK "상품 ID"
        int size_no "사이즈 번호"
        varchar(100) size_name "사이즈명"
        float width "가로 (mm)"
        float height "세로 (mm)"
        float cut_size "재단선 (mm)"
        float safe_size "안전선 (mm)"
        boolean non_standard "비규격 여부"
        json req_width "가로 범위 제한"
        json req_height "세로 범위 제한"
        timestamp created_at
        timestamp updated_at
    }

    products ||--o{ product_sizes : has
```

**테이블 설명:**
- `products`: 인쇄 상품 정보 (와우프레스 연동)
- `product_sizes`: 상품별 사이즈 옵션

---

### 2.3 책등 계산 도메인 (Spine)

```mermaid
erDiagram
    paper_types {
        uuid id PK
        varchar(50) code UK "mojo_80g, art_200g 등"
        varchar(100) name "모조지 80g 등"
        decimal(5_3) thickness "두께 (mm)"
        varchar(20) category "body|cover"
        boolean is_active "활성 여부"
        int sort_order "정렬 순서"
        timestamp created_at
        timestamp updated_at
    }

    binding_types {
        uuid id PK
        varchar(50) code UK "perfect, saddle 등"
        varchar(100) name "무선제본 등"
        decimal(5_2) margin "제본 마진 (mm)"
        int min_pages "최소 페이지 수"
        int max_pages "최대 페이지 수"
        int page_multiple "페이지 배수"
        boolean is_active "활성 여부"
        int sort_order "정렬 순서"
        timestamp created_at
        timestamp updated_at
    }
```

**테이블 설명:**
- `paper_types`: 용지 종류 및 두께 정보 (책등 폭 계산용)
- `binding_types`: 제본 방식 및 마진 정보 (책등 폭 계산용)

**책등 폭 계산 공식:**
```
책등 폭 = (페이지수 / 2) × 종이 두께 + 제본 여유분
```

**초기 데이터:**

| 용지 코드 | 용지명 | 두께 (mm) | 카테고리 |
|----------|--------|-----------|---------|
| mojo_70g | 모조지 70g | 0.09 | body |
| mojo_80g | 모조지 80g | 0.10 | body |
| seokji_70g | 서적지 70g | 0.10 | body |
| newsprint_45g | 신문지 45g | 0.06 | body |
| art_200g | 아트지 200g | 0.18 | cover |
| matte_200g | 매트지 200g | 0.20 | cover |
| card_300g | 카드지 300g | 0.35 | cover |
| kraft_120g | 크라프트지 120g | 0.16 | cover |

| 제본 코드 | 제본명 | 마진 (mm) | 최소 페이지 | 최대 페이지 | 페이지 배수 |
|----------|--------|-----------|------------|------------|-----------|
| perfect | 무선제본 | 0.5 | 32 | - | - |
| saddle | 중철제본 | 0.3 | - | 64 | 4 |
| spiral | 스프링제본 | 3.0 | - | - | - |
| hardcover | 양장제본 | 2.0 | - | - | - |

---

### 2.4 템플릿 도메인

```mermaid
erDiagram
    categories {
        varchar(36) id PK
        varchar(255) name "카테고리명"
        varchar(20) code UK "고유 코드"
        varchar(36) parent_id FK "상위 카테고리"
        tinyint level "1|2|3"
        int sort_order "정렬 순서"
        timestamp created_at
    }

    template_sets {
        varchar(36) id PK
        varchar(255) name "템플릿셋명"
        varchar(500) thumbnail_url "썸네일 URL"
        varchar(20) type "book|leaflet"
        float width "가로 (mm)"
        float height "세로 (mm)"
        boolean can_add_page "내지 추가 가능"
        json page_count_range "페이지 수 범위"
        json templates "템플릿 구성 JSON"
        boolean is_deleted "소프트 삭제"
        text description "설명"
        varchar(36) category_id FK
        json product_specs "상품 스펙"
        boolean is_active
        json enabled_menus "도구메뉴 화이트리스트(null=전체노출)"
        json endpaper_config "면지 구성(front/back count·editable)"
        boolean cover_editable "표지 편집 가능(레더커버=false)"
        varchar(500) cover_preview_image "레더커버 미리보기 이미지"
        boolean content_pdf_editable "내지 첨부PDF 편집 가능"
        varchar(20) pdf_output_mode "PDF출력: single|duplex-merged|duplex-split (2026-06-09)"
        timestamp created_at
        timestamp updated_at
    }

    template_set_items {
        varchar(36) id PK
        varchar(36) template_set_id FK
        varchar(36) template_id FK
        int sort_order "정렬 순서"
        boolean required "필수 페이지 여부"
    }

    template_set_library_categories {
        varchar(36) id PK
        varchar(36) template_set_id FK "템플릿셋(CASCADE)"
        varchar(36) library_category_id "라이브러리 카테고리"
        int sort_order "정렬 순서"
        timestamp created_at
    }

    templates {
        varchar(36) id PK
        varchar(255) name "템플릿명"
        varchar(500) thumbnail_url "썸네일 URL"
        varchar(20) type "wing|cover|spine|page"
        float width "가로 (mm)"
        float height "세로 (mm)"
        boolean editable "편집 가능"
        boolean deleteable "삭제 가능"
        json canvas_data "Fabric.js 캔버스 데이터"
        boolean is_deleted "소프트 삭제"
        varchar(36) category_id FK
        varchar(50) edit_code UK
        varchar(50) template_code UK
        boolean is_active
        varchar(36) created_by FK
        timestamp created_at
        timestamp updated_at
    }

    categories ||--o{ categories : parent
    categories ||--o{ template_sets : belongs
    categories ||--o{ templates : belongs
    template_sets ||--o{ template_set_items : contains
    template_set_items }o--|| templates : references
    template_sets ||--o{ template_set_library_categories : curates
    library_categories ||--o{ template_set_library_categories : scoped_by
    users ||--o{ templates : creates
```

**테이블 설명:**
- `categories`: 계층형 카테고리 (3단계까지)
- `template_sets`: 템플릿 묶음 (책자 구성). `pdf_output_mode`로 PDF 출력방식(단면/양면-원파일/양면-파일분리) 설정(2026-06-09)
- `template_set_items`: 템플릿셋-템플릿 연결
- `template_set_library_categories`: 템플릿셋↔라이브러리 카테고리 연결(에셋 큐레이션, 2026-06-09). 연결 없으면 전역(모든 에셋 노출), 있으면 그 카테고리만. FK CASCADE
- `templates`: 개별 템플릿 (표지, 내지, 책등 등)

**템플릿 타입:**
| 타입 | 설명 |
|------|------|
| wing | 날개 |
| cover | 표지 |
| spine | 책등 |
| page | 내지 |

---

### 2.5 편집 세션 도메인

```mermaid
erDiagram
    file_edit_sessions {
        uuid id PK
        bigint order_seqno "bookmoa 주문번호"
        bigint member_seqno "bookmoa 회원번호"
        enum status "draft|editing|complete"
        enum mode "cover|content|both|template"
        uuid cover_file_id FK
        uuid content_file_id FK
        varchar(36) template_set_id "템플릿셋 ID"
        json canvas_data "캔버스 데이터"
        json metadata "메타데이터"
        timestamp completed_at
        enum worker_status "pending|processing|validated|failed"
        text worker_error
        varchar(500) callback_url
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at "소프트 삭제"
    }

    files {
        uuid id PK
        varchar(255) file_name "저장 파일명"
        varchar(255) original_name "원본 파일명"
        varchar(500) file_path "파일 경로"
        varchar(500) file_url "접근 URL"
        varchar(500) thumbnail_url "썸네일 URL"
        bigint file_size "파일 크기 (bytes)"
        varchar(100) mime_type "MIME 타입"
        enum file_type "cover|content|template|other"
        bigint order_seqno "주문번호"
        bigint member_seqno "회원번호"
        json metadata
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at "소프트 삭제"
    }

    worker_jobs {
        varchar(36) id PK
        varchar(30) job_type "validation|conversion|synthesis"
        varchar(20) status "pending|processing|completed|failed"
        varchar(36) edit_session_id FK
        varchar(36) file_id
        varchar(500) input_file_url
        varchar(500) output_file_url
        varchar(36) output_file_id
        json options "작업 옵션"
        json result "작업 결과"
        text error_message
        timestamp created_at
        timestamp completed_at
    }

    file_edit_sessions }o--o| files : cover_file
    file_edit_sessions }o--o| files : content_file
    file_edit_sessions ||--o{ worker_jobs : creates
```

**테이블 설명:**
- `file_edit_sessions`: 편집 세션 (bookmoa 주문과 연결)
- `files`: 업로드된 파일 메타데이터
- `worker_jobs`: PDF 처리 작업 큐

**세션 상태 흐름:**
```
draft → editing → complete
```

**워커 작업 타입:**
| 타입 | 설명 |
|------|------|
| validation | PDF 유효성 검증 |
| conversion | RGB → CMYK 변환 |
| synthesis | 표지+내지 병합 |

---

### 2.6 라이브러리 도메인

```mermaid
erDiagram
    library_categories {
        varchar(36) id PK
        varchar(255) name "카테고리명"
        varchar(50) type "clipart|frame|shape|background|font"
        varchar(36) parent_id FK
        int sort_order
        boolean is_active
        timestamp created_at
    }

    library_cliparts {
        varchar(36) id PK
        varchar(255) name "클립아트명"
        varchar(500) file_url "파일 URL"
        varchar(500) thumbnail_url "썸네일 URL"
        varchar(100) category "레거시 카테고리"
        varchar(36) category_id FK
        json tags "태그 배열"
        boolean is_active
        timestamp created_at
    }

    library_frames {
        varchar(36) id PK
        varchar(255) name
        varchar(500) file_url
        varchar(500) thumbnail_url
        varchar(36) category_id FK
        boolean is_active
        timestamp created_at
    }

    library_shapes {
        varchar(36) id PK
        varchar(255) name
        varchar(500) svg_data "SVG 데이터"
        varchar(36) category_id FK
        boolean is_active
        timestamp created_at
    }

    library_backgrounds {
        varchar(36) id PK
        varchar(255) name
        varchar(500) file_url
        varchar(500) thumbnail_url
        varchar(36) category_id FK
        boolean is_active
        timestamp created_at
    }

    library_fonts {
        varchar(36) id PK
        varchar(255) name "폰트명"
        varchar(255) family "폰트 패밀리"
        varchar(500) file_url "폰트 파일 URL"
        varchar(50) format "woff2|woff|ttf"
        boolean is_active
        timestamp created_at
    }

    library_categories ||--o{ library_categories : parent
    library_categories ||--o{ library_cliparts : has
    library_categories ||--o{ library_frames : has
    library_categories ||--o{ library_shapes : has
    library_categories ||--o{ library_backgrounds : has
```

**테이블 설명:**
- `library_categories`: 라이브러리 카테고리
- `library_cliparts`: 클립아트 리소스
- `library_frames`: 프레임 리소스
- `library_shapes`: 도형 리소스
- `library_backgrounds`: 배경 이미지 리소스
- `library_fonts`: 웹폰트 리소스

---

## 3. Bookmoa 연동 테이블 (참조용)

bookmoa PHP 시스템의 기존 테이블을 참조하는 뷰 엔티티입니다.

```mermaid
erDiagram
    bookmoa_categories {
        int seqno PK "카테고리 번호"
        varchar(255) name "카테고리명"
    }

    bookmoa_members {
        int seqno PK "회원 번호"
        varchar(255) id "회원 ID"
        varchar(255) name "회원명"
    }

    bookmoa_orders {
        int seqno PK "주문 번호"
        int member_seqno FK "회원 번호"
        varchar(20) status "주문 상태"
    }
```

**참고:** 이 테이블들은 bookmoa 시스템에서 관리되며, Storige에서는 읽기 전용으로 참조합니다.

---

## 4. 인덱스 정보

### 주요 인덱스

| 테이블 | 인덱스명 | 컬럼 | 설명 |
|--------|----------|------|------|
| templates | idx_template_type | type | 템플릿 타입 검색 |
| templates | idx_template_deleted | is_deleted | 삭제 필터링 |
| template_sets | idx_template_set_type | type | 템플릿셋 타입 검색 |
| template_sets | idx_template_set_deleted | is_deleted | 삭제 필터링 |
| files | idx_files_order_seqno | order_seqno | 주문별 파일 조회 |
| files | idx_files_member_seqno | member_seqno | 회원별 파일 조회 |

---

## 5. 데이터 흐름

```mermaid
flowchart TD
    subgraph Client["클라이언트"]
        Editor[에디터 프론트엔드]
    end

    subgraph API["Storige API"]
        Auth[인증]
        Products[상품 조회]
        Templates[템플릿 조회]
        Sessions[편집 세션]
        Spine[책등 계산]
    end

    subgraph Database["MariaDB"]
        users[(users)]
        products[(products)]
        template_sets[(template_sets)]
        templates[(templates)]
        file_edit_sessions[(file_edit_sessions)]
        files[(files)]
        paper_types[(paper_types)]
        binding_types[(binding_types)]
        worker_jobs[(worker_jobs)]
    end

    subgraph Worker["Worker"]
        Queue[Bull Queue]
        Processor[PDF 처리]
    end

    Editor --> Auth
    Editor --> Products
    Editor --> Templates
    Editor --> Sessions
    Editor --> Spine

    Auth --> users
    Products --> products
    Templates --> template_sets
    Templates --> templates
    Sessions --> file_edit_sessions
    Sessions --> files
    Spine --> paper_types
    Spine --> binding_types

    Sessions --> Queue
    Queue --> Processor
    Processor --> worker_jobs
    Processor --> files
```

---

## 6. 변경 이력

| 날짜 | 버전 | 변경 내용 |
|------|------|----------|
| 2025-12-21 | 1.0 | 초기 ERD 문서 작성 |
| 2025-12-21 | 1.1 | 책등 계산 도메인 (paper_types, binding_types) 추가 |
