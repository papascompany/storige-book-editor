#!/usr/bin/env node
/**
 * 사진인화 샘플 템플릿·템플릿셋 등록 (P2-d 사진인화, 2026-10-19)
 *
 * 프리셋 4종(인화 chemical · 인쇄 ① 자유 뒷면 · ② 고정 뒷면 · ③ 카드형)마다 템플릿(앞면 + 뒷면)과
 * 템플릿셋(pages range, productProfile 포함)을 관리자 API 로 등록한다. 같은 이름이 있으면 재사용/갱신(멱등).
 * 운영 등록도 같은 스크립트로 하되 오너 승인 뒤에만 실행한다.
 *
 * ※ 오너 확정 전 기본값: 사이즈(4x6 102×152·카드 90×54·minDpi)·업로드 한도·유테 2mm·매수 1~99·도련(digital 3mm/chemical 0)은
 *    apps/admin/src/pages/TemplateSets/photoPrintProfilePresets.ts 와 같은 값이며 openDecisions 항목이다.
 *
 * 사용:
 *   STORIGE_API_URL=http://localhost:4000/api node scripts/register-photo-print-samples.mjs [--with-site] [--only key1,key2] [--dry-run]
 *   ADMIN_EMAIL / ADMIN_PASSWORD 미지정이면 apps/api/.env.development 에서 읽는다(값은 출력하지 않음).
 *   --dry-run   : 등록하지 않고 템플릿·세트 본문만 만든다. API 에 접속되면 기존 이름 매칭까지 보여 주고, 접속 불가면 오프라인으로 계속한다.
 *   --with-site : 로컬 e2e 용 사이트("사진인화 로컬 테스트")를 만들고 shop-session 토큰을 결과 파일(0600)에 기록한다(로컬 API 전용, 원격은 --allow-remote).
 *   --print-token : embed URL 에 토큰을 그대로 출력(기본은 마스킹).
 *
 * 템플릿 좌표 단위: 캔버스 px (1mm = 150/25.4 px, canvas-core UNIT_CONVERSIONS.DEFAULT_DPI=150). workspace 는 (0,0) 중심.
 * - 앞면: 풀블리드 사진틀(`extensionType:'frame'`, fill '' — 유테 띠·이미지풀 여백은 흰 캔버스 배경이 보여야 한다) +
 *   촬영일 텍스트(`extensionType:'date-overlay'`, extension.frameId 로 틀에 묶음 — 편집기 PhotoPrintPlugin 이 'YYYY.MM.DD' 로 갱신).
 * - 사진틀 기하(도련 세트): 사진틀은 재단 밖 도련(bleedMm, 사방)까지 확장되며(페이퍼풀 cover 가 도련 영역까지 덮도록),
 *   유테(frameInsetMm 창 축소)/이미지풀(contain) 창은 플러그인이 재단 기준으로 계산한다
 *   (canvas-core PhotoPrintPlugin `bleedPx` → resolveFrameWindow: 창 = 재단 상자 − inset, 틀 상자가 아님).
 *   따라서 digital(3mm) 세트에서도 재단 후 유테 띠 폭 = borderInsetMm, 이미지풀 사진은 재단 안에 전부 들어온다. chemical(0mm) 은 틀 = 재단.
 * - 사진틀은 stroke ''·strokeWidth 0 — 틀 경계선은 편집기 hover 오버레이가 그리며, 저작 stroke 는 PDF 에 그대로 인쇄된다
 *   (printExclude 가 없으므로). strokeWidth 0 이라 fabric bbox/getCenterPoint 가 재단(또는 재단+도련) 상자와 정확히 일치한다.
 * - ① 자유 뒷면: 안내 텍스트 1개(삭제·편집 가능). ② 고정 뒷면: 로고 자리 사각형·텍스트에 movable/deleteable/contentEditable=false
 *   (편집기 seedPhotoPrintCanvas 가 2차 강제). ③ 카드형: 앞면 사진틀 + 뒷면 자유 텍스트.
 * - 세트 refs: chemical [앞], digital [앞, 뒤]. ② 는 productProfile.photoPrint.backTemplateId = 뒷면 템플릿 id(refs[1] 과 같은 id).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
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

// ─── 프리셋(apps/admin/src/pages/TemplateSets/photoPrintProfilePresets.ts 와 같은 값) ───
const SIZE_4X6 = { code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 };
const SIZE_CARD = { code: 'card-90x54', widthMm: 90, heightMm: 54, minDpi: 300 };
const OPTIONS = {
  border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'],
  brightnessFix: true, dateOverlay: true, grayscale: true, borderInsetMm: 2,
};
const COPIES = { min: 1, max: 99 };
const SHEET_CHEMICAL = { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' };
const SHEET_DIGITAL = { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' };

/**
 * key/label/size 와 폼 값(범위·증감·도련) + 템플릿 슬롯 구성.
 * slots: 앞면 → 'front'(또는 'cardFront'), 뒷면 → 'backFree' | 'backFixed' | 'cardBack'. refs 는 slots 순서.
 */
