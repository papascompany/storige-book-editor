/**
 * SVG Text to Path Converter
 *
 * Converts SVG text elements to path elements using OpenType.js
 * Supports mixed styles (runs), transforms, underline, and fontWeight
 */

import { dlog, dwarn } from '../utils/debugLog';

export interface ConvertSvgTextToPathResult {
  svg: string;
  font: any; // OpenType.js Font object for baseline correction
}

/**
 * 혼합폰트(runs) 지원용 폰트 리졸버.
 * tspan 의 font-family 에 해당하는 opentype.Font 를 동기 반환한다(없으면 null → 기본폰트 폴백).
 * FontPlugin 이 export 전에 필요한 모든 폰트의 opentype.Font 를 미리 파싱해 Map 으로 넘긴다.
 */
export type OpenTypeFontResolver = (fontFamily: string) => any | null;

interface TextStyle {
  fontSize: number;
  fontWeight: number;
  textDecoration: string;
  fontFamily: string | null;
}

/**
 * Convert SVG text elements to path elements
 *
 * @param ttfBuffer - TTF font buffer from woff2ToTtf API (기본/폴백 폰트)
 * @param svgString - SVG string containing text elements (from textObj.toSVG())
 * @param fontResolver - (선택) tspan 별 font-family → opentype.Font 리졸버.
 *   혼합폰트(runs) 텍스트에서 각 tspan 을 자기 폰트로 아웃라인하기 위해 사용.
 *   미지정/미스 시 ttfBuffer 의 기본 폰트로 폴백한다.
 * @returns Object containing SVG string and font object
 */
