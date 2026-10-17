#!/usr/bin/env node
/**
 * 캘린더 샘플 템플릿·템플릿셋 등록 (P1 캘린더, 2026-10-17)
 *
 * 오너 확정 7종 상품(탁상 4·벽걸이 1단·2단 2)마다 템플릿 4개(표지·월 앞면·월 뒷면·에필로그)와
 * 26캔버스 템플릿셋(표지 1 + 12개월×2면 + 에필로그 1, productProfile 포함)을 관리자 API 로 등록한다.
 * 같은 이름이 있으면 재사용/갱신(멱등). 운영 등록도 같은 스크립트로 하되 오너 승인 뒤에만 실행한다.
 *
 * 사용:
 *   STORIGE_API_URL=http://localhost:4000/api node scripts/register-calendar-samples.mjs [--with-site] [--only key1,key2] [--dry-run]
 *   ADMIN_EMAIL / ADMIN_PASSWORD 미지정이면 apps/api/.env.development 에서 읽는다(값은 출력하지 않음).
 *   --with-site : 로컬 e2e 용 사이트("캘린더 로컬 테스트")를 만들고 shop-session 토큰을 결과 파일(0600)에 기록한다(로컬 API 전용, 원격은 --allow-remote).
 *   --print-token : embed URL 에 토큰을 그대로 출력(기본은 마스킹).
 *
 * 템플릿 좌표 단위: 캔버스 px (1mm = 150/25.4 px, canvas-core UNIT_CONVERSIONS.DEFAULT_DPI=150). workspace 는 (0,0) 중심.
 * 날짜 그리드는 `extensionType:'calendar-grid'` 그룹 자리표시자(경계 사각형만) — 편집기가 로드 뒤 CalendarPlugin.rehydrate 로 그린다.
 * 링 오버레이는 `extensionType:'overlay'` + `printExclude:true`(화면 전용, PDF 제외, 저장은 됨).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry-run');
const WITH_SITE = flag('--with-site');
const PRINT_TOKEN = flag('--print-token');
const ALLOW_REMOTE = flag('--allow-remote');
const ONLY = (opt('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const API = (process.env.STORIGE_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const EDITOR = process.env.STORIGE_EDITOR_URL ?? 'http://localhost:3000';
const PX_PER_MM = 150 / 25.4;
const FONT = '본고딕(Noto Sans) Regular';

// ─── 프리셋(apps/admin/src/pages/TemplateSets/calendarProfilePresets.ts 와 같은 값) ───
const BASE_PROFILE = {
  version: 1,
  kind: 'calendar',
  pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
  calendar: {
    monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
    allowedRange: { from: '2026-01', to: '2027-12' }, weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true }, dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
};
const PRESETS = [
  { key: 'calendar_desk_large', label: '탁상형 라지달력', width: 265, height: 190, layout: 'desk' },
  { key: 'calendar_desk_basic', label: '탁상형 베이직달력', width: 210, height: 150, layout: 'desk' },
  { key: 'calendar_desk_tiny', label: '탁상형 티니달력', width: 100, height: 125, layout: 'desk' },
  { key: 'calendar_desk_mini', label: '탁상형 미니달력', width: 140, height: 140, layout: 'desk' },
  { key: 'calendar_wall1_a3', label: '벽걸이형 원피스 A3', width: 297, height: 415, layout: 'wall-1' },
  { key: 'calendar_wall2_a4', label: '벽걸이 2단 베이직 A4', width: 294, height: 210, layout: 'wall-2' },
  { key: 'calendar_wall2_a3', label: '벽걸이 2단 라지 A3', width: 415, height: 297, layout: 'wall-2' },
];
const profileFor = (p) => ({ ...BASE_PROFILE, editorType: p.key, calendar: { ...BASE_PROFILE.calendar, layout: p.layout } });

// ─── 로컬 환경 읽기 ────────────────────────────────────────────────────────
function readDevEnv() {
  const file = path.join(ROOT, 'apps/api/.env.development');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────
let TOKEN = '';
async function call(method, p, body, extraHeaders = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${typeof json === 'string' ? json.slice(0, 300) : JSON.stringify(json).slice(0, 400)}`);
  return json;
}
/** 응답 포장 해제: 배열 | {items|data|templates|templateSets|sites} | {success,data:{...}} 중첩 */
function listOf(r, depth = 0) {
  if (Array.isArray(r)) return r;
  if (!r || typeof r !== 'object' || depth > 3) return [];
  for (const k of ['items', 'templates', 'templateSets', 'sites', 'data']) {
    if (k in r) { const v = listOf(r[k], depth + 1); if (v.length || Array.isArray(r[k])) return v; }
  }
  return Object.values(r).find(Array.isArray) ?? [];
}

