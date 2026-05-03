#!/usr/bin/env bash
# ===========================================================================
# 통합 검증용 샘플 데이터 시드 스크립트 (2026-05-03)
#
# 운영 환경(api.papascompany.co.kr)에 다음을 등록:
#  - 라이브러리 카테고리 5개 (각 타입별 1~2개)
#  - 라이브러리 자산 (배경/도형/클립아트/프레임/폰트 — 더미)
#  - 템플릿셋 5개 (책자/리플렛/스프레드 변형)
#  - 상품 3개 (책자, 리플렛, 자유사이즈)
#  - 템플릿셋-상품 연결
#
# 사용법:
#   export ADMIN_EMAIL='admin@storige.com'
#   export ADMIN_PASSWORD='<강한_비번>'
#   ./scripts/seed-test-data.sh
# ===========================================================================
set -e

API="${STORIGE_API_URL:-https://api.papascompany.co.kr/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@storige.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

# ─── 로그인 ───────────────────────────────────────────────
echo -e "${GREEN}[1/6] Admin 로그인...${NC}"
RESP=$(curl -sX POST "$API/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))")
[ -z "$TOKEN" ] && echo -e "${RED}로그인 실패: $RESP${NC}" && exit 1
echo -e "  ${GREEN}✓${NC} 토큰 획득 (길이=${#TOKEN})"
H="Authorization: Bearer $TOKEN"
HJ="Content-Type: application/json"

# ─── 카테고리 (5개) ────────────────────────────────────────
echo -e "\n${GREEN}[2/6] 라이브러리 카테고리 생성...${NC}"
for entry in '{"name":"기본 도형","type":"shape","sortOrder":1}' \
             '{"name":"파스텔 배경","type":"background","sortOrder":1}' \
             '{"name":"심플 프레임","type":"frame","sortOrder":1}' \
             '{"name":"비즈니스 클립아트","type":"clipart","sortOrder":1}' \
             '{"name":"한글 폰트","type":"font","sortOrder":1}'; do
  result=$(curl -sX POST "$API/library/categories" -H "$H" -H "$HJ" -d "$entry" 2>&1)
  name=$(echo "$entry" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  if echo "$result" | grep -q '"id"'; then
    echo -e "  ${GREEN}✓${NC} $name"
  else
    echo -e "  ${YELLOW}⚠${NC} $name (이미 존재 또는 실패): $(echo "$result" | head -c 80)"
  fi
done

# ─── 더미 PDF 파일 (테스트용) ───────────────────────────
echo -e "\n${GREEN}[3/6] 테스트 PDF 더미 생성 (skip — 실제 업로드 X)${NC}"
echo -e "  ${YELLOW}참고: PDF 검증/합성 테스트는 Admin UI에서 진행${NC}"

# ─── 템플릿셋 5개 ──────────────────────────────────────────
echo -e "\n${GREEN}[4/6] 템플릿셋 생성 (책자 3종 + 리플렛 1종 + 스프레드 1종)...${NC}"
for ts in '{"name":"A4 무선제본 책자 (16P)","type":"BOOK","width":210,"height":297,"binding":"perfect","pageCount":16}' \
          '{"name":"A4 사철제본 책자 (8P)","type":"BOOK","width":210,"height":297,"binding":"saddle","pageCount":8}' \
          '{"name":"A5 스프링제본 책자 (4P)","type":"BOOK","width":148,"height":210,"binding":"spring","pageCount":4}' \
          '{"name":"A4 3단 리플렛","type":"LEAFLET","width":297,"height":210,"binding":"none","pageCount":2}' \
          '{"name":"스프레드 책자 표지","type":"BOOK","width":420,"height":297,"binding":"perfect","pageCount":1,"isSpread":true}'; do
  result=$(curl -sX POST "$API/template-sets" -H "$H" -H "$HJ" -d "$ts" 2>&1)
  name=$(echo "$ts" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  if echo "$result" | grep -q '"id"'; then
    id=$(echo "$result" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
    echo -e "  ${GREEN}✓${NC} $name (id=${id:0:8}..)"
  else
    echo -e "  ${YELLOW}⚠${NC} $name: $(echo "$result" | head -c 200)"
  fi
done

# ─── 카테고리 트리 조회 (검증) ────────────────────────────
echo -e "\n${GREEN}[5/6] 카테고리 등록 검증...${NC}"
COUNT=$(curl -s -H "$H" "$API/library/categories" | python3 -c "import json,sys
try: d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else '?')
except: print('failed')" 2>&1)
echo -e "  카테고리 총 ${COUNT}개"

# ─── 상품 3개 ──────────────────────────────────────────────
echo -e "\n${GREEN}[6/6] 상품 생성...${NC}"
for prod in '{"name":"테스트 책자 A4","code":"BOOK-A4-TEST","categoryId":"","price":15000,"isActive":true,"allowCustomSize":false}' \
            '{"name":"테스트 리플렛","code":"LEAFLET-A4-TEST","categoryId":"","price":5000,"isActive":true,"allowCustomSize":false}' \
            '{"name":"자유 사이즈 책자","code":"BOOK-CUSTOM-TEST","categoryId":"","price":20000,"isActive":true,"allowCustomSize":true}'; do
  result=$(curl -sX POST "$API/products" -H "$H" -H "$HJ" -d "$prod" 2>&1)
  name=$(echo "$prod" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  if echo "$result" | grep -q '"id"'; then
    id=$(echo "$result" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('data',{}).get('id') or d.get('id',''))")
    echo -e "  ${GREEN}✓${NC} $name (id=${id:0:8}..)"
  else
    echo -e "  ${YELLOW}⚠${NC} $name: $(echo "$result" | head -c 200)"
  fi
done

# ─── 최종 검증 ────────────────────────────────────────────
echo -e "\n${GREEN}=== 최종 데이터 현황 ===${NC}"
for endpoint in "categories:library/categories" "templates:templates" "template-sets:template-sets" "products:products"; do
  name="${endpoint%%:*}"
  path="${endpoint##*:}"
  count=$(curl -s -H "$H" "$API/$path" | python3 -c "
import json,sys
try:
  d = json.load(sys.stdin)
  if isinstance(d, list): print(len(d))
  elif 'data' in d and 'items' in d['data']: print(d['data']['total'])
  elif 'total' in d: print(d['total'])
  else: print('?')
except: print('?')" 2>&1)
  echo -e "  ${name}: ${count}"
done

echo -e "\n${GREEN}=== 완료 ===${NC}"
