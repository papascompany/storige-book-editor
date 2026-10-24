#!/usr/bin/env bash
# REA 웹서비스 분석용 브라우저 실행 스크립트.
# CDP(Chrome DevTools Protocol)를 127.0.0.1:9222 에 열고, 분석 전용 프로필로 Chrome 을 띄운다.
# 사용: scripts/rea-browser.sh [URL] [PORT]
#   예) scripts/rea-browser.sh https://example.com/editor
# 이후 Claude 에게 "REA 로 열린 페이지 분석해줘" 라고 요청하면 list_browser_targets → analyze_web_bundle 순으로 진행한다.
set -euo pipefail

URL="${1:-about:blank}"
PORT="${2:-9222}"
PROFILE="${REA_BROWSER_PROFILE:-$HOME/.cache/rea-browser-profile}"
mkdir -p "$PROFILE"

find_chrome() {
  if [[ -n "${REA_CHROME_PATH:-}" && -x "${REA_CHROME_PATH}" ]]; then echo "$REA_CHROME_PATH"; return; fi
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
  )
  for c in "${candidates[@]}"; do [[ -x "$c" ]] && { echo "$c"; return; }; done
  for c in google-chrome chromium chromium-browser; do command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return; }; done
  echo "Chrome/Chromium 을 찾지 못했습니다. REA_CHROME_PATH 로 실행 파일 경로를 지정하세요." >&2
  exit 1
}

CHROME="$(find_chrome)"
EXTRA=()
# 클라우드/헤드리스 환경(디스플레이 없음)에서는 headless 로 실행
if [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]]; then
  EXTRA+=(--headless=new --no-sandbox --disable-gpu)
  [[ -n "${HTTPS_PROXY:-}" ]] && EXTRA+=(--proxy-server="$HTTPS_PROXY")
fi

echo "브라우저: $CHROME"
echo "CDP 엔드포인트: http://127.0.0.1:$PORT  (Claude 에게 이 주소를 알려주면 됩니다)"
echo "프로필: $PROFILE"
exec "$CHROME" \
  --remote-debugging-port="$PORT" \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  "${EXTRA[@]}" \
  "$URL"
