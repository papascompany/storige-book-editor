---
name: backup-automation
description: VPS의 MariaDB와 storage 디렉터리를 매일 자동 백업하고, 단계 2에서 Cloudflare R2로 이중화한다.
model: sonnet
---

# 02. Backup Automation

## Step 1. 백업 스크립트 (VPS 로컬)

```bash
ssh deploy@158.247.235.202 'cat > ~/backup.sh <<EOF
#!/usr/bin/env bash
set -e
BACKUP_DIR=/home/deploy/backups
DATE=\$(date +%F_%H%M)
mkdir -p \$BACKUP_DIR

# 1) DB 덤프
source ~/storige/.env
docker exec storige-mariadb \\
  mariadb-dump -uroot -p\$MYSQL_ROOT_PASSWORD \\
  --single-transaction --routines --triggers storige \\
  | gzip > \$BACKUP_DIR/db-\$DATE.sql.gz

# 2) storage 디렉터리 (이미지/PDF)
tar czf \$BACKUP_DIR/storage-\$DATE.tar.gz -C ~/storige storage/

# 3) 7일 이전 파일 삭제
find \$BACKUP_DIR -type f -mtime +7 -delete

echo "[backup] \$DATE OK"
EOF
chmod +x ~/backup.sh'
```

## Step 2. 1회 수동 실행 + 검증

```bash
ssh deploy@158.247.235.202 '~/backup.sh && ls -lh ~/backups/'
```
- DoD: `db-XXXX.sql.gz` 와 `storage-XXXX.tar.gz` 두 파일 생성, 합 100MB 미만 (초기엔)

복구 리허설:
```bash
# 다른 임시 DB로 복구 테스트
gunzip -c ~/backups/db-XXXX.sql.gz | head -50  # SQL 머리만 확인
```

## Step 3. cron 등록 (매일 03:00 KST)

```bash
ssh deploy@158.247.235.202 '(crontab -l 2>/dev/null; echo "0 3 * * * /home/deploy/backup.sh >> /home/deploy/backup.log 2>&1") | crontab -'
ssh deploy@158.247.235.202 'crontab -l'
```

## Step 4. (선택, Week 3) Cloudflare R2 이중화

전제: Cloudflare 계정 + R2 활성화 + access key 발급.

```bash
# rclone 설치
ssh deploy@158.247.235.202 'curl https://rclone.org/install.sh | sudo bash'

# config (~/.config/rclone/rclone.conf)
ssh deploy@158.247.235.202 'rclone config'  # interactive: type=s3, provider=Cloudflare, ...

# 백업 스크립트에 추가
echo 'rclone copy $BACKUP_DIR r2:storige-backups/$(date +%Y/%m)/' >> ~/backup.sh
```

R2 무료 티어: 10 GB 저장 + 월 100만 클래스 A 작업 무료. DB 덤프 압축 100MB × 7 = 0.7GB → 충분.

## Step 5. 복구 절차 (재해 복구 리허설)

신규 VPS에서 복구하는 시나리오:

```bash
# 1) 새 VPS에 docker compose 설치 (Phase 1-3, 1-4 동일)
# 2) 레포 클론 + .env 복원 (.env는 별도 안전한 곳에 동기 보관)
# 3) DB 복원
docker compose up -d mariadb
docker exec -i storige-mariadb mariadb -uroot -p$MYSQL_ROOT_PASSWORD storige < db-XXXX.sql
# 4) storage 복원
tar xzf storage-XXXX.tar.gz -C ~/storige/
# 5) 나머지 컨테이너 기동
docker compose up -d
```

복구 시간 목표(RTO): 1시간 이내. 최근 백업 시점 손실(RPO): 24시간.

## DoD
- [ ] `~/backup.sh` 존재, 실행권한 OK
- [ ] cron 등록 확인 (`crontab -l`)
- [ ] 1회 수동 실행 성공
- [ ] backup.log에 첫 자동 실행 기록 (다음 03:00 후)
- [ ] (Week 3) R2 동기화 확인

## 산출물
- `~/backup.sh`, `~/backup.log`, `~/backups/*.gz`
- (옵션) Cloudflare R2 bucket `storige-backups`
