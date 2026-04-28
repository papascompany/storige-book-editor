#!/usr/bin/env bash
# storige operational self-monitor
# cron */5 * * * * — 5분마다
# 임계치 위반 시 monitor.log + monitor-alert.log + (옵션) DISCORD_WEBHOOK_URL

set -u
LOG=/home/deploy/storige/logs/monitor.log
ALERT=/home/deploy/storige/logs/monitor-alert.log
TS=$(date "+%Y-%m-%d %H:%M:%S %Z")

# .env 로드 (DISCORD_WEBHOOK_URL 등 옵션 변수)
set -a
source /home/deploy/storige/.env 2>/dev/null || true
set +a

alerts=()

# 1. API 헬스체크 (외부 https)
http=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 https://api.papascompany.co.kr/api/health 2>/dev/null || echo "000")
if [ "$http" != "200" ]; then
  alerts+=("API_HEALTH_FAIL http=$http")
fi

# 2. Bull 큐 적체 (waiting > 50)
for queue in pdf-validation pdf-conversion pdf-synthesis; do
  wait_count=$(docker exec storige-redis redis-cli LLEN "bull:$queue:wait" 2>/dev/null || echo 0)
  wait_count=${wait_count:-0}
  if [ "$wait_count" -gt 50 ]; then
    alerts+=("QUEUE_BACKLOG $queue=$wait_count")
  fi
done

# 3. 컨테이너 상태 (running 아니면 ALERT)
for svc in storige-api storige-worker storige-mariadb storige-redis storige-nginx; do
  status=$(docker inspect --format "{{.State.Status}}" "$svc" 2>/dev/null || echo "missing")
  if [ "$status" != "running" ]; then
    alerts+=("CONTAINER_DOWN $svc=$status")
  fi
done

# 4. storage 디스크 사용률 (> 80%)
storage_use=$(df -P /home/deploy/storige/storage 2>/dev/null | tail -1 | awk "{print \$5}" | tr -d "%" || echo 0)
storage_use=${storage_use:-0}
if [ "$storage_use" -gt 80 ]; then
  alerts+=("DISK_HIGH storage=${storage_use}%")
fi

# 결과 기록
if [ ${#alerts[@]} -eq 0 ]; then
  echo "[$TS] OK" >> "$LOG"
else
  joined=""
  for a in "${alerts[@]}"; do
    joined="$joined | $a"
  done
  msg="[$TS] ALERT${joined}"
  echo "$msg" >> "$LOG"
  echo "$msg" >> "$ALERT"

  # Discord webhook (옵션 — .env에 DISCORD_WEBHOOK_URL 있을 때만)
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -sS -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"🚨 storige ${msg}\"}" \
      "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
fi

# 14일 이상 로그 정리
find /home/deploy/storige/logs -name "monitor*.log" -mtime +14 -delete 2>/dev/null || true
