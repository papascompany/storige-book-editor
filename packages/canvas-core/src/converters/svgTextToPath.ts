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

interface TextStyle {
  fontSize: number;
  fontWeight: number;
  textDecoration: string;
}

/**
 * Convert SVG text elements to path elements
 *
 * @param ttfBuffer - TTF font buffer from woff2ToTtf API
 * @param svgString - SVG string containing text elements (from textObj.toSVG())
 * @returns Object containing SVG string and font object
 */
export async function convertSvgTextToPath(
  ttfBuffer: ArrayBuffer,
  svgString: string
): Promise<ConvertSvgTextToPathResult> {
  const opentype = await import('opentype.js');

  // Parse TTF buffer to get font
  const font = opentype.parse(ttfBuffer);
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

          dlog('font', `  📝 tspan: "${text}" at (${x.toFixed(2)}, ${y.toFixed(2)}), fontSize: ${style.fontSize}, fontWeight: ${style.fontWeight}, underline: ${style.textDecoration.includes('underline')}, fill: ${finalFill}`);

          // Generate path using OpenType.js at original coordinates
          const path = font.getPath(text, x, y, style.fontSize);
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
            const underlinePath = createUnderlinePath(font, text, x, y, style.fontSize, finalFill);
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
        const pathElement = convertTextElementToPath(font, textElement as SVGTextElement);
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
  textElement: SVGTextElement
): SVGPathElement | SVGGElement | null {
  const text = textElement.textContent || '';
  if (!text.trim()) {
    return null;
  }

  // Get text attributes
  const x = parseFloat(textElement.getAttribute('x') || '0');
  const y = parseFloat(textElement.getAttribute('y') || '0');
  const style = parseTextStyle(textElement);

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

  // Generate path data using OpenType.js
  const path = font.getPath(text, x, y, style.fontSize);
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
    const underlinePath = createUnderlinePath(font, text, x, y, style.fontSize, fill);
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
 * Parse text style including fontWeight and textDecoration
 */
function parseTextStyle(element: SVGTextElement): TextStyle {
  const fontSize = parseFontSize(element);
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

  return { fontSize, fontWeight, textDecoration };
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
