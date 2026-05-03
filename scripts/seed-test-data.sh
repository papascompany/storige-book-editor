#!/usr/bin/env bash
# ===========================================================================
# 통합 검증용 샘플 데이터 시드 스크립트 v2 (2026-05-03)
# 결함 #1, #2 패치 후 사용 — Bookmoa-style 필드 + font 카테고리 정상 등록.
# ===========================================================================
set -e
API="${STORIGE_API_URL:-https://api.papascompany.co.kr/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@storige.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# ─── 로그인 ───────────────────────────────────────────────
echo -e "${BLUE}[1/5] Admin 로그인...${NC}"
RESP=$(curl -sX POST "$API/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))")
[ -z "$TOKEN" ] && echo -e "${RED}로그인 실패: $RESP${NC}" && exit 1
echo -e "  ${GREEN}✓${NC} 토큰 획득"
H="Authorization: Bearer $TOKEN"
HJ="Content-Type: application/json"

# ─── 카테고리 5개 (font 포함) ──────────────────────────────
echo -e "\n${BLUE}[2/5] 라이브러리 카테고리 생성 (5종)...${NC}"
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
    echo -e "  ${YELLOW}⚠${NC} $name: $(echo "$result" | head -c 100)"
  fi
done

# ─── 라이브러리 자산 더미 ──────────────────────────────────
echo -e "\n${BLUE}[3/5] 라이브러리 자산 더미 등록 (배경 3 + 도형 5 + 클립아트 3 + 프레임 2)...${NC}"

