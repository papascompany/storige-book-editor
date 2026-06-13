import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography,
  Card,
  Upload,
  Button,
  Descriptions,
  Alert,
  Input,
  Select,
  Segmented,
  Radio,
  Space,
  Spin,
  Tag,
  message,
} from 'antd';
import { InboxOutlined, SaveOutlined, ArrowLeftOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import {
  convertIdmlToTemplate,
  convertPsdToTemplate,
  extractDesignPackage,
  parseIdml,
} from '@storige/indesign-import';
import type { SpreadTemplateResult, SinglePageResult } from '@storige/indesign-import';
import { TemplateType } from '@storige/types';
import { templatesApi } from '../../api/templates';
import { categoriesApi } from '../../api/categories';
import { libraryApi } from '../../api/library';
import { resolveStorageUrl } from '../../lib/axios';
import {
  classifyUploadName,
  fixDataUrlMime,
  collectPlacedLinkNames,
  buildPlacedMatchRows,
} from './placedMatching';
import type { PlacedMatchRow } from './placedMatching';
import { buildFontMatchRows, seedFontFormatFor, ttfFileNameFor } from './fontMatching';
import type { FontMatchRow } from './fontMatching';
import { sanitizeSvgMarkup } from '../../utils/sanitizeSvg';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

type DesignFormat = 'idml' | 'psd';

const flattenCategories = (cats: CategoryNode[], level = 0): { label: string; value: string }[] => {
  let out: { label: string; value: string }[] = [];
  for (const c of cats) {
    out.push({ label: `${'  '.repeat(level)}${c.name}`, value: c.id });
    if (c.children?.length) out = out.concat(flattenCategories(c.children, level + 1));
  }
  return out;
};

// 업로드 허용 확장자 — IDML 본체(.idml/.zip 패키지) + PSD + 동반 이미지(placed 복원용,
// 변환기 extractDesignPackage 와 동일한 브라우저 디코드 가능 집합)
const UPLOAD_ACCEPT = '.idml,.psd,.zip,.jpg,.jpeg,.png,.gif,.webp,.bmp,.avif';

// 모드 변경 재변환용으로 보관하는 IDML 원본 + 동반 이미지 컨텍스트(A5).
// zip 은 업로드 시 1회만 해제하고 여기 보관해 모드 전환마다 재해제하지 않는다.
interface PendingIdml {
  buffer: ArrayBuffer | Uint8Array;
  baseName: string;
  /** 미리보기 카드 제목에 쓰는 출처 라벨 (파일명 + 동반 이미지 수) */
  sourceLabel: string;
  /** 동반 업로드 이미지: 파일명(NFC) → dataURL — 변환기 linkedImages 로 그대로 주입 */
  linkedImages: Map<string, string>;
  /** zip 에서 변환 불가 형식(TIF/EPS 등)으로 건너뛴 파일명 — 매칭 요약 사유 구체화용 */
  skipped: string[];
}

// 동반 이미지 File → dataURL (file.type 미상이면 확장자 기반 MIME 으로 교정 — <img> 디코드 보장)
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(fixDataUrlMime(file.name, String(reader.result)));
    reader.onerror = () => reject(new Error(`이미지 파일을 읽을 수 없습니다: ${file.name}`));
    reader.readAsDataURL(file);
  });

// IDML 변환 방식 3종 (spreadConfig.conversionMode 와 1:1 대응 — vector→full, hybrid→flat-spread, flat-spine→flat-spine)
type IdmlImportMode = 'vector' | 'hybrid' | 'flat-spine';

const IDML_MODE_OPTIONS: { label: string; value: IdmlImportMode }[] = [
  { label: '벡터 (전체 편집형)', value: 'vector' },
  { label: '펼침면 플랫형 (책등 고정)', value: 'hybrid' },
  { label: '책등가변 3분할 플랫형', value: 'flat-spine' },
];

const IDML_MODE_DESCRIPTIONS: Record<IdmlImportMode, string> = {
  vector:
    '도형·텍스트를 모두 편집 가능한 벡터로 추출합니다 (정밀). 단순한 디자인에 적합합니다.',
  hybrid:
    '텍스트만 편집 가능한 레이어로 두고, 나머지 디자인은 전폭 300dpi PNG 한 장으로 고정합니다. 책등 두께가 고정인 상품(페이지 수 변동 없음)에 사용하세요 — 편집기에서 책등 가변이 차단됩니다.',
  'flat-spine':
    '텍스트만 편집 가능한 레이어로 두고, 디자인을 뒷표지/책등/앞표지 3장의 300dpi PNG 로 분할 고정합니다. 책등 PNG 는 책등 중심 기준 3배폭이라 페이지 수에 따라 책등 두께가 변해도 디자인이 따라갑니다 (책등 가변 책 셋용 권장).',
};