const PRESETS = [
  { key: 'photo_chem', label: '인화(미니랩) 4x6', process: 'chemical', composition: 'per-photo-free-back', size: SIZE_4X6,
    pages: { min: 1, max: 200, step: 1 }, upload: { maxPhotos: 200, maxMb: 25 }, output: { mode: 'single-pdf' },
    cropMarkEnabled: false, bleedMm: 0, slots: ['front'] },
  { key: 'photo_digital_items', label: '인쇄 ① 자유 뒷면 4x6', process: 'digital', composition: 'per-photo-free-back', size: SIZE_4X6,
    pages: { min: 2, max: 400, step: 2 }, upload: { maxPhotos: 400, maxMb: 25 }, output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
    cropMarkEnabled: true, bleedMm: 3, slots: ['front', 'backFree'] },
  { key: 'photo_digital_fixedback', label: '인쇄 ② 고정 뒷면 4x6', process: 'digital', composition: 'per-photo-fixed-back', size: SIZE_4X6,
    pages: { min: 2, max: 400, step: 2 }, upload: { maxPhotos: 400, maxMb: 25 }, output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
    cropMarkEnabled: true, bleedMm: 3, slots: ['front', 'backFixed'] },
  { key: 'photo_digital_sheet', label: '인쇄 ③ 카드형 90×54', process: 'digital', composition: 'sheet-cards', size: SIZE_CARD,
    pages: { min: 2, max: 400, step: 2 }, upload: { maxPhotos: 400, maxMb: 25 }, output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
    cropMarkEnabled: true, bleedMm: 3, slots: ['cardFront', 'cardBack'] },
];

/** 프로파일 — ② 는 backTemplateId 에 뒷면 템플릿 id(등록 결과)를 넣는다 */
function profileFor(p, backTemplateId) {
  return {
    version: 1,
    kind: 'photo-print',
    editorType: p.key,
    pages: { kind: 'range', ...p.pages, labelRule: 'photo' },
    sheet: p.process === 'chemical' ? { ...SHEET_CHEMICAL } : { ...SHEET_DIGITAL },
    photoPrint: {
      process: p.process,
      composition: p.composition,
      sizes: [{ ...p.size }],
      options: { ...OPTIONS, border: [...OPTIONS.border], fit: [...OPTIONS.fit], finish: [...OPTIONS.finish] },
      copies: { ...COPIES },
      ...(p.composition === 'per-photo-fixed-back' ? { backTemplateId } : {}),
      upload: { ...p.upload },
    },
    output: { ...p.output },
  };
}

