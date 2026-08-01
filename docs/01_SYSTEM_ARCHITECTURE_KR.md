# 시스템 아키텍처 문서

> **문서 버전**: 2.0
> **작성일**: 2025-12-21
> **대상 시스템**: Storige + Bookmoa 통합 인쇄 쇼핑몰 시스템

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [전체 시스템 구성도](#2-전체-시스템-구성도)
3. [시스템 컴포넌트](#3-시스템-컴포넌트)
4. [네트워크 토폴로지](#4-네트워크-토폴로지)
5. [데이터 흐름](#5-데이터-흐름)
6. [인프라스트럭처](#6-인프라스트럭처)
7. [보안 아키텍처](#7-보안-아키텍처)
8. [확장성 및 고가용성](#8-확장성-및-고가용성)

---

## 1. 시스템 개요

### 1.1 시스템 목적

Storige-Bookmoa는 인쇄 상품의 온라인 편집 및 주문을 위한 통합 시스템입니다.

- **Bookmoa**: 레거시 PHP 기반 B2C 쇼핑몰 (주문, 결제, 회원 관리)
- **Storige**: 최신 TypeScript 기반 편집 시스템 (캔버스 편집, PDF 처리)

### 1.2 시스템 특징

| 특징 | 설명 |
|------|------|
| 하이브리드 아키텍처 | 레거시 PHP + 모던 Node.js 공존 |
| 마이크로서비스 지향 | API, Worker, Editor 분리 운영 |
| 비동기 처리 | Bull Queue 기반 PDF 처리 |
| 이중 인증 | API Key (서버간) + JWT (클라이언트) |

### 1.3 기술 스택 요약

```mermaid
mindmap
  root((Storige-Bookmoa))
    Bookmoa
      PHP 7.x+
      Nexmotion Framework
      ADODB
      Apache/Nginx
    Storige
      API
        NestJS
        TypeORM
        JWT
      Editor
        React
        Fabric.js
        Zustand
      Worker
        Bull Queue
        pdf-lib
        Ghostscript
    Infrastructure
      MariaDB 11.2
      Redis 7.2
      Docker
```

---

## 2. 전체 시스템 구성도

### 2.1 High-Level Architecture

```mermaid
graph TB
    subgraph "클라이언트 영역"
        C1[고객 브라우저]
        C2[관리자 브라우저]
    end

    subgraph "프론트엔드 레이어"
        F1[Bookmoa 쇼핑몰<br/>PHP + JS Bundle]
        F2[Storige Admin<br/>React :3001]
        F3[Storige Editor<br/>React :3000]
    end

    subgraph "API 레이어"
        A1[Bookmoa Backend<br/>PHP + Apache]
        A2[Storige API<br/>NestJS :4000]
    end

    subgraph "처리 레이어"
        W1[Storige Worker<br/>NestJS :4001]
        Q1[Bull Queue<br/>Redis]
    end

    subgraph "데이터 레이어"
        D1[(Bookmoa DB<br/>MariaDB)]
        D2[(Storige DB<br/>MariaDB)]
        D3[(Redis<br/>Cache/Queue)]
        D4[File Storage<br/>/app/storage]
    end

    C1 --> F1
    C2 --> F2
    C2 --> F3

    F1 -->|httpOnly Cookie| A2
    F1 -->|Session| A1
    F2 -->|JWT Bearer| A2
    F3 -->|JWT Bearer| A2

    A1 -->|X-API-Key| A2
    A2 --> Q1
    Q1 --> W1

    A1 --> D1
    A2 --> D2
    A2 --> D3
    W1 --> D2
    W1 --> D4
```

### 2.2 상세 구성도

```mermaid
graph TB
    subgraph "External"
        PG[결제 게이트웨이<br/>KG이니시스, 토스]
        CDN[CDN/정적 파일<br/>에디터 번들]
    end

    subgraph "Bookmoa Zone"
        direction TB
        BM_FE[Front<br/>고객 포털]
        BM_AD[Nimda<br/>관리자 포털]
        BM_CY[Cypress<br/>PDF 조판]

        BM_FE --> BM_DB
        BM_AD --> BM_DB
        BM_AD --> BM_CY
        BM_DB[(gprinting DB)]
    end

    subgraph "Storige Zone"
        direction TB
        ST_ED[Editor<br/>:3000]
        ST_AM[Admin<br/>:3001]
        ST_API[API<br/>:4000]
        ST_WK[Worker<br/>:4001]

        ST_ED --> ST_API
        ST_AM --> ST_API
        ST_API --> ST_DB
        ST_API --> ST_RD
        ST_RD --> ST_WK
        ST_WK --> ST_DB
        ST_WK --> ST_FS

        ST_DB[(Storige DB)]
        ST_RD[(Redis)]
        ST_FS[Storage]
    end

    BM_FE -->|JS Bundle| CDN
    BM_FE -->|결제| PG
    BM_FE -->|세션토큰/편집| ST_API
    BM_AD -->|PDF생성요청| ST_API
```

---

## 3. 시스템 컴포넌트

### 3.1 컴포넌트 매트릭스

| 컴포넌트 | 유형 | 포트 | 기술 스택 | 역할 |
|----------|------|------|-----------|------|
| Bookmoa Front | Web | 80/443 | PHP, JS | B2C 쇼핑몰 |
| Bookmoa Nimda | Web | 80/443 | PHP | B2B 관리자 |
| Storige Editor | SPA | 3000 | React, Fabric.js | 캔버스 편집기 |
| Storige Admin | SPA | 3001 | React, Ant Design | 템플릿/상품 관리 |
| Storige API | REST | 4000 | NestJS, TypeORM | 비즈니스 로직 |
| Storige Worker | Service | 4001 | NestJS, Bull | PDF 처리 |
| MariaDB | Database | 3306 | MariaDB 11.2 | 영구 저장소 |
| Redis | Cache/Queue | 6379 | Redis 7.2 | 캐시/큐 |

### 3.2 컴포넌트 의존성

```mermaid
graph LR
    subgraph "프론트엔드"
        E[Editor]
        A[Admin]
        B[Bookmoa]
    end

    subgraph "백엔드"
        API[Storige API]
        W[Worker]
    end

    subgraph "데이터"
        DB[(MariaDB)]
        R[(Redis)]
        FS[Storage]
    end

    E -->|REST| API
    A -->|REST| API
    B -->|REST| API

    API --> DB
    API --> R
    R -->|Bull| W
    W --> DB
    W --> FS

    style API fill:#f9f,stroke:#333
    style W fill:#bbf,stroke:#333
```

### 3.3 Bookmoa 내부 구조

```mermaid
graph TB
    subgraph "Bookmoa"
        subgraph "Front (B2C)"
            F_AJAX[ajax/]
            F_PROC[proc/]
            F_PAGE[pages/]
            F_PAY[webpay/]
        end

        subgraph "Nimda (B2B)"
            N_AJAX[ajax/]
            N_PROC[proc/]
            N_CY[cypress/]
            N_ENG[engine/]
        end

        subgraph "Common Libraries"
            INC_DAO[DAO Layer]
            INC_SM[StateManager]
            INC_PC[PriceCalculator]
            INC_FB[FormBean]
        end
    end

    F_AJAX --> INC_DAO
    F_PROC --> INC_DAO
    F_PROC --> INC_PC
    N_PROC --> INC_DAO
    N_PROC --> INC_SM
    N_CY --> N_ENG
```

### 3.4 Storige API 모듈 구조

```mermaid
graph TB
    subgraph "Storige API"
        subgraph "Core Modules"
            AUTH[Auth Module]
            USERS[Users Module]
        end

        subgraph "Business Modules"
            TMPL[Templates Module]
            TSET[TemplateSets Module]
            PROD[Products Module]
            SESS[EditSessions Module]
            JOBS[WorkerJobs Module]
            FILES[Files Module]
        end

        subgraph "Infrastructure"
            DB[TypeORM]
            REDIS[Redis]
            BULL[Bull Queue]
        end
    end

    AUTH --> USERS
    SESS --> AUTH
    TMPL --> TSET
    JOBS --> FILES
    JOBS --> BULL

    TMPL --> DB
    SESS --> DB
    JOBS --> DB
    JOBS --> REDIS
```

---

## 4. 네트워크 토폴로지

### 4.1 개발 환경

```mermaid
graph TB
    subgraph "Developer Machine"
        DEV[VS Code]
    end

    subgraph "Docker Network (storige-network)"
        BM_WEB[bookmoa-web<br/>:8080]

        subgraph "Host Services"
            ST_API[Storige API<br/>:4000]
            ST_WK[Worker<br/>:4001]
            ST_ED[Editor<br/>:3000]
            ST_AM[Admin<br/>:3001]
        end
    end

    subgraph "Docker Containers"
        DB[storige-mariadb<br/>:3306]
        RD[storige-redis<br/>:6379]
    end

    DEV --> ST_ED
    DEV --> ST_AM
    DEV --> BM_WEB

    BM_WEB -->|host.docker.internal| ST_API
    ST_API --> DB
    ST_API --> RD
    ST_WK --> DB
    ST_WK --> RD
```

### 4.2 프로덕션 환경

```mermaid
graph TB
    subgraph "Internet"
        USER[사용자]
    end

    subgraph "Load Balancer"
        LB[Nginx/Apache<br/>:80, :443]
    end

    subgraph "Application Servers"
        subgraph "PHP Server"
            PHP[Apache + mod_php]
        end

        subgraph "Node.js Cluster"
            API1[API Instance 1]
            API2[API Instance 2]
            WK1[Worker Instance 1]
            WK2[Worker Instance 2]
        end

        subgraph "Static Servers"
            ED[Editor Static]
            AM[Admin Static]
        end
    end

    subgraph "Data Layer"
        DB_M[(Master DB)]
        DB_S[(Slave DB)]
        REDIS[(Redis Cluster)]
        NFS[NFS Storage]
    end

    USER --> LB
    LB --> PHP
    LB --> API1
    LB --> API2
    LB --> ED
    LB --> AM

    API1 --> DB_M
    API2 --> DB_M
    DB_M --> DB_S
    API1 --> REDIS
    API2 --> REDIS
    WK1 --> REDIS
    WK2 --> REDIS
    WK1 --> NFS
    WK2 --> NFS
```

---

## 5. 데이터 흐름

### 5.1 고객 주문 플로우

```mermaid
sequenceDiagram
    autonumber
    participant U as 고객
    participant B as Bookmoa
    participant API as Storige API
    participant ED as Editor
    participant W as Worker
    participant DB as Database

    U->>B: 1. 로그인
    B->>DB: 회원 인증
    DB-->>B: 세션 생성

    U->>B: 2. 상품 선택 (책자 50페이지)
    U->>B: 3. 에디터 열기 클릭

    B->>API: 4. 세션 토큰 요청 (X-API-Key)
    API-->>B: 5. JWT 토큰 (Set-Cookie)

    B->>ED: 6. 에디터 로드<br/>(templateSetId, pageCount, paperType, bindingType)
    ED->>API: 7. 템플릿셋 조회
    API-->>ED: 8. 템플릿 데이터

    ED->>API: 9. 책등 폭 계산 요청
    API-->>ED: 10. spineWidth: 5.5mm

    Note over ED: 페이지수 자동 조정<br/>책등 리사이징

    U->>ED: 11. 편집 작업
    ED->>API: 12. 자동 저장 (30초마다)

    U->>ED: 13. 편집 완료
    ED->>API: 14. 세션 완료 처리
    ED-->>B: 15. onComplete 콜백

    B->>API: 16. PDF 업로드 (표지/내지)
    API-->>B: 17. fileId 반환

    B->>API: 18. PDF 병합 요청
    API->>W: 19. Bull Queue 작업 추가
    W->>W: 20. PDF 병합 처리
    W->>API: 21. 완료 콜백
    API->>B: 22. Webhook 전송

    U->>B: 23. 결제 진행
    B->>DB: 24. 주문 생성
```

### 5.2 PDF 처리 파이프라인

```mermaid
flowchart LR
    subgraph "입력"
        COVER[표지 PDF]
        CONTENT[내지 PDF]
        SPINE[책등 데이터]
    end

    subgraph "검증 단계"
        V1[사이즈 검증]
        V2[페이지수 검증]
        V3[해상도 검증]
    end

    subgraph "변환 단계"
        C1[재단선 추가]
        C2[빈페이지 삽입]
        C3[색상 변환]
    end

    subgraph "합성 단계"
        S1[표지+책등+후표지<br/>병합]
        S2[내지 병합]
        S3[최종 PDF 생성]
    end

    subgraph "출력"
        OUT[완성 PDF]
        THUMB[썸네일]
    end

    COVER --> V1
    CONTENT --> V2
    SPINE --> V3

    V1 --> C1
    V2 --> C2
    V3 --> C3

    C1 --> S1
    C2 --> S2
    C3 --> S1

    S1 --> S3
    S2 --> S3

    S3 --> OUT
    S3 --> THUMB
```

### 5.3 인증 흐름

```mermaid
sequenceDiagram
    participant B as Bookmoa (PHP)
    participant E as Editor (JS Bundle)
    participant A as Admin (React)
    participant API as Storige API

    Note over B,API: 시나리오 1: 쇼핑몰 → API (서버간)
    B->>API: POST /auth/shop-session<br/>X-API-Key: {key}
    API-->>B: { accessToken, expiresIn }
    B->>API: Set-Cookie: storige_access={token}

    Note over E,API: 시나리오 2: 에디터 번들 → API
    E->>API: GET /edit-sessions<br/>Cookie: storige_access={token}
    API-->>E: { sessions }

    Note over A,API: 시나리오 3: 관리자 → API
    A->>API: POST /auth/login<br/>{ email, password }
    API-->>A: { accessToken, refreshToken }
    A->>API: GET /templates<br/>Authorization: Bearer {token}
    API-->>A: { templates }
```

---

## 6. 인프라스트럭처

### 6.1 서버 사양 (권장)

| 서버 | CPU | RAM | Storage | 용도 |
|------|-----|-----|---------|------|
| Web Server | 4 Core | 8GB | 100GB SSD | Apache + PHP |
| API Server | 4 Core | 8GB | 50GB SSD | NestJS API |
| Worker Server | 8 Core | 16GB | 200GB SSD | PDF 처리 |
| DB Server | 4 Core | 16GB | 500GB SSD | MariaDB |
| Redis Server | 2 Core | 4GB | 20GB SSD | Cache/Queue |

### 6.2 Docker Compose 구성

```mermaid
graph TB
    subgraph "docker-compose.yml"
        subgraph "Services"
            MARIA[storige-mariadb<br/>mariadb:11.2]
            REDIS[storige-redis<br/>redis:7.2]
            API[storige-api<br/>node:22]
            WORKER[storige-worker<br/>node:22]
        end

        subgraph "Networks"
            NET[storige-network]
        end

        subgraph "Volumes"
            VOL_DB[mariadb_data]
            VOL_RD[redis_data]
            VOL_ST[storage_data]
        end
    end

    MARIA --> NET
    REDIS --> NET
    API --> NET
    WORKER --> NET

    MARIA --> VOL_DB
    REDIS --> VOL_RD
    WORKER --> VOL_ST
```

### 6.3 파일 스토리지 구조

```
/app/storage/
├── uploads/              # 업로드된 원본 파일
│   ├── {year}/
│   │   ├── {month}/
│   │   │   └── {uuid}.pdf
├── templates/            # 템플릿 에셋
│   └── {templateId}/
│       ├── canvas.json
│       └── thumbnail.png
├── outputs/              # 처리된 결과물
│   └── {jobId}/
│       ├── merged.pdf
│       └── preview.png
├── thumbnails/           # 썸네일
│   └── {uuid}.png
└── temp/                 # 임시 파일
    └── {sessionId}/
```

---

## 7. 보안 아키텍처

### 7.1 인증 체계

```mermaid
graph TB
    subgraph "인증 방식"
        A1[API Key<br/>서버 간 통신]
        A2[JWT Bearer<br/>관리자/에디터]
        A3[httpOnly Cookie<br/>고객 에디터]
        A4[PHP Session<br/>북모아 내부]
    end

    subgraph "저장 위치"
        S1[서버 환경변수]
        S2[localStorage]
        S3[브라우저 Cookie]
        S4[서버 Session]
    end

    subgraph "사용처"
        U1[Bookmoa → API]
        U2[Admin → API]
        U3[Editor Bundle → API]
        U4[Bookmoa 내부]
    end

    A1 --> S1
    A2 --> S2
    A3 --> S3
    A4 --> S4

    S1 --> U1
    S2 --> U2
    S3 --> U3
    S4 --> U4
```

### 7.2 보안 계층

| 계층 | 보안 조치 |
|------|----------|
| 네트워크 | HTTPS/TLS 1.3, Firewall, IP Whitelist |
| 애플리케이션 | JWT 인증, CORS, Rate Limiting |
| 데이터 | SQL Injection 방지, XSS 방지 |
| 파일 | MIME Type 검증, 파일 크기 제한 |

### 7.3 CORS 설정

```mermaid
graph LR
    subgraph "허용된 Origins"
        O1[bookmoa.noriter.co.kr]
        O2[localhost:3000]
        O3[localhost:3001]
    end

    subgraph "API Server"
        CORS[CORS Middleware]
    end

    O1 -->|credentials: true| CORS
    O2 -->|credentials: true| CORS
    O3 -->|credentials: true| CORS
```

---

## 8. 확장성 및 고가용성

### 8.1 수평 확장 전략

```mermaid
graph TB
    subgraph "Load Balancer"
        LB[Nginx]
    end

    subgraph "API Cluster"
        API1[API-1]
        API2[API-2]
        API3[API-3]
    end

    subgraph "Worker Pool"
        W1[Worker-1]
        W2[Worker-2]
        W3[Worker-3]
    end

    subgraph "Shared Resources"
        DB[(DB Master)]
        REDIS[(Redis)]
        NFS[NFS Storage]
    end

    LB --> API1
    LB --> API2
    LB --> API3

    REDIS --> W1
    REDIS --> W2
    REDIS --> W3

    API1 --> DB
    API2 --> DB
    API3 --> DB

    W1 --> NFS
    W2 --> NFS
    W3 --> NFS
```

### 8.2 장애 대응

| 컴포넌트 | 장애 시나리오 | 대응 방안 |
|----------|--------------|----------|
| API Server | 인스턴스 다운 | LB가 다른 인스턴스로 라우팅 |
| Worker | 프로세스 크래시 | PM2 자동 재시작 |
| Database | 마스터 다운 | 슬레이브 프로모션 |
| Redis | 메모리 부족 | 데이터 만료 정책 적용 |

### 8.3 백업 전략

```mermaid
gantt
    title 백업 스케줄
    dateFormat HH:mm
    section Database
    Full Backup     :done, 02:00, 1h
    Incremental     :active, 06:00, 30m
    Incremental     :active, 12:00, 30m
    Incremental     :active, 18:00, 30m
    section Files
    Storage Sync    :done, 03:00, 2h
    section Logs
    Log Rotation    :done, 00:00, 30m
```

---

## 부록

### A. 환경변수 목록

#### Storige API
```bash
# Database
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=storige
DATABASE_PASSWORD=****
DATABASE_NAME=storige

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=****
JWT_EXPIRES_IN=1h

# API Keys
API_KEYS=key1,key2,key3

# CORS
CORS_ORIGIN=https://bookmoa.noriter.co.kr
```

#### Bookmoa
```apache
SetEnv STORIGE_API_URL "http://localhost:4000/api"
SetEnv STORIGE_API_KEY "your-api-key"
SetEnv STORIGE_EDITOR_BUNDLE_URL "/storige-embed/editor-bundle.iife.js"
```

### B. 포트 매핑

| 서비스 | 개발 포트 | 프로덕션 포트 |
|--------|----------|--------------|
| Bookmoa | 8080 | 80/443 |
| Storige Editor | 3000 | 3000 |
| Storige Admin | 3001 | 3001 |
| Storige API | 4000 | 4000 |
| Storige Worker | 4001 | 4001 |
| MariaDB | 3306 | 3306 |
| Redis | 6379 | 6379 |

### C. 헬스체크 엔드포인트

| 엔드포인트 | 설명 |
|------------|------|
| `GET /health` | API 기본 상태 |
| `GET /health/db` | 데이터베이스 연결 |
| `GET /health/redis` | Redis 연결 |
| `GET /health/worker` | Worker 상태 |

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| 2.0 | 2025-12-21 | Mermaid 다이어그램 추가, 전면 개편 |
| 1.2 | 2024-12-14 | 개발환경 Apache 전환 |
| 1.0 | 2024-12-11 | 최초 작성 |