// canvasData 객체(불투명 Record). 변환기는 배경 PNG 를 type='image', src='data:image/png;base64,...'
// 로 내보낸다(idml hybrid → id 'idml-artwork' 1장, idml flat-spine → 'spine-artwork'/'back-artwork'/'front-artwork' 3장,
// psd → id 'psd-artwork').
type CanvasObject = Record<string, unknown>;

// 객체의 src 가 base64 dataURL 인 이미지인지 판정.
const isDataUrlImage = (o: CanvasObject): o is CanvasObject & { src: string } =>
  o.type === 'image' && typeof o.src === 'string' && (o.src as string).startsWith('data:');

// base64 dataURL → File. fetch().blob() 대신 atob 로 직접 디코딩
// (대용량 PNG 에서 fetch(dataUrl) 가 일부 환경에서 느림 — editor useAutoSaveThumbnail 과 동일 패턴).
const dataUrlToFile = (dataUrl: string, fileName: string): File => {
  const match = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  if (!match) throw new Error('배경 이미지 dataURL 형식을 해석할 수 없습니다.');
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
};

/**
 * DB bloat 방지: canvasData 에 인라인된 base64 이미지(들)를 스토리지에 업로드하고
 * 객체의 src 를 스토리지 URL 로 치환한 새 객체 배열을 반환한다.
 *
 * - dataURL 이미지가 없으면(순수 벡터 IDML 등) 입력 배열을 그대로 반환(업로드 0회).
 * - 여러 개여도 모두 처리 (flat-spine 의 spine/back/front 3장 포함). 순서·z-order 보존(map).
 * - A5 placed 복원 이미지(FULL 모드의 편집 가능 image 객체, id 'idml-<self>', 크롭 베이크
 *   PNG dataURL)도 같은 판정(type==='image' && src data:)에 걸려 함께 업로드·치환된다.
 *   FLAT 모드는 변환기에서 이미 아트워크 PNG 에 베이크되므로 기존 아트워크 업로드로 처리.
 * - 한 장이라도 업로드 실패 시 Promise.all 전체 reject → 호출자(saveMutation)가 에러를
 *   표면화하고 저장을 중단 (부분 치환된 깨진 템플릿을 저장하지 않음 — 전체 실패 처리).
 * - 저장 src 는 resolveStorageUrl 로 변환한 값: prod=절대 URL, dev=vite proxy 상대경로.
 *   resolveStorageUrl 은 http(s)/data URL 을 그대로 통과시키므로 멱등.
 */
const uploadInlineBackgrounds = async (
  objects: CanvasObject[],
  baseName: string
): Promise<CanvasObject[]> => {
  let uploadIdx = 0;
  const safeBase = (baseName || 'imported').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'imported';
  return Promise.all(
    objects.map(async (o) => {
      if (!isDataUrlImage(o)) return o;
      // 식별 가능한 파일명: 객체 id(spine-artwork 등)가 있으면 포함 (flat-spine 3장 구분에 유용)
      const idPart = typeof o.id === 'string' && o.id ? `-${(o.id as string).replace(/[^\w.-]+/g, '_').slice(0, 30)}` : '';
      const fileName = `${safeBase}${idPart}-bg-${uploadIdx++}.png`;
      const file = dataUrlToFile(o.src, fileName);
      const uploaded = await libraryApi.uploadFile(file);
      if (!uploaded?.url) throw new Error('배경 이미지 업로드 응답에 URL 이 없습니다.');
      return { ...o, src: resolveStorageUrl(uploaded.url) };
    })
  );
};