/** packages/types 빌드본(cjs)의 validateProductProfile — 없으면 검증 생략(경고만) */
function loadValidator() {
  try {
    const req = createRequire(import.meta.url);
    const mod = req(path.join(ROOT, 'packages/types/dist/cjs/index.js'));
    return typeof mod.validateProductProfile === 'function' ? mod.validateProductProfile : null;
  } catch {
    return null;
  }
}

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
  // fill '' — 유테(frameInsetMm) 띠·이미지풀(contain) 여백은 캔버스 흰 배경이 그대로 보여야 하므로 회색 자리표시를 두지 않는다.
  // stroke ''·strokeWidth 0 — 저작 stroke 는 printExclude 없이 PDF 에 인쇄되고(contain/유테 흰 여백 바깥 테두리), 1px 이면
  // getCenterPoint 가 재단 중심에서 0.5px 밀린다. 틀 식별은 bounding box(+편집기 hover 오버레이)로 충분하다. 카드형 틀도 같은 함수.
  return rect({ id: uid('frame'), extensionType: 'frame', fill: '', stroke: '', strokeWidth: 0, name: '사진틀', ...o });
}
/** 촬영일 텍스트(템플릿 저작 객체) — 편집기 PhotoPrintPlugin 이 연결 사진의 extension.takenAt 으로 텍스트를 채운다(없으면 빈 문자열) */
function dateOverlay(frameId, o) {
  return text('', {
    id: uid('date'), extensionType: 'date-overlay', extension: { frameId },
    fill: '#ffffff', textAlign: 'right', fontSize: px(3),
    shadow: { color: 'rgba(0,0,0,0.6)', blur: 2, offsetX: 0, offsetY: 0 },
    deleteable: false, contentEditable: false, editable: false, isUserAdded: false, name: '촬영일',
    ...o,
  });
}
/** 고정(잠금) 객체 플래그 — ② 뒷면 템플릿 저작 규약(편집기 seedPhotoPrintCanvas 가 같은 플래그를 2차 강제) */
const LOCKED = {
  movable: false, deleteable: false, contentEditable: false, isUserAdded: false,
  hasControls: false, lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true,
};
function canvasData(W, H, objects) {
  // Storige workspace 사각형은 (0,0) 을 중심으로 놓인다(WorkspacePlugin originX/Y 'center') —
  // 위에서 [0..W]×[0..H] 로 배치한 좌표를 workspace 좌표계(−W/2..W/2)로 옮긴다.
  const shifted = objects.map((o) => ({ ...o, left: (o.left ?? 0) - W / 2, top: (o.top ?? 0) - H / 2 }));
  // 첫 템플릿 로더(useEditorContents.loadTemplateSetEditor)는 canvasData 에 id 'workspace' 객체가 없으면
  // 객체를 버리고 workspace 만 초기화한다 — 관리자 편집기 저장본과 같이 workspace 사각형을 맨 앞에 둔다.
  const workspace = { type: 'rect', version: '5.5.2', id: 'workspace', left: 0, top: 0, originX: 'center', originY: 'center', width: W, height: H,
    fill: '#ffffff', strokeWidth: 0, selectable: false, evented: false, hasControls: false, hasBorders: false, hoverCursor: 'default', lockMovementX: true, lockMovementY: true };
  return { version: '5.5.2', width: W, height: H, background: '#ffffff', objects: [workspace, ...shifted] };
}

/**
 * 앞면: 풀블리드 사진틀 + 촬영일 텍스트(우하단).
 * 사진틀은 재단 밖 도련(bleedMm, 사방)까지 확장한다 — 유지 결정(페이퍼풀이 도련까지 덮어야 재단 후 흰 가장자리가 없다).
 * 유테/이미지풀 창을 재단 기준으로 줄이는 것은 편집기·플러그인 몫(PhotoPrintPlugin bleedPx/resolveFrameWindow)이며 이 저작 기하는 바꾸지 않는다.
 * 카드형(③) 앞면도 같은 함수를 쓴다.
 */