// ─── 템플릿 캔버스 데이터 ─────────────────────────────────────────────────
let seq = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1).toString(36)}`;
const px = (mm) => Math.round(mm * PX_PER_MM * 100) / 100;

function rect(o) {
  return { type: 'rect', version: '5.5.2', originX: 'left', originY: 'top', strokeWidth: 0, fill: '#ffffff', ...o };
}
function text(str, o) {
  // styles 는 필수 — 없으면 fabric toJSON(stylesToArray)이 예외를 내고 자동저장 수집기가 그 캔버스를 통째로 버린다
  return { type: 'textbox', version: '5.5.2', originX: 'left', originY: 'top', text: str, fontFamily: FONT, fontSize: 24, fill: '#222222', styles: {}, ...o };
}
function frame(o) {
  // 사진틀: extensionType 'frame' 객체면 편집기가 클릭 → 사진 채우기를 붙인다(rebindFrameInteractivity).
  return rect({ id: uid('frame'), extensionType: 'frame', fill: '#e5e7eb', stroke: '#9ca3af', strokeWidth: 1, name: '사진틀', ...o });
}
function ringOverlay(W, bandMm) {
  // 화면 전용 링 오버레이(PDF 제외). 저장·재오픈에서 유지되도록 excludeFromExport 는 쓰지 않는다.
  return rect({ id: 'ring-overlay', extensionType: 'overlay', printExclude: true, selectable: false, evented: false, deleteable: false, movable: false,
    left: 0, top: 0, width: W, height: px(bandMm), fill: '#6b7280', opacity: 0.35, name: '링 바인딩 영역(화면 전용)' });
}
function calendarGrid(box, ext) {
  const id = uid('calgrid');
  return {
    type: 'group', version: '5.5.2', id, extensionType: 'calendar-grid', extension: ext,
    left: box.left + box.width / 2, top: box.top + box.height / 2, width: box.width, height: box.height,
    originX: 'center', originY: 'center', subTargetCheck: false,
    selectable: true, hasControls: false, lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true,
    movable: false, deleteable: false, contentEditable: false, isUserAdded: false, name: '날짜 그리드',
    objects: [rect({ id: `${id}-bounds`, left: -box.width / 2, top: -box.height / 2, width: box.width, height: box.height, fill: 'transparent', selectable: false, evented: false })],
  };
}
function canvasData(W, H, objects) {
  // Storige workspace 사각형은 (0,0) 을 중심으로 놓인다(WorkspacePlugin originX/Y 'center') —
  // 위에서 [0..W]×[0..H] 로 배치한 좌표를 workspace 좌표계(−W/2..W/2)로 옮긴다. 그룹 자식은 그룹 중심 기준이라 그대로.
  const shifted = objects.map((o) => ({ ...o, left: (o.left ?? 0) - W / 2, top: (o.top ?? 0) - H / 2 }));
  // 첫 템플릿 로더(useEditorContents.loadTemplateSetEditor)는 canvasData 에 id 'workspace' 객체가 없으면
  // 객체를 버리고 workspace 만 초기화한다 — 관리자 편집기 저장본과 같이 workspace 사각형을 맨 앞에 둔다.
  const workspace = { type: 'rect', version: '5.5.2', id: 'workspace', left: 0, top: 0, originX: 'center', originY: 'center', width: W, height: H,
    fill: '#ffffff', strokeWidth: 0, selectable: false, evented: false, hasControls: false, hasBorders: false, hoverCursor: 'default', lockMovementX: true, lockMovementY: true };
  return { version: '5.5.2', width: W, height: H, background: '#ffffff', objects: [workspace, ...shifted] };
}

/** 상품별 4개 템플릿의 canvasData. 좌표는 px. */
function buildTemplates(p) {
  const W = px(p.width), H = px(p.height);
  const m = px(6);                    // 여백 6mm
  const band = p.layout === 'wall-2' ? 0 : 8; // 상단 링 영역 mm (2단은 중앙 링이라 캔버스 밖)
  const topY = px(band) + m;
  const title = (s, y, size) => text(s, { id: uid('text'), left: m, top: y, width: W - 2 * m, fontSize: size, textAlign: 'center' });

  const cover = canvasData(W, H, [
    ...(band ? [ringOverlay(W, band)] : []),
    title('2027 CALENDAR', topY, Math.round(H * 0.06)),
    frame({ left: m, top: topY + H * 0.1, width: W - 2 * m, height: H - topY - H * 0.1 - m }),
  ]);
  const gridStyle = { fontFamily: FONT, headerLang: 'en', showTitle: true, showLines: true };
  let monthA, monthB;
  if (p.layout === 'wall-2') {
    // 상단(사진) / 하단(달력) — 링은 두 면 사이(캔버스 밖)
    monthA = canvasData(W, H, [frame({ left: m, top: m, width: W - 2 * m, height: H - 2 * m })]);
    monthB = canvasData(W, H, [calendarGrid({ left: m, top: m, width: W - 2 * m, height: H - 2 * m }, { variant: 'month', style: gridStyle })]);
  } else if (p.layout === 'wall-1') {
    // 원피스: 앞면 = 사진 + 달력(세로), 뒷면 = 사진
    const photoH = (H - topY - m) * 0.5;
    monthA = canvasData(W, H, [
      ringOverlay(W, band),
      frame({ left: m, top: topY, width: W - 2 * m, height: photoH }),
      calendarGrid({ left: m, top: topY + photoH + m, width: W - 2 * m, height: H - topY - photoH - 2 * m }, { variant: 'month', style: gridStyle }),
    ]);
    monthB = canvasData(W, H, [ringOverlay(W, band), frame({ left: m, top: topY, width: W - 2 * m, height: H - topY - m })]);
  } else {
    // 탁상: 앞면 = 사진(좌) + 달력(우), 뒷면 = 사진 + 전월/익월 미니
    const half = (W - 3 * m) / 2;
    monthA = canvasData(W, H, [
      ringOverlay(W, band),
      frame({ left: m, top: topY, width: half, height: H - topY - m }),
      calendarGrid({ left: 2 * m + half, top: topY, width: half, height: H - topY - m }, { variant: 'month', style: gridStyle }),
    ]);
    const miniW = (W - 3 * m) / 2, miniH = Math.min(px(40), (H - topY - m) * 0.35);
    monthB = canvasData(W, H, [
      ringOverlay(W, band),
      frame({ left: m, top: topY, width: W - 2 * m, height: H - topY - 2 * m - miniH }),
      calendarGrid({ left: m, top: H - m - miniH, width: miniW, height: miniH }, { variant: 'mini', monthDelta: -1, style: { fontFamily: FONT } }),
      calendarGrid({ left: 2 * m + miniW, top: H - m - miniH, width: miniW, height: miniH }, { variant: 'mini', monthDelta: 1, style: { fontFamily: FONT } }),
    ]);
  }
  const epilogue = canvasData(W, H, [
    ...(band ? [ringOverlay(W, band)] : []),
    frame({ left: m, top: topY, width: W - 2 * m, height: (H - topY - m) * 0.6 }),
    title('Thank you', topY + (H - topY - m) * 0.7, Math.round(H * 0.06)),
  ]);
  return [
    { slot: 'cover', name: `[캘린더 샘플] ${p.label} — 표지`, canvasData: cover },
    { slot: 'monthA', name: `[캘린더 샘플] ${p.label} — 월 ${p.layout === 'wall-2' ? '상단' : '앞면'}`, canvasData: monthA },
    { slot: 'monthB', name: `[캘린더 샘플] ${p.label} — 월 ${p.layout === 'wall-2' ? '하단' : '뒷면'}`, canvasData: monthB },
    { slot: 'epilogue', name: `[캘린더 샘플] ${p.label} — 에필로그`, canvasData: epilogue },
  ];
}

function buildRefs(ids) {
  const refs = [{ templateId: ids.cover, required: true }];
  for (let i = 0; i < 12; i += 1) refs.push({ templateId: ids.monthA, required: true }, { templateId: ids.monthB, required: true });
  refs.push({ templateId: ids.epilogue, required: true });
  return refs;
}

// ─── 실행 ─────────────────────────────────────────────────────────────────
async function main() {
  const env = readDevEnv();
  const email = process.env.ADMIN_EMAIL ?? env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD ?? env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD 가 필요합니다(환경변수 또는 apps/api/.env.development)');
  console.log(`API ${API} / dry-run=${DRY} / with-site=${WITH_SITE}`);
  const login = await call('POST', '/auth/login', { email, password });
  TOKEN = login.accessToken ?? login.token;
  if (!TOKEN) throw new Error('로그인 응답에 accessToken 없음');
  console.log('관리자 로그인 완료');

  const existingTemplates = listOf(await call('GET', '/templates?limit=500'));
  // 목록은 pageSize 기본 20 — 운영처럼 세트가 많아도 이름 매칭이 되도록 크게 요청한다(멱등 보장)
  const existingSets = listOf(await call('GET', '/template-sets?page=1&pageSize=500'));
  const byName = (list, name) => list.find((t) => t.name === name);

  const results = [];
  for (const p of PRESETS) {
    if (ONLY.length && !ONLY.includes(p.key)) continue;
    const ids = {};
    for (const t of buildTemplates(p)) {
      const found = byName(existingTemplates, t.name);
      const body = { name: t.name, type: 'page', width: p.width, height: p.height, canvasData: t.canvasData };
      if (DRY) { ids[t.slot] = found?.id ?? `(dry:${t.slot})`; continue; }
      if (found) {
        await call('PATCH', `/templates/${found.id}`, { canvasData: t.canvasData, width: p.width, height: p.height });
        ids[t.slot] = found.id;
      } else {
        const created = await call('POST', '/templates', body);
        ids[t.slot] = created.id;
        existingTemplates.push(created);
      }
    }
    const setName = `[캘린더 샘플] ${p.label}`;
    const setBody = {
      name: setName, type: 'leaflet', editorMode: 'single', width: p.width, height: p.height,
      canAddPage: false, pageCountRange: [26, 26], pageStep: null, templates: buildRefs(ids),
      productProfile: profileFor(p), pdfOutputMode: 'duplex-merged', colorMode: 'rgb', enabledMenus: null,
    };
    let setId;
    const foundSet = byName(existingSets, setName);
    if (DRY) setId = foundSet?.id ?? '(dry)';
    else if (foundSet) { await call('PUT', `/template-sets/${foundSet.id}`, setBody); setId = foundSet.id; }
    else { const created = await call('POST', '/template-sets', setBody); setId = created.id; existingSets.push(created); }
    results.push({ key: p.key, label: p.label, size: `${p.width}×${p.height}`, templateSetId: setId, templates: ids });
    console.log(`✓ ${p.label} (${p.width}×${p.height}) → templateSetId=${setId}`);
  }

  let embedToken = '';
  if (WITH_SITE && !DRY) {
    const host = new URL(API).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host) && !ALLOW_REMOTE) {
      throw new Error(`--with-site 는 로컬 API 전용입니다(${host}). 운영에 사이트·토큰을 만들려면 --allow-remote 를 명시하세요`);
    }
    const siteName = '캘린더 로컬 테스트';
    const sites = listOf(await call('GET', '/sites'));
    let site = sites.find((s) => s.name === siteName);
    if (!site) { const created = await call('POST', '/sites', { name: siteName, domain: 'localhost' }); site = created?.data ?? created; }
    if (!site?.editorAuthCode && site?.id) { const one = await call('GET', `/sites/${site.id}`); site = one?.data ?? one; }
    const code = site.editorAuthCode;
    if (!code) throw new Error('site.editorAuthCode 를 응답에서 읽지 못했습니다');
    const shop = await call('POST', '/auth/shop-session', { memberSeqno: 1001, memberId: 'calendar-tester', memberName: '캘린더 테스터' }, { 'X-API-Key': code });
    embedToken = shop.accessToken;
    console.log(`사이트 '${siteName}' 준비 — editorAuthCode ****${code.slice(-4)}, shop-session 토큰 발급`);
  }

  console.log('\n=== 결과 ===');
  for (const r of results) {
    console.log(`${r.key}\t${r.size}\tset=${r.templateSetId}\tcover=${r.templates.cover} monthA=${r.templates.monthA} monthB=${r.templates.monthB} epilogue=${r.templates.epilogue}`);
    if (embedToken) console.log(`  embed: ${EDITOR}/embed?templateSetId=${r.templateSetId}&orderSeqno=<주문번호>&mode=both&token=${PRINT_TOKEN ? embedToken : '<결과 파일의 embedTokenValue>'}&parentOrigin=${encodeURIComponent(EDITOR)}`);
  }
  // 토큰이 들어갈 수 있으므로 저장소 밖에 쓴다(STORIGE_SAMPLES_OUT 로 변경 가능)
  const outFile = process.env.STORIGE_SAMPLES_OUT ?? path.join(os.tmpdir(), 'storige-calendar-samples.json');
  fs.writeFileSync(outFile, JSON.stringify({ api: API, results, embedToken: embedToken ? '(set)' : '', generatedAt: new Date().toISOString(), ...(embedToken ? { embedTokenValue: embedToken } : {}) }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(outFile, 0o600); } catch { /* 권한 변경 실패는 무시 */ }
  console.log(`\n결과 파일: ${outFile}`);
}

main().catch((err) => { console.error('실패:', err.message); process.exit(1); });