# 배경 3개
for entry in '{"name":"파스텔 핑크","fileUrl":"/storage/library/bg/pastel-pink.png","thumbnailUrl":"/storage/library/bg/pastel-pink.png","category":"파스텔"}' \
             '{"name":"파스텔 블루","fileUrl":"/storage/library/bg/pastel-blue.png","thumbnailUrl":"/storage/library/bg/pastel-blue.png","category":"파스텔"}' \
             '{"name":"화이트 그라디언트","fileUrl":"/storage/library/bg/white-gradient.png","thumbnailUrl":"/storage/library/bg/white-gradient.png","category":"그라디언트"}'; do
  result=$(curl -sX POST "$API/library/backgrounds" -H "$H" -H "$HJ" -d "$entry" 2>&1)
  name=$(echo "$entry" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  echo "$result" | grep -q '"id"' && echo -e "  ${GREEN}✓${NC} [bg] $name" || echo -e "  ${YELLOW}⚠${NC} [bg] $name: $(echo "$result" | head -c 100)"
done

# 도형 5개 (categoryId 미사용 — 카테고리 ID 없이 등록)
for entry in '{"name":"원","fileUrl":"/storage/library/shape/circle.svg","thumbnailUrl":"/storage/library/shape/circle.svg","tags":["원","기본"]}' \
             '{"name":"사각형","fileUrl":"/storage/library/shape/rectangle.svg","thumbnailUrl":"/storage/library/shape/rectangle.svg","tags":["사각형","기본"]}' \
             '{"name":"삼각형","fileUrl":"/storage/library/shape/triangle.svg","thumbnailUrl":"/storage/library/shape/triangle.svg","tags":["삼각형","기본"]}' \
             '{"name":"화살표","fileUrl":"/storage/library/shape/arrow.svg","thumbnailUrl":"/storage/library/shape/arrow.svg","tags":["화살표","방향"]}' \
             '{"name":"별","fileUrl":"/storage/library/shape/star.svg","thumbnailUrl":"/storage/library/shape/star.svg","tags":["별","장식"]}'; do
  result=$(curl -sX POST "$API/library/shapes" -H "$H" -H "$HJ" -d "$entry" 2>&1)
  name=$(echo "$entry" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  echo "$result" | grep -q '"id"' && echo -e "  ${GREEN}✓${NC} [shape] $name" || echo -e "  ${YELLOW}⚠${NC} [shape] $name: $(echo "$result" | head -c 100)"
done

# 클립아트 3개
for entry in '{"name":"체크 아이콘","fileUrl":"/storage/library/clipart/check.svg","thumbnailUrl":"/storage/library/clipart/check.svg","category":"비즈니스","tags":["체크","확인"]}' \
             '{"name":"하트","fileUrl":"/storage/library/clipart/heart.svg","thumbnailUrl":"/storage/library/clipart/heart.svg","category":"감정","tags":["하트","사랑"]}' \
             '{"name":"별표","fileUrl":"/storage/library/clipart/star-icon.svg","thumbnailUrl":"/storage/library/clipart/star-icon.svg","category":"장식","tags":["별","즐겨찾기"]}'; do
  result=$(curl -sX POST "$API/library/cliparts" -H "$H" -H "$HJ" -d "$entry" 2>&1)
  name=$(echo "$entry" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  echo "$result" | grep -q '"id"' && echo -e "  ${GREEN}✓${NC} [clipart] $name" || echo -e "  ${YELLOW}⚠${NC} [clipart] $name: $(echo "$result" | head -c 100)"
done

# 프레임 2개
for entry in '{"name":"심플 보더","fileUrl":"/storage/library/frame/simple-border.svg","thumbnailUrl":"/storage/library/frame/simple-border.svg","tags":["보더","심플"]}' \
             '{"name":"라운드 보더","fileUrl":"/storage/library/frame/round-border.svg","thumbnailUrl":"/storage/library/frame/round-border.svg","tags":["보더","라운드"]}'; do
  result=$(curl -sX POST "$API/library/frames" -H "$H" -H "$HJ" -d "$entry" 2>&1)
  name=$(echo "$entry" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  echo "$result" | grep -q '"id"' && echo -e "  ${GREEN}✓${NC} [frame] $name" || echo -e "  ${YELLOW}⚠${NC} [frame] $name: $(echo "$result" | head -c 100)"
done

# ─── 템플릿셋 5개 (소문자 type) ────────────────────────────
echo -e "\n${BLUE}[4/5] 템플릿셋 생성 (책자 3종 + 리플렛 1종 + 스프레드 1종)...${NC}"
for ts in '{"name":"A4 무선제본 책자 (16P)","type":"book","width":210,"height":297,"editorMode":"single","canAddPage":true}' \
          '{"name":"A4 사철제본 책자 (8P)","type":"book","width":210,"height":297,"editorMode":"single","canAddPage":true}' \
          '{"name":"A5 스프링제본 책자 (4P)","type":"book","width":148,"height":210,"editorMode":"single","canAddPage":true}' \
          '{"name":"A4 3단 리플렛","type":"leaflet","width":297,"height":210,"editorMode":"single","canAddPage":false}' \
          '{"name":"스프레드 책자 표지 (책 펼침면)","type":"book","width":420,"height":297,"editorMode":"book","canAddPage":false}'; do
  result=$(curl -sX POST "$API/template-sets" -H "$H" -H "$HJ" -d "$ts" 2>&1)
  name=$(echo "$ts" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  if echo "$result" | grep -q '"id"'; then
    id=$(echo "$result" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
    echo -e "  ${GREEN}✓${NC} $name (${id:0:8}..)"
  else
    echo -e "  ${YELLOW}⚠${NC} $name: $(echo "$result" | head -c 200)"
  fi
done

# ─── 상품 3개 (Admin UI 호환 필드) ─────────────────────────
echo -e "\n${BLUE}[5/5] 상품 생성 (Bookmoa-style 필드)...${NC}"
for prod in '{"name":"테스트 책자 A4","code":"BOOK-A4-TEST","price":15000,"isActive":true,"allowCustomSize":false}' \
            '{"name":"테스트 리플렛","code":"LEAFLET-A4-TEST","price":5000,"isActive":true,"allowCustomSize":false}' \
            '{"name":"자유 사이즈 책자","code":"BOOK-CUSTOM-TEST","price":20000,"isActive":true,"allowCustomSize":true}'; do
  result=$(curl -sX POST "$API/products" -H "$H" -H "$HJ" -d "$prod" 2>&1)
  name=$(echo "$prod" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
  if echo "$result" | grep -q '"id"'; then
    echo -e "  ${GREEN}✓${NC} $name"
  else
    echo -e "  ${YELLOW}⚠${NC} $name: $(echo "$result" | head -c 200)"
  fi
done

# ─── 최종 검증 ────────────────────────────────────────────
echo -e "\n${GREEN}=== 최종 데이터 현황 ===${NC}"
for endpoint in "categories:library/categories" "templates:templates" "template-sets:template-sets" "products:products" "backgrounds:library/backgrounds" "shapes:library/shapes" "cliparts:library/cliparts" "frames:library/frames"; do
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
echo -e "\n${GREEN}=== 시드 완료 ===${NC}"