function frontCanvas(W, H, bleedMm) {
  const b = px(bleedMm);
  const photo = frame({ left: -b, top: -b, width: W + 2 * b, height: H + 2 * b });
  const m = px(5);
  const dateW = Math.min(W - 2 * m, px(40));
  return canvasData(W, H, [
    photo,
    dateOverlay(photo.id, { left: W - m - dateW, top: H - m - px(4), width: dateW }),
  ]);
}
/** ① 자유 뒷면: 안내 텍스트 1개(사용자가 지우거나 바꿀 수 있다) */
function backFreeCanvas(W, H) {
  const m = px(8);
  return canvasData(W, H, [
    text('뒷면 — 자유롭게 꾸며 보세요', { id: uid('text'), left: m, top: H / 2 - px(5), width: W - 2 * m, fontSize: px(4), fill: '#9ca3af', textAlign: 'center' }),
  ]);
}
/** ② 고정 뒷면: 로고 자리 사각형 + 브랜드 텍스트(이동·삭제·편집 불가) */
function backFixedCanvas(W, H) {
  const logoW = Math.min(W * 0.4, px(40)), logoH = logoW * 0.5;
  const logoLeft = (W - logoW) / 2, logoTop = H / 2 - logoH;
  return canvasData(W, H, [
    rect({ id: uid('logo'), left: logoLeft, top: logoTop, width: logoW, height: logoH, fill: '#e5e7eb', stroke: '#9ca3af', strokeWidth: 1, name: '로고 자리', ...LOCKED }),
    text('LOGO', { id: uid('text'), left: logoLeft, top: logoTop + logoH / 2 - px(2.5), width: logoW, fontSize: px(4), fill: '#6b7280', textAlign: 'center', name: '로고 텍스트', ...LOCKED }),
    text('이 뒷면은 상품 공통 디자인으로 고정되어 있습니다', { id: uid('text'), left: px(6), top: logoTop + logoH + px(6), width: W - 2 * px(6), fontSize: px(2.6), fill: '#9ca3af', textAlign: 'center', name: '고정 안내', ...LOCKED }),
  ]);
}
/** ③ 카드 뒷면: 자유 텍스트(이름·메시지) */
function cardBackCanvas(W, H) {
  const m = px(6);
  return canvasData(W, H, [
    text('이름 / 메시지', { id: uid('text'), left: m, top: H / 2 - px(4), width: W - 2 * m, fontSize: px(4), fill: '#374151', textAlign: 'center' }),
  ]);
}

const SLOT_LABEL = { front: '앞면', backFree: '뒷면(자유)', backFixed: '뒷면(고정)', cardFront: '카드 앞면', cardBack: '카드 뒷면' };

/** 상품별 템플릿 canvasData. 좌표는 px. */
function buildTemplates(p) {
  const W = px(p.size.widthMm), H = px(p.size.heightMm);
  const builders = {
    front: () => frontCanvas(W, H, p.bleedMm),
    cardFront: () => frontCanvas(W, H, p.bleedMm),
    backFree: () => backFreeCanvas(W, H),
    backFixed: () => backFixedCanvas(W, H),
    cardBack: () => cardBackCanvas(W, H),
  };
  return p.slots.map((slot) => ({ slot, name: `[사진인화 샘플] ${p.label} — ${SLOT_LABEL[slot]}`, canvasData: builders[slot]() }));
}

/** 세트 refs = 슬롯 순서(chemical [앞], digital [앞, 뒤]) — 편집기는 캔버스 k 를 refs[k % refs.length] 로 시드한다 */
function buildRefs(p, ids) {
  return p.slots.map((slot) => ({ templateId: ids[slot], required: true }));
}

