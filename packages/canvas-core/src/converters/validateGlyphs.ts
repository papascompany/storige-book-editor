/**
 * Glyph Validation Utilities
 *
 * Client-side glyph validation using OpenType.js
 * Checks if text characters are supported by a given font
 */

import { dlog, dwarn } from '../utils/debugLog';

export interface GlyphValidationResult {
  hasMissingGlyphs: boolean
  missingChars: string[]
  checkedChars: number
  totalChars: number
}

/**
 * Validate text glyphs using TTF buffer
 *
 * @param ttfBuffer - TTF font buffer (from woff2ToTtf conversion)
 * @param text - Text to validate
 * @returns Validation result with missing characters
 */
export async function validateTextGlyphs(
  ttfBuffer: ArrayBuffer,
  text: string
): Promise<GlyphValidationResult> {
  // Dynamically import opentype.js
  const opentypeModule = await import('opentype.js')
  const opentype = opentypeModule.default

  dlog('font', '🔍 Starting client-side glyph validation')
  dlog('font', `  Text length: ${text.length} characters`)

  // Parse TTF buffer
  const font = opentype.parse(ttfBuffer)
  dlog('font', `✅ Font parsed: ${font.names.fontFamily?.en || font.names.fullName?.en || 'Unknown'}`)
  dlog('font', `  Total glyphs: ${font.numGlyphs}`)

  // Validate each unique character
  const missingChars: string[] = []
  const checkedChars = new Set<string>()

  for (const char of text) {
    // Skip already checked characters
    if (checkedChars.has(char)) continue
    checkedChars.add(char)

    // Skip whitespace and control characters
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue

    try {
      // Get glyphs for character
      const glyphs = font.stringToGlyphs(char)

      if (glyphs.length === 0) {
        // No glyph found
        missingChars.push(char)
        continue
      }

      const glyph = glyphs[0]

      // Check if glyph is valid:
      // - Not .notdef glyph
      // - Has valid path with commands
      const hasValidPath =
        glyph && glyph.path && glyph.path.commands && glyph.path.commands.length > 0

      if (!glyph || glyph.name === '.notdef' || !hasValidPath) {
        missingChars.push(char)
      }
    } catch (error) {
      dwarn('font', `Glyph check failed for character: ${char}`, error)
      // On error, consider character as unsupported
      missingChars.push(char)
    }
  }

  dlog('font', '✅ Glyph validation complete')
  dlog('font', `  Total characters: ${text.length}`)
  dlog('font', `  Unique characters checked: ${checkedChars.size}`)
  dlog('font', `  Missing glyphs: ${missingChars.length}`)

  if (missingChars.length > 0) {
    dlog('font', 
      `  Unsupported characters: ${missingChars
        .map((c) => `'${c}' (U+${c.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')})`)
        .join(', ')}`
    )
  }

  return {
    hasMissingGlyphs: missingChars.length > 0,
    missingChars,
    checkedChars: checkedChars.size,
    totalChars: text.length
  }
}