export async function convertSvgTextToPath(
  ttfBuffer: ArrayBuffer,
  svgString: string,
  fontResolver?: OpenTypeFontResolver
): Promise<ConvertSvgTextToPathResult> {
  const opentype = await import('opentype.js');

  // Parse TTF buffer to get font
  const font = opentype.parse(ttfBuffer);

  /**
   * tspan/text 의 font-family 에 맞는 opentype.Font 를 고른다.
   * - resolver 가 해당 폰트를 알고 있으면 그 폰트 사용(혼합폰트 정확도↑)
   * - 모르면(=미로드/미변환) 기본 폰트로 폴백 → 절대 throw 하지 않음(export 보호)
   */
  const pickFont = (fontFamily: string | null): any => {
    if (fontFamily && fontResolver) {
      try {
        const resolved = fontResolver(fontFamily);
        if (resolved) return resolved;
        dwarn('font', `⚠️  per-run 폰트 미해결(기본폰트 폴백): "${fontFamily}"`);
      } catch (e) {
        dwarn('font', `⚠️  per-run 폰트 리졸브 오류(기본폰트 폴백): "${fontFamily}"`, e);
      }
    }
    return font;
  };
  dlog('font', `✅ Font parsed: ${font.names.fullName?.en || 'Unknown'}`);

  // Parse SVG string
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');

  // Check for parsing errors
  const parserError = svgDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`SVG parsing error: ${parserError.textContent}`);
  }

  // Find all <text> elements (not tspan - they will be handled within text elements)
  const textElements = svgDoc.querySelectorAll('text');
  dlog('font', `🔍 Found ${textElements.length} text elements to convert`);

  if (textElements.length === 0) {
    dwarn('font', '⚠️  No text elements found in SVG');
    return { svg: svgString, font };
  }

  const svgNS = 'http://www.w3.org/2000/svg';

  // Log if there's a parent transform (preserve it for Fabric.js)
  const outerG = svgDoc.querySelector('g[transform]');
  if (outerG) {
    const transformAttr = outerG.getAttribute('transform');
    dlog('font', `🔄 Parent transform will be preserved: ${transformAttr}`);
  }

  // Convert each <text> element
  for (const textElement of Array.from(textElements)) {
    try {
      const tspans = textElement.querySelectorAll('tspan');

      if (tspans.length > 0) {
        // Case 1: <text> with <tspan> children (multi-line or styled text / mixed styles)
        dlog('font', `📝 Converting <text> with ${tspans.length} tspan children`);
        dlog('font', 'textElement', textElement);
        // Create a group to hold all converted paths
        const groupElement = document.createElementNS(svgNS, 'g');

        // Get common attributes from parent text element
        // Extract fill from parent (check both attribute and style)
        let fill = textElement.getAttribute('fill');
        if (!fill) {
          const parentStyle = textElement.getAttribute('style');
          if (parentStyle) {
            const fillMatch = parentStyle.match(/fill:\s*([^;}"']+)/);
            if (fillMatch) {
              fill = fillMatch[1].trim();
            }
          }
        }
        fill = fill || 'black';

        const stroke = textElement.getAttribute('stroke') || '';
        const strokeWidth = textElement.getAttribute('stroke-width') || '0';

        // Convert each tspan to path
        for (const tspan of Array.from(tspans)) {
          const text = tspan.textContent || '';
          if (!text.trim()) continue;

          const x = parseFloat(tspan.getAttribute('x') || '0');
          const y = parseFloat(tspan.getAttribute('y') || '0');
          const style = parseTextStyle(tspan as SVGTextElement);

          // Extract fill from tspan (check both attribute and style)
          let tspanFill = tspan.getAttribute('fill');
          if (!tspanFill) {
            // Try to extract from style attribute
            const styleAttr = tspan.getAttribute('style');
            if (styleAttr) {
              // Match various fill formats: rgba(...), rgb(...), #hex, color names
              const fillMatch = styleAttr.match(/fill:\s*([^;}"']+)/);
              if (fillMatch) {
                tspanFill = fillMatch[1].trim();
              }
            }
          }

          const finalFill = tspanFill || fill;

          // 혼합폰트(runs): 이 tspan 의 font-family 에 맞는 폰트로 아웃라인.
          // 미해결 시 기본 폰트로 폴백(pickFont 내부에서 처리).
          const runFont = pickFont(style.fontFamily);

          dlog('font', `  📝 tspan: "${text}" at (${x.toFixed(2)}, ${y.toFixed(2)}), fontSize: ${style.fontSize}, fontWeight: ${style.fontWeight}, fontFamily: ${style.fontFamily ?? '(inherit)'}, underline: ${style.textDecoration.includes('underline')}, fill: ${finalFill}`);

          // Generate path using OpenType.js at original coordinates
          const path = runFont.getPath(text, x, y, style.fontSize);
          const pathData = path.toPathData(2);

          if (!pathData || pathData.trim().length === 0) {
            dwarn('font', `  ⚠️  Empty path for: "${text}"`);
            continue;
          }

          // Create path element
          const pathElement = document.createElementNS(svgNS, 'path');
          pathElement.setAttribute('d', pathData);

          // P1-6 (2026-06-02): 곡선 텍스트 보존.
          // Fabric은 path(text-on-path) 텍스트의 각 글자 <tspan>에 회전된 x/y + rotate 속성을 출력한다.
          // opentype path 는 (x,y) baseline 에 평평하게 생성되므로, tspan rotate 만큼 (x,y) 기준 회전을
          // path 요소 transform 으로 그대로 적용해야 PDF 에서도 호를 따라 글자가 회전된다.
          // (rotate 속성이 없는 일반/혼합스타일 텍스트는 영향 없음.)
          const rotateAttr = tspan.getAttribute('rotate');
          if (rotateAttr) {
            const deg = parseFloat(rotateAttr);
            if (Number.isFinite(deg) && Math.abs(deg) > 0.001) {
              pathElement.setAttribute('transform', `rotate(${deg} ${x} ${y})`);
            }
          }

          // Preserve per-tspan fill color (for mixed styles support)
          pathElement.setAttribute('fill', finalFill);

          // Log font weight (not applied - see logFontWeight function for details)
          logFontWeight(style.fontWeight, text);

          const tspanStroke = tspan.getAttribute('stroke');
          if (tspanStroke || stroke) {
            pathElement.setAttribute('stroke', tspanStroke || stroke);
          }
          if (strokeWidth && strokeWidth !== '0') {
            pathElement.setAttribute('stroke-width', strokeWidth);
          }

          groupElement.appendChild(pathElement);

          // Add underline if needed
          if (style.textDecoration.includes('underline')) {
            const underlinePath = createUnderlinePath(runFont, text, x, y, style.fontSize, finalFill);
            groupElement.appendChild(underlinePath);
          }

          dlog('font', `  ✅ Path added with fill: ${finalFill}`);
        }

        // Copy attributes from text element to group
        const attributesToCopy = ['opacity', 'fill-opacity', 'stroke-opacity', 'style', 'class', 'id'];
        for (const attr of attributesToCopy) {
          const value = textElement.getAttribute(attr);
          if (value) groupElement.setAttribute(attr, value);
        }

        // Replace text element with group
        textElement.parentNode?.replaceChild(groupElement, textElement);
        dlog('font', `✅ Converted <text> with ${tspans.length} tspans to <g> with paths`);

      } else {
        // Case 2: Simple <text> without tspan children
        const pathElement = convertTextElementToPath(font, textElement as SVGTextElement, pickFont);
        if (pathElement) {
          // Replace text element with path element
          textElement.parentNode?.replaceChild(pathElement, textElement);
        }
      }
    } catch (error) {
      console.error('Error converting text element:', error);
    }
  }

  // Serialize back to string
  const serializer = new XMLSerializer();
  const resultSvg = serializer.serializeToString(svgDoc);

  dlog('font', '✅ SVG text elements converted to paths');
  dlog('font', '📄 CONVERTED SVG STRING:');
  dlog('font', '📄 END OF CONVERTED SVG STRING');

  return { svg: resultSvg, font };
}

/**
 * Convert a single text element to a path element or group (if underline)
 */
function convertTextElementToPath(
  font: any,
  textElement: SVGTextElement,
  pickFont?: (fontFamily: string | null) => any
): SVGPathElement | SVGGElement | null {
  const text = textElement.textContent || '';
  if (!text.trim()) {
    return null;
  }

  // Get text attributes
  const x = parseFloat(textElement.getAttribute('x') || '0');
  const y = parseFloat(textElement.getAttribute('y') || '0');
  const style = parseTextStyle(textElement);

  // <text> 자체의 font-family 에 맞는 폰트 선택(미지정/미해결 시 기본 폰트).
  const elFont = pickFont ? pickFont(style.fontFamily) : font;

  // Extract fill (check both attribute and style)
  let fill = textElement.getAttribute('fill');
  if (!fill) {
    const styleAttr = textElement.getAttribute('style');
    if (styleAttr) {
      // Match various fill formats: rgba(...), rgb(...), #hex, color names
      const fillMatch = styleAttr.match(/fill:\s*([^;}"']+)/);
      if (fillMatch) {
        fill = fillMatch[1].trim();
      }
    }
  }
  fill = fill || 'black';

  const stroke = textElement.getAttribute('stroke') || '';
  const strokeWidth = textElement.getAttribute('stroke-width') || '0';
  const transform = textElement.getAttribute('transform') || '';

  dlog('font', `📝 Converting text: "${text}" at (${x}, ${y}), fontSize: ${style.fontSize}, fontWeight: ${style.fontWeight}, underline: ${style.textDecoration.includes('underline')}, fill: ${fill}`);

  // Generate path data using OpenType.js (요소별 폰트 사용)
  const path = elFont.getPath(text, x, y, style.fontSize);
  const pathData = path.toPathData(2);

  if (!pathData || pathData.trim().length === 0) {
    dwarn('font', `Empty path data for text: "${text}"`);
    return null;
  }

  const svgNS = 'http://www.w3.org/2000/svg';

  // Check if we need a group (for underline)
  const hasUnderline = style.textDecoration.includes('underline');

  if (hasUnderline) {
    // Create group for text path + underline path
    const groupElement = document.createElementNS(svgNS, 'g');

    // Create text path
    const pathElement = document.createElementNS(svgNS, 'path');
    pathElement.setAttribute('d', pathData);
    pathElement.setAttribute('fill', fill);

    // Log font weight (not applied - see logFontWeight function for details)
    logFontWeight(style.fontWeight, text);

    if (stroke) {
      pathElement.setAttribute('stroke', stroke);
    }
    if (strokeWidth && strokeWidth !== '0') {
      pathElement.setAttribute('stroke-width', strokeWidth);
    }

    groupElement.appendChild(pathElement);

    // Create underline path
    const underlinePath = createUnderlinePath(elFont, text, x, y, style.fontSize, fill);
    groupElement.appendChild(underlinePath);

    // Apply transform to group
    if (transform) {
      groupElement.setAttribute('transform', transform);
    }

    // Copy other attributes to group
    const attributesToCopy = ['opacity', 'fill-opacity', 'stroke-opacity', 'class', 'id'];
    for (const attr of attributesToCopy) {
      const value = textElement.getAttribute(attr);
      if (value) {
        groupElement.setAttribute(attr, value);
      }
    }

    return groupElement;
  } else {
    // Create single path element
    const pathElement = document.createElementNS(svgNS, 'path');
    pathElement.setAttribute('d', pathData);
    pathElement.setAttribute('fill', fill);

    // Log font weight (not applied - see logFontWeight function for details)
    logFontWeight(style.fontWeight, text);

    if (stroke) {
      pathElement.setAttribute('stroke', stroke);
    }
    if (strokeWidth && strokeWidth !== '0') {
      pathElement.setAttribute('stroke-width', strokeWidth);
    }
    if (transform) {
      pathElement.setAttribute('transform', transform);
    }

    // Copy other attributes (opacity, style, etc.)
    const attributesToCopy = ['opacity', 'fill-opacity', 'stroke-opacity', 'class', 'id'];
    for (const attr of attributesToCopy) {
      const value = textElement.getAttribute(attr);
      if (value) {
        pathElement.setAttribute(attr, value);
      }
    }

    return pathElement;
  }
}

/**
 * Parse font size from SVG text element
 * Handles inheritance from parent elements for tspan
 */
function parseFontSize(element: SVGTextElement): number {
  // Try font-size attribute on current element
  const fontSizeAttr = element.getAttribute('font-size');
  if (fontSizeAttr) {
    return parseFloat(fontSizeAttr);
  }

  // Try style attribute on current element
  const style = element.getAttribute('style');
  if (style) {
    const match = style.match(/font-size:\s*([0-9.]+)/);
    if (match) {
      return parseFloat(match[1]);
    }
  }

  // If tspan, try to inherit from parent text element
  if (element.tagName === 'tspan' && element.parentElement) {
    const parentFontSize = element.parentElement.getAttribute('font-size');
    if (parentFontSize) {
      return parseFloat(parentFontSize);
    }

    const parentStyle = element.parentElement.getAttribute('style');
    if (parentStyle) {
      const match = parentStyle.match(/font-size:\s*([0-9.]+)/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
  }

  // Try computed style (if in browser)
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const computedStyle = window.getComputedStyle(element);
    const fontSize = computedStyle.fontSize;
    if (fontSize) {
      return parseFloat(fontSize);
    }
  }

  // Default font size
  return 16;
}

/**
 * font-family 원시값에서 첫 패밀리명만 정규화 추출.
 * - 콤마 폴백목록(", sans-serif") 제거 → 첫 패밀리만
 * - 양끝 작은/큰따옴표 제거 + 트림
 * - 빈 값이면 null
 * (테스트 가능하도록 export — DOM 불필요한 순수 함수)
 */
export function cleanFontFamilyValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0].trim().replace(/^['"]|['"]$/g, '').trim();
  return first.length > 0 ? first : null;
}

/**
 * Parse font-family from an SVG text/tspan element.
 * fabric 은 혼합폰트 run 의 font-family 를 tspan 의 style="font-family: '...'" 로,
 * <text> 루트는 font-family 속성으로 출력한다. 둘 다 + tspan→부모 상속을 본다.
 * 따옴표/뒤따르는 폴백목록(", sans-serif")은 제거해 첫 패밀리명만 반환.
 */
function parseFontFamily(element: SVGTextElement): string | null {
  const clean = cleanFontFamilyValue;

  // 1) font-family 속성
  const attr = element.getAttribute('font-family');
  if (attr) {
    const c = clean(attr);
    if (c) return c;
  }

  // 2) style="font-family: ..."
  const style = element.getAttribute('style');
  if (style) {
    const m = style.match(/font-family:\s*([^;}"']+(?:'[^']*'|"[^"]*")?[^;}]*)/i);
    if (m) {
      const c = clean(m[1]);
      if (c) return c;
    }
  }

  // 3) tspan 은 부모 <text> 에서 상속
  if (element.tagName === 'tspan' && element.parentElement) {
    const parentAttr = element.parentElement.getAttribute('font-family');
    if (parentAttr) {
      const c = clean(parentAttr);
      if (c) return c;
    }
    const parentStyle = element.parentElement.getAttribute('style');
    if (parentStyle) {
      const m = parentStyle.match(/font-family:\s*([^;}"']+(?:'[^']*'|"[^"]*")?[^;}]*)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return c;
      }
    }
  }

  return null;
}

/**
 * Parse text style including fontWeight and textDecoration
 */
function parseTextStyle(element: SVGTextElement): TextStyle {
  const fontSize = parseFontSize(element);
  const fontFamily = parseFontFamily(element);
  let fontWeight = 400; // normal
  let textDecoration = 'none';

  // Parse from style attribute
  const style = element.getAttribute('style');
  if (style) {
    // Parse font-weight
    const weightMatch = style.match(/font-weight:\s*([0-9]+|bold|normal)/i);
    if (weightMatch) {
      const weightStr = weightMatch[1].toLowerCase();
      if (weightStr === 'bold') {
        fontWeight = 700;
      } else if (weightStr === 'normal') {
        fontWeight = 400;
      } else {
        fontWeight = parseInt(weightStr, 10);
      }
    }

    // Parse text-decoration
    const decorationMatch = style.match(/text-decoration:\s*([^;}"']+)/i);
    if (decorationMatch) {
      textDecoration = decorationMatch[1].trim();
    }
  }

  // Parse from individual attributes
  const fontWeightAttr = element.getAttribute('font-weight');
  if (fontWeightAttr) {
    if (fontWeightAttr.toLowerCase() === 'bold') {
      fontWeight = 700;
    } else if (fontWeightAttr.toLowerCase() === 'normal') {
      fontWeight = 400;
    } else {
      fontWeight = parseInt(fontWeightAttr, 10);
    }
  }

  const textDecorationAttr = element.getAttribute('text-decoration');
  if (textDecorationAttr) {
    textDecoration = textDecorationAttr;
  }

  // Inherit from parent if tspan
  if (element.tagName === 'tspan' && element.parentElement) {
    const parentStyle = element.parentElement.getAttribute('style');
    if (parentStyle && fontWeight === 400) {
      const weightMatch = parentStyle.match(/font-weight:\s*([0-9]+|bold|normal)/i);
      if (weightMatch) {
        const weightStr = weightMatch[1].toLowerCase();
        if (weightStr === 'bold') {
          fontWeight = 700;
        } else if (weightStr !== 'normal') {
          fontWeight = parseInt(weightStr, 10);
        }
      }
    }
  }

  return { fontSize, fontWeight, textDecoration, fontFamily };
}

/**
 * Create underline path for text
 */
function createUnderlinePath(
  font: any,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string
): SVGPathElement {
  const svgNS = 'http://www.w3.org/2000/svg';

  // Calculate text width using OpenType.js
  const glyphs = font.stringToGlyphs(text);
  let textWidth = 0;
  glyphs.forEach((glyph: any) => {
    if (glyph.advanceWidth) {
      textWidth += (glyph.advanceWidth / font.unitsPerEm) * fontSize;
    }
  });

  // Underline parameters (based on font metrics or defaults)
  const underlineThickness = fontSize * 0.05; // 5% of font size
  const underlinePosition = y + fontSize * 0.15; // 15% below baseline

  // Create underline as a rectangle path
  const pathData = `M ${x} ${underlinePosition} L ${x + textWidth} ${underlinePosition} L ${x + textWidth} ${underlinePosition + underlineThickness} L ${x} ${underlinePosition + underlineThickness} Z`;

  const pathElement = document.createElementNS(svgNS, 'path');
  pathElement.setAttribute('d', pathData);
  pathElement.setAttribute('fill', fill);

  return pathElement;
}

/**
 * Log fontWeight for debugging
 *
 * TODO: Implement proper bold font loading
 * Current limitation: fontWeight is detected but not applied because:
 * - Stroke-based fake bold doesn't match real bold fonts
 * - Stroke conflicts with existing text strokes
 * - Each font family needs separate bold variant files (e.g., Roboto-Bold.woff2)
 *
 * Future improvement:
 * - Load correct font variant based on fontWeight (400=Regular, 700=Bold, etc.)
 * - Pass multiple TTF buffers to convertSvgTextToPath (one per weight)
 * - Use appropriate font for each tspan based on its fontWeight
 */
function logFontWeight(fontWeight: number, text: string): void {
  if (fontWeight >= 600) {
    dwarn('font', `⚠️ fontWeight ${fontWeight} detected for "${text}" but not applied - requires actual bold font file`);
  }
}