export const TemplateImport = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fileName, setFileName] = useState<string>('');
  const [format, setFormat] = useState<DesignFormat>('idml');
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [result, setResult] = useState<SpreadTemplateResult | SinglePageResult | null>(null);
  const [previewSvg, setPreviewSvg] = useState<string>('');
  // 보안(감사 DEP-7 / CVE-2026-27013): previewSvg 는 신뢰할 수 없는 업로드
  // IDML/PSD 변환 결과이며 아래에서 dangerouslySetInnerHTML 로 라이브 DOM 에
  // 주입된다. 주입 전 화이트리스트 새니타이즈로 <script>/on*/javascript: 제거.
  const safePreviewSvg = useMemo(() => sanitizeSvgMarkup(previewSvg), [previewSvg]);
  const [name, setName] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [mode, setMode] = useState<IdmlImportMode>('vector'); // IDML 전용
  const [pageType, setPageType] = useState<'page' | 'cover'>('page'); // PSD 전용
  // 모드 변경 재변환용 IDML 컨텍스트(원본 버퍼 + 동반 이미지). PSD 변환 시 null 로 리셋.
  const [pendingIdml, setPendingIdml] = useState<PendingIdml | null>(null);
  // placed 링크 파일명별 매칭 ✓/✗ 요약 — 동반 이미지를 제공한 변환에서만 채워진다.
  const [matchRows, setMatchRows] = useState<PlacedMatchRow[]>([]);
  // 등록 대상(IDML 표지 한정): 표지 단품 / 책등 가변 셋으로 이어서 등록(방법 A)
  const [registerTarget, setRegisterTarget] = useState<'template' | 'bookset'>('template');

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.getTree,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const categoryOptions = useMemo(
    () => (categories ? flattenCategories(categories as unknown as CategoryNode[]) : []),
    [categories]
  );

  // 폰트 라이브러리 전체(활성+비활성) — 변환 폰트 매칭용. FontList(폰트 관리)와 같은 queryKey 라
  // 시딩 후 invalidate 가 양쪽을 동기화한다.
  const { data: libraryFonts } = useQuery({
    queryKey: ['fonts'],
    queryFn: () => libraryApi.getFonts(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 변환 폰트(doc.fonts) ✓/✗ 매칭 행 — 라이브러리 변경(시딩/활성화) 시 자동 재평가.
  const fontRows = useMemo<FontMatchRow[]>(
    () => (result?.fonts?.length ? buildFontMatchRows(result.fonts, libraryFonts ?? []) : []),
    [result, libraryFonts]
  );

  // 포맷별 결과 캐스팅
  const idmlResult = format === 'idml' ? (result as SpreadTemplateResult | null) : null;
  const psdResult = format === 'psd' ? (result as SinglePageResult | null) : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('변환 결과가 없습니다.');
      const dto = result.draftTemplateDto;
      // 디버그 필드(_idml/_psd) 제거, meta 는 유지(책등 가변/앵커)
      const strippedObjects = dto.canvasData.objects.map((o) => {
        const { _idml, _psd, ...rest } = o as Record<string, unknown>;
        return rest;
      });
      // DB bloat 방지: 인라인 base64 PNG 배경(들)을 스토리지에 업로드하고 src 를 URL 로 치환.
      // dataURL 배경이 없으면(순수 벡터 IDML) 그대로 통과. 업로드 실패 시 throw → 저장 중단.
      const baseName = name.trim() || dto.name;
      const objects = await uploadInlineBackgrounds(strippedObjects, baseName);
      if (format === 'psd') {
        // 단일 페이지(명함/내지 단품): spreadConfig 없음
        return templatesApi.create({
          name: name.trim() || dto.name,
          categoryId,
          type: pageType === 'cover' ? TemplateType.COVER : TemplateType.PAGE,
          width: dto.width,
          height: dto.height,
          canvasData: { ...dto.canvasData, objects } as never,
          isActive: true,
        });
      }
      // IDML 표지 펼침면(spread)
      return templatesApi.create({
        name: name.trim() || dto.name,
        categoryId,
        type: TemplateType.SPREAD,
        width: dto.width,
        height: dto.height,
        canvasData: { ...dto.canvasData, objects } as never,
        spreadConfig: (dto as { spreadConfig?: unknown }).spreadConfig as never,
        isActive: true,
      });
    },
    onSuccess: () => {
      message.success('템플릿이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      // 이동은 handleSave 에서 처리
    },
    onError: (e: unknown) => {
      message.error('템플릿 저장에 실패했습니다: ' + (e instanceof Error ? e.message : '알 수 없는 오류'));
    },
  });

  // 미등록(✗) 폰트 시딩 — 기존 API 만 재사용(신규 엔드포인트 없음):
  //   ttf/otf  : POST /storage/upload → POST /library/fonts (FontList 폰트 관리와 동일 플로우)
  //   woff2    : POST /storage/upload(원본) → POST /library/woff2ToTtf(서버 변환, 편집기
  //              FontPlugin getTtfBuffer 와 동일 엔드포인트) → 변환 TTF 재업로드 → 등록.
  //              TTF 로 등록하면 편집기 opentype.js(글리프검증/PDF 벡터화)가 변환 API 왕복 없이
  //              fast-path 로 직접 파싱한다 (FontPlugin isSfnt 분기).
  // 등록 name 은 doc.fonts 표기 그대로 → 편집기 fontFamily resolve(@font-face font-family)와 일치.
  const seedFontMutation = useMutation({
    mutationFn: async ({ fontName, file }: { fontName: string; file: File }) => {
      const format = seedFontFormatFor(file.name);
      if (!format) throw new Error('TTF/OTF/WOFF2 파일만 등록할 수 있습니다.');
      if (format === 'woff2') {
        const rawUp = await libraryApi.uploadFile(file);
        if (!rawUp?.url) throw new Error('woff2 업로드 응답에 URL 이 없습니다.');
        const ttfBuffer = await libraryApi.convertWoff2ToTtf(rawUp.url);
        const ttfFile = new File([ttfBuffer], ttfFileNameFor(file.name), { type: 'font/ttf' });
        const ttfUp = await libraryApi.uploadFile(ttfFile);
        if (!ttfUp?.url) throw new Error('변환 TTF 업로드 응답에 URL 이 없습니다.');
        return libraryApi.createFont({
          name: fontName,
          fileUrl: ttfUp.url,
          fileFormat: 'ttf',
          isActive: true,
        });
      }
      const up = await libraryApi.uploadFile(file);
      if (!up?.url) throw new Error('폰트 업로드 응답에 URL 이 없습니다.');
      return libraryApi.createFont({
        name: fontName,
        fileUrl: up.url,
        fileFormat: format,
        isActive: true,
      });
    },
    onSuccess: (font) => {
      message.success(`폰트가 라이브러리에 등록되었습니다: ${font.name}`);
      queryClient.invalidateQueries({ queryKey: ['fonts'] }); // → fontRows 재평가
    },
    onError: (e: unknown) => {
      message.error(
        '폰트 등록에 실패했습니다: ' + (e instanceof Error ? e.message : '알 수 없는 오류')
      );
    },
  });

  // 등록되어 있으나 비활성인 폰트 — 편집기는 isActive=true 만 로드하므로 활성화로 사용 가능 처리.
  const activateFontMutation = useMutation({
    mutationFn: ({ id }: { id: string; fontName: string }) =>
      libraryApi.updateFont(id, { isActive: true }),
    onSuccess: (font) => {
      message.success(`폰트를 활성화했습니다: ${font.name}`);
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
    },
    onError: () => {
      message.error('폰트 활성화에 실패했습니다.');
    },
  });

  // 변환 실행 공통 래퍼: 스피너/에러 표면화. 실패 시 부분 결과를 남기지 않는다.
  const runConversion = async (fn: () => Promise<void>) => {
    setConverting(true);
    setConvertError(null);
    try {
      await fn();
    } catch (e) {
      setResult(null);
      setPreviewSvg('');
      setMatchRows([]);
      setConvertError(e instanceof Error ? e.message : '변환에 실패했습니다.');
    } finally {
      setConverting(false);
    }
  };

  /** IDML 버퍼 + 동반 이미지 → 변환 + 매칭 요약. 최초 업로드와 모드 변경 재변환이 같은 경로. */
  const convertPreparedIdml = async (prep: PendingIdml, useMode: IdmlImportMode) => {
    setResult(null);
    setPreviewSvg('');
    setMatchRows([]);
    setFormat('idml');
    const displayName = `${prep.baseName} (가져옴)`;
    // 하위호환(절대 규칙): 동반 이미지가 없으면 linkedImages 옵션 자체를 전달하지 않는다
    // → 변환기 미제공 경로(기존 회색 플레이스홀더 + 경고)가 바이트 단위로 보존된다.
    const linked = prep.linkedImages.size > 0 ? prep.linkedImages : undefined;
    const { result: r, previewSvg: svg } = await convertIdmlToTemplate(prep.buffer, {
      name: displayName,
      previewWidth: 1100,
      mode: useMode,
      ...(linked ? { linkedImages: linked } : {}),
    });
    // 매칭 ✓/✗ 요약 — 이미지를 제공한 경우에만 표시(링크 파일명 목록은 parseIdml 1회로 수집).
    if (linked) {
      const doc = await parseIdml(prep.buffer);
      setMatchRows(
        buildPlacedMatchRows({
          linkNames: collectPlacedLinkNames(doc.items),
          failed: r.placedApplied.failed,
          providedNames: [...prep.linkedImages.keys()],
          skipped: prep.skipped,
        })
      );
    }
    setResult(r);
    setPreviewSvg(svg);
    setName(displayName);
    setFileName(prep.sourceLabel);
  };

  /** PSD 단일 파일 변환 — 기존 동작 그대로(동반 이미지는 픽셀 내장이라 미소비). */
  const convertPsdFile = async (file: File) => {
    setResult(null);
    setPreviewSvg('');
    setMatchRows([]);
    setPendingIdml(null);
    setFormat('psd');
    const baseName = file.name.replace(/\.psd$/i, '');
    const buffer = await file.arrayBuffer();
    const { result: r, previewSvg: svg } = await convertPsdToTemplate(buffer, {
      name: `${baseName} (가져옴)`,
      pageType,
      previewWidth: 1100,
    });
    setResult(r);
    setPreviewSvg(svg);
    setName(`${baseName} (가져옴)`);
    setFileName(file.name);
  };

  /**
   * 업로드 배치 처리 — 단일/다중/zip 모두 한 경로.
   *  - .idml 단독: 기존 동작 그대로(linkedImages 미전달 → 변환기 하위호환 경로).
   *  - .idml + 이미지들(다중 선택/드롭): 이미지를 dataURL 로 읽어 linkedImages 주입(placed 복원).
   *  - .zip: extractDesignPackage 로 판별 — 순수 IDML(designmap.xml)이면 그대로 변환,
   *    패키지(*.idml + Links 이미지)면 내장 IDML + 이미지 추출. 이미지 전용 zip 은
   *    동반 이미지 공급원으로 동작(.idml 동반 또는 직전 변환에 추가).
   *  - 이미지만: 직전 IDML 변환(pendingIdml)에 추가 매칭 후 재변환(누락 이미지 추가 보완용).
   *  - .psd: 기존 단일 파일 동작 그대로. PSD+zip 동시 드롭에서 zip 에 IDML 이 없으면
   *    PSD 변환으로 폴백(동반 이미지는 미소비 — 안내만).
   *  - 디코드 불가 이미지(TIF/EPS/PDF/AI 등): 'JPG/PNG 변환' 안내 + 매칭 요약 사유 구체화.
   */
  const handleFiles = async (incoming: File[]) => {
    const idmls = incoming.filter((f) => classifyUploadName(f.name) === 'idml');
    const psds = incoming.filter((f) => classifyUploadName(f.name) === 'psd');
    const zips = incoming.filter((f) => classifyUploadName(f.name) === 'zip');
    const images = incoming.filter((f) => classifyUploadName(f.name) === 'image');
    // 브라우저 디코드 불가 이미지(TIF/EPS/PDF/AI 등) — zip 경유(skipped)와 동일하게
    // 'JPG/PNG 변환' 안내를 주고, 매칭 요약(skipped)에 합산해 실패 사유를 구체화한다.
    const unsupportedImages = incoming.filter(
      (f) => classifyUploadName(f.name) === 'unsupported-image'
    );
    const others = incoming.filter((f) => classifyUploadName(f.name) === 'other');
    if (unsupportedImages.length) {
      message.warning(
        `브라우저에서 디코드할 수 없는 이미지 형식입니다 — JPG/PNG 로 변환해 다시 업로드하세요: ${unsupportedImages.map((f) => f.name).join(', ')}`
      );
    }
    if (others.length) {
      message.warning(`지원하지 않는 형식은 무시합니다: ${others.map((f) => f.name).join(', ')}`);
    }

    // PSD: 단일 파일 변환(기존 동작). IDML/zip 이 함께 오면 IDML 우선.
    if (psds.length && !idmls.length && !zips.length) {
      if (psds.length > 1) message.warning('PSD 파일이 여러 개입니다 — 첫 번째만 사용합니다.');
      if (images.length) message.info('PSD 는 이미지가 파일에 내장되어 동반 이미지를 사용하지 않습니다.');
      await convertPsdFile(psds[0]);
      return;
    }

    // 동반 이미지 수집: zip 해제분(먼저, 같은 이름 첫 zip 우선) → 개별 이미지 파일(나중, 덮어씀)
    const linkedImages = new Map<string, string>();
    const skipped: string[] = [];
    let zipIdml: { buffer: ArrayBuffer | Uint8Array; name: string } | null = null;
    for (const z of zips) {
      const pkg = await extractDesignPackage(await z.arrayBuffer());
      if (!zipIdml && pkg.idmlBuffer) zipIdml = { buffer: pkg.idmlBuffer, name: z.name };
      for (const [k, v] of pkg.linkedImages) if (!linkedImages.has(k)) linkedImages.set(k, v);
      skipped.push(...pkg.skipped);
    }
    for (const f of images) linkedImages.set(f.name.normalize('NFC'), await fileToDataUrl(f));
    // 개별 드롭된 디코드 불가 이미지도 skipped 에 합산 — placed 링크와 이름이 맞으면 매칭
    // 요약이 '형식 변환 필요' 사유를 표시한다(zip 경유와 동일 품질).
    skipped.push(...unsupportedImages.map((f) => f.name.normalize('NFC')));

    // IDML 본체 결정: .idml 파일 > zip 내장 IDML > (없으면) 직전 변환에 이미지 추가
    let main: { buffer: ArrayBuffer | Uint8Array; fileName: string } | null = null;
    if (idmls.length) {
      if (idmls.length > 1) message.warning('IDML 파일이 여러 개입니다 — 첫 번째만 사용합니다.');
      main = { buffer: await idmls[0].arrayBuffer(), fileName: idmls[0].name };
    } else if (zipIdml) {
      main = { buffer: zipIdml.buffer, fileName: zipIdml.name };
    }

    if (!main) {
      // PSD+zip 동시 드롭(zip 에 IDML 없음) 엣지 — IDML 본체가 없으면 PSD 변환으로 폴백.
      // (PSD 는 픽셀 내장이라 zip/이미지 동반분은 소비하지 않는다 — 안내만.)
      if (psds.length) {
        if (psds.length > 1) message.warning('PSD 파일이 여러 개입니다 — 첫 번째만 사용합니다.');
        if (zips.length || images.length || linkedImages.size) {
          message.info('PSD 는 이미지가 파일에 내장되어 동반 이미지(이미지/zip)를 사용하지 않습니다.');
        }
        await convertPsdFile(psds[0]);
        return;
      }
      if (!linkedImages.size) {
        message.warning('변환할 파일(.idml / 패키지 .zip / .psd)을 선택하세요.');
        return;
      }
      if (!pendingIdml) {
        message.warning('동반 이미지만 받았습니다 — IDML(.idml 또는 패키지 .zip)을 함께 업로드하세요.');
        return;
      }
      // 직전 IDML 변환에 이미지 추가 매칭(같은 이름이면 새 파일 우선) 후 재변환
      const merged = new Map(pendingIdml.linkedImages);
      for (const [k, v] of linkedImages) merged.set(k, v);
      const prep: PendingIdml = {
        ...pendingIdml,
        linkedImages: merged,
        skipped: [...pendingIdml.skipped, ...skipped],
        sourceLabel: merged.size
          ? `${pendingIdml.sourceLabel.replace(/ \(\+동반 이미지 \d+개\)$/, '')} (+동반 이미지 ${merged.size}개)`
          : pendingIdml.sourceLabel,
      };
      setPendingIdml(prep);
      await convertPreparedIdml(prep, mode);
      return;
    }

    const baseName = main.fileName.replace(/\.(idml|indd|zip)$/i, '');
    const sourceLabel = linkedImages.size
      ? `${main.fileName} (+동반 이미지 ${linkedImages.size}개)`
      : main.fileName;
    const prep: PendingIdml = { buffer: main.buffer, baseName, sourceLabel, linkedImages, skipped };
    setPendingIdml(prep);
    await convertPreparedIdml(prep, mode);
  };

  const handleModeChange = (next: IdmlImportMode) => {
    setMode(next);
    // IDML 컨텍스트가 있으면 같은 원본+동반 이미지로 재변환(zip 재해제 없음)
    if (pendingIdml) void runConversion(() => convertPreparedIdml(pendingIdml, next));
  };
  const handlePageTypeChange = (next: 'page' | 'cover') => {
    setPageType(next);
    // pageType 은 저장 시 반영 — 재변환 불필요(결과 동일). 단 미리보기 라벨만 갱신.
  };

  // 저장 후 이동
  const handleSave = async () => {
    try {
      const tpl = await saveMutation.mutateAsync();
      if (format === 'idml' && registerTarget === 'bookset') {
        navigate('/template-sets/new', { state: { seedTemplateId: tpl.id } });
      } else {
        navigate(`/templates/editor?id=${tpl.id}`);
      }
    } catch {
      // onError 에서 처리
    }
  };

  const uploadProps: UploadProps = {
    accept: UPLOAD_ACCEPT,
    multiple: true,
    showUploadList: false,
    beforeUpload: (file, fileList) => {
      // 다중 선택/드롭 시 antd 가 파일마다 호출 — 마지막 파일 차례에 배치 전체를 1회 처리.
      if (file === fileList[fileList.length - 1]) {
        void runConversion(() => handleFiles(fileList as unknown as File[]));
      }
      return false; // 자동 업로드 방지(브라우저에서 직접 변환)
    },
  };

  const typeCounts = useMemo(() => {
    if (!result) return {} as Record<string, number>;
    const c: Record<string, number> = {};
    for (const o of result.draftTemplateDto.canvasData.objects) {
      const k = ((o as { _idml?: { srcType?: string } })._idml?.srcType as string) || (o as { type: string }).type;
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [result]);

  return (
    <div>
      <Space style={{ marginBottom: 16 }} align="center">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/templates')}>
          목록
        </Button>
        <Title level={2} style={{ margin: 0 }}>
          디자인 가져오기 (IDML 표지 · PSD 단품)
        </Title>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="InDesign 표지(IDML·패키지 zip) 또는 Photoshop 단품 디자인(PSD)을 업로드하세요."
        description="브라우저에서 변환되어 미리보기로 확인 후 저장합니다. IDML=표지 펼침면(스프레드), PSD=단일 페이지(명함/내지 단품). IDML 의 배치(링크) 이미지는 같은 파일명의 이미지를 함께 업로드(다중 선택 또는 패키지 zip)하면 자동 복원됩니다. 폰트는 임베드되지 않으므로 누락 폰트는 시딩/확정이 필요합니다."
      />

      {/* IDML 변환 방식(벡터/하이브리드) — 파일 선택 후 표시. PSD 는 항상 하이브리드. */}
      {format === 'idml' && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text strong>변환 방식 (IDML)</Text>
            <Segmented<IdmlImportMode>
              value={mode}
              onChange={(v) => handleModeChange(v)}
              options={IDML_MODE_OPTIONS}
            />
            <Text type="secondary">{IDML_MODE_DESCRIPTIONS[mode]}</Text>
          </Space>
        </Card>
      )}

      <Dragger {...uploadProps} style={{ marginBottom: 16 }}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">IDML·패키지 zip·PSD (+배치 이미지)를 끌어다 놓거나 클릭하여 선택</p>
        <p className="ant-upload-hint">
          .idml — 표지 펼침면 / .zip — IDML+이미지 패키지 / .psd — 단품(명함·내지).
          IDML 배치 이미지는 같은 파일명의 jpg/png 등을 함께 선택하면 자동 복원됩니다 (이미지만 추가로 올리면 직전 변환에 추가 매칭).
        </p>
      </Dragger>

      {converting && (
        <Card style={{ marginBottom: 16, textAlign: 'center' }}>
          <Spin /> <Text style={{ marginLeft: 8 }}>변환 중…</Text>
        </Card>
      )}

      {convertError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message="변환 실패" description={convertError} />
      )}

      {result && (
        <>
          <Card
            title={`미리보기 — ${fileName}`}
            style={{ marginBottom: 16 }}
            styles={{ body: { overflow: 'auto', background: '#fff' } }}
          >
            <div
              style={{ width: '100%', maxWidth: 1100, margin: '0 auto' }}
              dangerouslySetInnerHTML={{ __html: safePreviewSvg }}
            />
          </Card>

          <Card title="감지된 사양" style={{ marginBottom: 16 }}>
            <Descriptions bordered size="small" column={2}>
              {idmlResult && (
                <>
                  <Descriptions.Item label="표지 한 면 (coverWidth)">{idmlResult.spec.coverWidthMm} mm</Descriptions.Item>
                  <Descriptions.Item label="표지 높이 (coverHeight)">{idmlResult.spec.coverHeightMm} mm</Descriptions.Item>
                  <Descriptions.Item label="책등 (spineWidth · 가변)">{idmlResult.spec.spineWidthMm} mm</Descriptions.Item>
                  <Descriptions.Item label="날개 (wing)">
                    {idmlResult.spec.wingEnabled ? `${idmlResult.spec.wingWidthMm} mm` : '없음'}
                  </Descriptions.Item>
                  <Descriptions.Item label="재단여백 (cutSize)">{idmlResult.spec.cutSizeMm} mm</Descriptions.Item>
                  <Descriptions.Item label="총폭 (totalWidth)">
                    <b>{idmlResult.totalWidthMm} mm</b>
                  </Descriptions.Item>
                </>
              )}
              {psdResult && (
                <>
                  <Descriptions.Item label="판형 (가로×세로)">
                    <b>{psdResult.widthMm} × {psdResult.heightMm} mm</b>
                  </Descriptions.Item>
                  <Descriptions.Item label="편집 텍스트 레이어">{psdResult.textCount} 개</Descriptions.Item>
                  <Descriptions.Item label="배경 합성 레이어">{psdResult.rasterCount} 개 → 배경 PNG 1장</Descriptions.Item>
                  <Descriptions.Item label="페이지 타입">{pageType === 'cover' ? '표지(cover)' : '내지/단품(page)'}</Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="추출 객체" span={2}>
                <Space wrap>
                  <Tag color="blue">{result.draftTemplateDto.canvasData.objects.length} 개</Tag>
                  {Object.entries(typeCounts).map(([k, v]) => (
                    <Tag key={k}>
                      {k}: {v}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              {/* placed 링크 파일명별 매칭 ✓/✗ — 동반 이미지를 제공한 IDML 변환에서만 표시 */}
              {idmlResult && matchRows.length > 0 && (
                <Descriptions.Item label="배치 이미지 매칭" span={2}>
                  <Space direction="vertical" size={2}>
                    {matchRows.map((row) => (
                      <div key={`${row.status}:${row.fileName}`}>
                        {row.status === 'matched' ? (
                          <Tag color="green">✓ 복원</Tag>
                        ) : row.status === 'unused' ? (
                          <Tag>참조 없음</Tag>
                        ) : (
                          <Tag color="red">✗ 실패</Tag>
                        )}
                        <Text code>{row.fileName}</Text>
                        {row.frames > 1 && <Text type="secondary"> ×{row.frames}프레임</Text>}
                        {row.reason && <Text type="secondary"> — {row.reason}</Text>}
                      </div>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
              {/* 변환 폰트별 라이브러리 매칭 ✓/✗ — ✗ 폰트는 파일 업로드로 즉시 시딩(등록 후 자동 재평가) */}
              {fontRows.length > 0 && (
                <Descriptions.Item label="폰트 매칭 (라이브러리)" span={2}>
                  <Space direction="vertical" size={2}>
                    {fontRows.map((row) => (
                      <div key={row.fontName}>
                        {row.status === 'available' ? (
                          <Tag color="green">✓ 사용 가능</Tag>
                        ) : row.status === 'inactive' ? (
                          <Tag color="orange">비활성</Tag>
                        ) : (
                          <Tag color="red">✗ 미등록</Tag>
                        )}
                        <Text code>{row.fontName}</Text>
                        {row.status === 'available' &&
                          row.libraryFontName &&
                          row.libraryFontName.trim() !== row.fontName && (
                            <Text type="secondary"> — 라이브러리 표기: {row.libraryFontName}</Text>
                          )}
                        {row.status === 'inactive' && (
                          <>
                            <Text type="secondary"> — 등록되어 있으나 비활성 (편집기 미로드)</Text>
                            <Button
                              size="small"
                              type="link"
                              loading={
                                activateFontMutation.isPending &&
                                activateFontMutation.variables?.fontName === row.fontName
                              }
                              onClick={() =>
                                activateFontMutation.mutate({
                                  id: row.libraryFontId!,
                                  fontName: row.fontName,
                                })
                              }
                            >
                              활성화
                            </Button>
                          </>
                        )}
                        {row.status === 'missing' && (
                          <Upload
                            accept=".ttf,.otf,.woff2"
                            showUploadList={false}
                            beforeUpload={(file) => {
                              seedFontMutation.mutate({ fontName: row.fontName, file: file as unknown as File });
                              return false; // 자동 업로드 방지 — mutation 이 업로드/등록 수행
                            }}
                          >
                            <Button
                              size="small"
                              type="link"
                              icon={<UploadOutlined />}
                              loading={
                                seedFontMutation.isPending &&
                                seedFontMutation.variables?.fontName === row.fontName
                              }
                            >
                              폰트 파일 등록
                            </Button>
                          </Upload>
                        )}
                      </div>
                    ))}
                    <Text type="secondary">
                      미등록 폰트의 텍스트는 편집기에서 기본 폰트로 대체됩니다. TTF/OTF/WOFF2 를
                      등록하면 즉시 사용 가능합니다 (WOFF2 는 서버에서 TTF 변환 후 등록).
                    </Text>
                  </Space>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>

          {result.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="검수 필요 — 변환 손실/주의 항목"
              description={
                <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              }
            />
          )}

          <Card title="저장">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <Text>템플릿명</Text>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="템플릿명"
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text>카테고리</Text>
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  options={categoryOptions}
                  placeholder="카테고리 선택 (선택)"
                  allowClear
                  style={{ width: '100%', marginTop: 4 }}
                />
              </div>

              {/* PSD: 페이지 타입 선택 */}
              {format === 'psd' && (
                <div>
                  <Text>페이지 타입</Text>
                  <Radio.Group
                    value={pageType}
                    onChange={(e) => handlePageTypeChange(e.target.value)}
                    style={{ display: 'flex', gap: 16, marginTop: 4 }}
                  >
                    <Radio value="page">내지/단품 (page)</Radio>
                    <Radio value="cover">표지 (cover)</Radio>
                  </Radio.Group>
                </div>
              )}

              {/* IDML: 등록 대상 선택 */}
              {format === 'idml' && (
                <div>
                  <Text>등록 대상</Text>
                  <Radio.Group
                    value={registerTarget}
                    onChange={(e) => setRegisterTarget(e.target.value)}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}
                  >
                    <Radio value="template">표지 템플릿만 등록 (펼침면 단품)</Radio>
                    <Radio value="bookset">책등 가변 셋으로 이어서 등록 (표지 + 내지 책)</Radio>
                  </Radio.Group>
                </div>
              )}

              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {format === 'psd'
                  ? '단일 페이지 Template 으로 생성됩니다(spread 아님). 저장 후 편집기로 이동해 텍스트 폰트·크기·효과를 확정하세요.'
                  : registerTarget === 'bookset'
                    ? '표지 Template(type=spread) 생성 후, 표지가 미리 추가된 템플릿셋 폼으로 이동합니다. 거기서 내지와 페이지 수 범위를 추가해 책등 가변 책 셋을 완성하세요.'
                    : '표지 Template(type=spread)만 생성하고 편집기로 이동합니다. 셋 구성은 추후 템플릿셋 관리에서 가능합니다.'}
              </Paragraph>
              <Button type="primary" icon={<SaveOutlined />} loading={saveMutation.isPending} onClick={handleSave}>
                {format === 'idml' && registerTarget === 'bookset' ? '저장 후 셋 등록으로 →' : '템플릿으로 저장'}
              </Button>
            </Space>
          </Card>
        </>
      )}
    </div>
  );
};