// ─── 실행 ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`API ${API} / dry-run=${DRY} / with-site=${WITH_SITE}`);
  const validate = loadValidator();
  if (!validate) console.warn('경고: packages/types/dist/cjs 를 읽지 못해 프로파일 검증을 생략합니다(pnpm --filter @storige/types build)');

  let online = true;
  let existingTemplates = [];
  let existingSets = [];
  try {
    const env = readDevEnv();
    const email = process.env.ADMIN_EMAIL ?? env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD ?? env.ADMIN_PASSWORD;
    if (!email || !password) throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD 가 필요합니다(환경변수 또는 apps/api/.env.development)');
    const login = await call('POST', '/auth/login', { email, password });
    TOKEN = login.accessToken ?? login.token;
    if (!TOKEN) throw new Error('로그인 응답에 accessToken 없음');
    console.log('관리자 로그인 완료');
    existingTemplates = listOf(await call('GET', '/templates?limit=500'));
    // 목록은 pageSize 기본 20 — 운영처럼 세트가 많아도 이름 매칭이 되도록 크게 요청한다(멱등 보장)
    existingSets = listOf(await call('GET', '/template-sets?page=1&pageSize=500'));
  } catch (err) {
    if (!DRY) throw err;
    online = false;
    console.warn(`경고: API 접속/로그인 실패 — 오프라인 dry-run 으로 계속합니다(기존 이름 매칭 생략): ${err.message}`);
  }
  const byName = (list, name) => list.find((t) => t.name === name);

  const results = [];
  for (const p of PRESETS) {
    if (ONLY.length && !ONLY.includes(p.key)) continue;
    const ids = {};
    const built = buildTemplates(p);
    for (const t of built) {
      const found = byName(existingTemplates, t.name);
      const body = { name: t.name, type: 'page', width: p.size.widthMm, height: p.size.heightMm, canvasData: t.canvasData };
      if (DRY) { ids[t.slot] = found?.id ?? `(dry:${t.slot})`; continue; }
      if (found) {
        await call('PATCH', `/templates/${found.id}`, { canvasData: t.canvasData, width: p.size.widthMm, height: p.size.heightMm });
        ids[t.slot] = found.id;
      } else {
        const created = await call('POST', '/templates', body);
        ids[t.slot] = created.id;
        existingTemplates.push(created);
      }
    }
    // ② 고정 뒷면: backTemplateId = 뒷면 템플릿 id(refs[1] 과 같은 id). 다른 composition 은 키 자체를 넣지 않는다.
    const profile = profileFor(p, ids.backFixed);
    if (validate) {
      const errors = validate(profile);
      if (errors.length > 0) throw new Error(`${p.key} 프로파일 검증 실패: ${errors.join('; ')}`);
    }
    const setName = `[사진인화 샘플] ${p.label}`;
    const setBody = {
      name: setName, type: 'leaflet', editorMode: 'single', width: p.size.widthMm, height: p.size.heightMm,
      canAddPage: true, pageCountRange: [p.pages.min, p.pages.max], pageStep: p.pages.step, templates: buildRefs(p, ids),
      productProfile: profile, pdfOutputMode: 'duplex-merged', colorMode: 'rgb', enabledMenus: null,
      // 도련: digital 은 캘린더 정책 A 준용(재단선 마커 + 3mm), chemical 은 미니랩 풀블리드 가정(마커 없음·0mm) — 오너 확정 전.
      cropMarkEnabled: p.cropMarkEnabled, bleedMm: p.bleedMm,
    };
    let setId;
    const foundSet = byName(existingSets, setName);
    if (DRY) setId = foundSet?.id ?? '(dry)';
    else if (foundSet) { await call('PUT', `/template-sets/${foundSet.id}`, setBody); setId = foundSet.id; }
    else { const created = await call('POST', '/template-sets', setBody); setId = created.id; existingSets.push(created); }
    results.push({ key: p.key, label: p.label, size: `${p.size.widthMm}×${p.size.heightMm}`, templateSetId: setId, templates: ids });
    const objectCounts = built.map((t) => `${t.slot}:${t.canvasData.objects.length}obj`).join(' ');
    console.log(`✓ ${p.label} (${p.size.widthMm}×${p.size.heightMm}) → templateSetId=${setId} refs=${p.slots.length} [${objectCounts}] range=[${p.pages.min},${p.pages.max}] step=${p.pages.step}`);
    if (DRY) {
      // 사진틀 기하 확인용(dry-run): 재단 상자 대비 사방 도련 확장량(mm)·stroke — 인쇄 경계선 없음(stroke ''/strokeWidth 0) 을 눈으로 검증
      const mm = (v) => Math.round((v / PX_PER_MM) * 100) / 100;
      for (const t of built) {
        const { width: W, height: H } = t.canvasData;
        for (const o of t.canvasData.objects.filter((x) => x.extensionType === 'frame')) {
          const ext = { l: mm(-W / 2 - o.left), t: mm(-H / 2 - o.top), r: mm(o.left + o.width - W / 2), b: mm(o.top + o.height - H / 2) };
          console.log(`  ${t.slot} 사진틀 ${o.id}: 재단 밖 확장 mm L${ext.l} T${ext.t} R${ext.r} B${ext.b} (도련 ${p.bleedMm}) stroke=${JSON.stringify(o.stroke)} strokeWidth=${o.strokeWidth} fill=${JSON.stringify(o.fill)}`);
        }
      }
    }
  }

  let embedToken = '';
  if (WITH_SITE && !DRY) {
    const host = new URL(API).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host) && !ALLOW_REMOTE) {
      throw new Error(`--with-site 는 로컬 API 전용입니다(${host}). 운영에 사이트·토큰을 만들려면 --allow-remote 를 명시하세요`);
    }
    const siteName = '사진인화 로컬 테스트';
    const sites = listOf(await call('GET', '/sites'));
    let site = sites.find((s) => s.name === siteName);
    if (!site) { const created = await call('POST', '/sites', { name: siteName, domain: 'localhost' }); site = created?.data ?? created; }
    if (!site?.editorAuthCode && site?.id) { const one = await call('GET', `/sites/${site.id}`); site = one?.data ?? one; }
    const code = site.editorAuthCode;
    if (!code) throw new Error('site.editorAuthCode 를 응답에서 읽지 못했습니다');
    const shop = await call('POST', '/auth/shop-session', { memberSeqno: 1002, memberId: 'photo-print-tester', memberName: '사진인화 테스터' }, { 'X-API-Key': code });
    embedToken = shop.accessToken;
    console.log(`사이트 '${siteName}' 준비 — editorAuthCode ****${code.slice(-4)}, shop-session 토큰 발급`);
  }

  console.log('\n=== 결과 ===');
  for (const r of results) {
    const slotIds = Object.entries(r.templates).map(([slot, id]) => `${slot}=${id}`).join(' ');
    console.log(`${r.key}\t${r.size}\tset=${r.templateSetId}\t${slotIds}`);
    if (embedToken) console.log(`  embed: ${EDITOR}/embed?templateSetId=${r.templateSetId}&orderSeqno=<주문번호>&mode=both&token=${PRINT_TOKEN ? embedToken : '<결과 파일의 embedTokenValue>'}&parentOrigin=${encodeURIComponent(EDITOR)}`);
  }
  if (DRY && !online) console.log('(오프라인 dry-run — 등록·이름 매칭 없이 본문 생성과 프로파일 검증만 수행)');
  // 토큰이 들어갈 수 있으므로 저장소 밖에 쓴다(STORIGE_SAMPLES_OUT 로 변경 가능)
  const outFile = process.env.STORIGE_SAMPLES_OUT ?? path.join(os.tmpdir(), 'storige-photo-print-samples.json');
  fs.writeFileSync(outFile, JSON.stringify({ api: API, results, embedToken: embedToken ? '(set)' : '', generatedAt: new Date().toISOString(), ...(embedToken ? { embedTokenValue: embedToken } : {}) }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(outFile, 0o600); } catch { /* 권한 변경 실패는 무시 */ }
  console.log(`\n결과 파일: ${outFile}`);
}

main().catch((err) => { console.error('실패:', err.message); process.exit(1); });
