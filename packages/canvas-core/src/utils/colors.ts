interface RGB {
  r: number
  g: number
  b: number
}

interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

interface CMYK {
  c: number
  m: number
  y: number
  k: number
}

const toStringRgba = (rgba: RGBA) => {
  return `rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a})`
}

const parseColorValue = (value: string | RGB | RGBA): RGBA | null => {
  if (value instanceof Object) {
    // 방어: r/g/b 가 숫자가 아닌 객체(예: fabric Gradient — colorStops 만 보유)가 들어오면
    // "rgba(undefined,...)" 오염을 만들지 않도록 null 을 반환한다.
    const { r, g, b } = value as RGBA
    if (
      typeof r !== 'number' || Number.isNaN(r) ||
      typeof g !== 'number' || Number.isNaN(g) ||
      typeof b !== 'number' || Number.isNaN(b)
    ) {
      return null
    }
    if ('a' in value) {
      return value
    } else {
      return {
        r: value.r,
        g: value.g,
        b: value.b,
        a: 1
      }
    }
  }

  if (value) {
    let color: RGBA = {
      r: 0,
      g: 0,
      b: 0,
      a: 0
    }
    try {
      if (value.includes('#')) {
        if (value.length >= 8) {
          // Color Code HEX8
          color = hex8ToRgba(value)!
        } else {
          // Color Code HEX
          const _v = hexToRgb(value)
          if (_v) {
            color.a = 1
            color.r = _v.r
            color.g = _v.g
            color.b = _v.b
          } else {
            return null
          }
        }
      } else if (value.includes('rgb')) {
        if (value.includes('rgba')) {
          // Color Code RGBA
          color = parseRgba(value)!
        } else {
          // Color Code RGB
          const result = parseRgb(value)

          if (result) {
            color.a = 1
            color.r = result.r
            color.g = result.g
            color.b = result.b
          } else {
            return null
          }
        }
      }
    } catch (error) {
      console.error('parseColorValue', error)
      return null
    }

    return color
  } else {
    return null
  }
}

const parseRgb = (rgbString: string): { r: number; g: number; b: number } | null => {
  const rgbRegex = /^rgb\((\s*\d+\s*),(\s*\d+\s*),(\s*\d+\s*)\)$/i

  if (!rgbRegex.test(rgbString)) {
    return null
  }

  const result = rgbRegex.exec(rgbString)
  if (!result) {
    return null
  }
  const red = parseInt(result[1].trim(), 10)
  const green = parseInt(result[2].trim(), 10)
  const blue = parseInt(result[3].trim(), 10)

  // Parçalanan değerleri nesne olarak döndürelim
  return {
    r: red,
    g: green,
    b: blue
  }
}

const parseRgba = (rgbaString: string): { r: number; g: number; b: number; a: number } | null => {
  // rgba() değerini kontrol etmek için bir regex deseni kullanabiliriz
  const rgbaRegex = /^rgba?\((\s*\d+\s*),(\s*\d+\s*),(\s*\d+\s*),(\s*[\d.]+\s*)\)$/i

  // rgba() değerinin doğruluğunu kontrol edelim
  if (!rgbaRegex.test(rgbaString)) {
    return null
  }

  // rgba() değerinden R, G, B ve A bileşenlerini ayıklayalım
  const result = rgbaRegex.exec(rgbaString)
  if (!result) {
    return null
  }
  const red = parseInt(result[1].trim(), 10)
  const green = parseInt(result[2].trim(), 10)
  const blue = parseInt(result[3].trim(), 10)
  const alpha = parseFloat(result[4].trim())

  // Parçalanan değerleri nesne olarak döndürelim
  return {
    r: red,
    g: green,
    b: blue,
    a: alpha
  }
}

const hex8ToRgba = (hex8: string): { r: number; g: number; b: number; a: number } | null => {
  // HEX8 değerini kontrol etmek için bir regex deseni kullanabiliriz
  const hex8Regex = /^#?([a-f\d]{8})$/i

  // HEX8 değerinin doğruluğunu kontrol edelim
  if (!hex8Regex.test(hex8)) {
    return null
  }

  // HEX8 değerinden R, G, B ve A bileşenlerini ayıklayalım
  const result = hex8Regex.exec(hex8)
  if (!result) {
    return null
  }
  const colorHex = result[1]
  const alphaHex = colorHex.substring(6, 8)

  const red = parseInt(colorHex.substring(0, 2), 16)
  const green = parseInt(colorHex.substring(2, 4), 16)
  const blue = parseInt(colorHex.substring(4, 6), 16)
  const alpha = parseInt(alphaHex, 16) / 255 // HEX8'deki alpha değerini 0-1 aralığına dönüştürme

  // RGBA değerini döndürelim
  return { r: red, g: green, b: blue, a: alpha }
}

const rgbaToHex8 = (r: number, g: number, b: number, a: number) => {
  function componentToHex(c: number) {
    const hex = c.toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }

  const red = componentToHex(Math.round(r))
  const green = componentToHex(Math.round(g))
  const blue = componentToHex(Math.round(b))
  const alpha = componentToHex(Math.round(a * 255))

  return `#${red}${green}${blue}${alpha}`
}

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  try {
    const val = hex
      .replace(
        /^#?([a-f\d])([a-f\d])([a-f\d])$/i,
        // @ts-ignore
        (m, r, g, b) => '#' + r + r + g + g + b + b
      )
      .substring(1)
      .match(/.{2}/g)
      ?.map((x) => parseInt(x, 16))

    const r = val?.[0]
    const g = val?.[1]
    const b = val?.[2]

    if (
      Number.isNaN(r) ||
      Number.isNaN(g) ||
      Number.isNaN(b) ||
      r === undefined ||
      g === undefined ||
      b === undefined
    ) {
      return null
    } else {
      return {
        r: r,
        g: g,
        b: b
      }
    }
  } catch (error) {
    return null
  }
}

const rgbToHue = (r: number, g: number, b: number) => {
  r = r / 255
  g = g / 255
  b = b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let hue

  if (max === r) {
    hue = (g - b) / (max - min)
  } else if (max === g) {
    hue = 2 + (b - r) / (max - min)
  } else {
    hue = 4 + (r - g) / (max - min)
  }

  hue *= 60

  if (hue < 0) {
    hue += 360
  }

  if (Number.isNaN(hue)) hue = 0
  return hue
}

const hsl2Rgb = (h: number, s: number, l: number): number[] => {
  s = s / 100
  l = l / 100
  let rgb: number[] = []
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  if (h >= 0 && h < 60) rgb = [c, x, 0]
  if (h >= 60 && h < 120) rgb = [x, c, 0]
  if (h >= 120 && h < 180) rgb = [0, c, x]
  if (h >= 180 && h < 240) rgb = [0, x, c]
  if (h >= 240 && h < 300) rgb = [x, 0, c]
  if (h >= 300 && h <= 360) rgb = [c, 0, x]

  return rgb.map((v) => Math.round(255 * (v + m)))
}

const rgb2Hex = (r: number, g: number, b: number) => {
  const rgb = b | (g << 8) | (r << 16)
  return '#' + (0x1000000 + rgb).toString(16).slice(1)
}

const hsl2Hex = (h: number, s: number, l: number) => {
  const rgb = hsl2Rgb(h, s, l)
  return { rgb, hexA: rgb2Hex(rgb[0], rgb[1], rgb[2]) }
}

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  let min: number,
    max: number,
    i: number,
    s: number,
    maxcolor: number,
    h: number = 0
  const rgb: number[] = []
  rgb[0] = r / 255
  rgb[1] = g / 255
  rgb[2] = b / 255
  min = rgb[0]
  max = rgb[0]
  maxcolor = 0
  for (i = 0; i < rgb.length - 1; i++) {
    if (rgb[i + 1] <= min) {
      min = rgb[i + 1]
    }
    if (rgb[i + 1] >= max) {
      max = rgb[i + 1]
      maxcolor = i + 1
    }
  }
  if (maxcolor === 0) {
    h = (rgb[1] - rgb[2]) / (max - min)
  }
  if (maxcolor === 1) {
    h = 2 + (rgb[2] - rgb[0]) / (max - min)
  }
  if (maxcolor === 2) {
    h = 4 + (rgb[0] - rgb[1]) / (max - min)
  }

  if (isNaN(h)) {
    h = 0
  }
  h = h * 60
  if (h < 0) {
    h = h + 360
  }
  const l = (min + max) / 2
  if (min === max) {
    s = 0
  } else {
    if (l < 0.5) {
      s = (max - min) / (max + min)
    } else {
      s = (max - min) / (2 - max - min)
    }
  }
  return { h: h, s: s, l: l }
}
const hslToRgb = (h: number, s: number, l: number) => {
  h = (h % 360) / 360

  s = Math.min(1, Math.max(0, s))
  l = Math.min(1, Math.max(0, l))

  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const hueToRgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q

    r = hueToRgb(p, q, h + 1 / 3)
    g = hueToRgb(p, q, h)
    b = hueToRgb(p, q, h - 1 / 3)
  }

  // RGB değerlerini 0 ile 255 arasına dönüştürün

  r = Math.round(r * 255)
  g = Math.round(g * 255)
  b = Math.round(b * 255)

  return { r, g, b }
}

const hsvToRgb = (h: number, s: number, v: number): { r: number; g: number; b: number } => {
  let r: number = 0,
    g: number = 0,
    b: number = 0
  const hue: number = h / 60
  const c: number = v * s
  const x: number = c * (1 - Math.abs((hue % 2) - 1))
  const m: number = v - c

  const segment: number = Math.floor(hue) % 6

  switch (segment) {
    case 0:
      r = c
      g = x
      b = 0
      break
    case 1:
      r = x
      g = c
      b = 0
      break
    case 2:
      r = 0
      g = c
      b = x
      break
    case 3:
      r = 0
      g = x
      b = c
      break
    case 4:
      r = x
      g = 0
      b = c
      break
    case 5:
      r = c
      g = 0
      b = x
      break
    default:
      break
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
  r /= 255
  g /= 255
  b /= 255

  const max: number = Math.max(r, g, b)
  const min: number = Math.min(r, g, b)
  let h: number, s: number
  const v: number = max

  const delta: number = max - min

  if (max !== 0) {
    s = delta / max
  } else {
    // R, G ve B hepsi sıfırsa, renk seviyesi de sıfırdır.
    return { h: 0, s: 0, v: 0 }
  }

  if (delta === 0) {
    h = 0
  } else if (max === r) {
    h = 60 * (((g - b) / delta) % 6)
  } else if (max === g) {
    h = 60 * ((b - r) / delta + 2)
  } else {
    h = 60 * ((r - g) / delta + 4)
  }

  // Hue değeri negatif olamaz, bu yüzden gerekirse 360'a kadar eklenir.
  if (h < 0) {
    h += 360
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100) / 100,
    v: Math.round(v * 100) / 100
  }
}

const hsvToHsl = (h: number, s: number, v: number): { h: number; s: number; l: number } => {
  const l: number = ((2 - s) * v) / 2
  const sat: number = l && l < 1 ? (s * v) / (l < 0.5 ? l * 2 : 2 - l * 2) : s

  return { h: h, s: sat, l: l }
}

/**
 * Legacy CMYK to RGB conversion (basic formula without ICC profile)
 * @deprecated Use cmykToRgb() with LCMS2 engine for accurate color conversion
 */
const cmykToRgbLegacy = (c: number, m: number, y: number, k: number): RGB => {
  c = Math.max(0, Math.min(1, c))
  m = Math.max(0, Math.min(1, m))
  y = Math.max(0, Math.min(1, y))
  k = Math.max(0, Math.min(1, k))

  const r = Math.round(255 * (1 - c) * (1 - k))
  const g = Math.round(255 * (1 - m) * (1 - k))
  const b = Math.round(255 * (1 - y) * (1 - k))

  return {
    r: Math.min(255, Math.max(0, r)),
    g: Math.min(255, Math.max(0, g)),
    b: Math.min(255, Math.max(0, b))
  }
}

/**
 * CMYK to RGB conversion with ICC profile support (LCMS2 기반)
 * 
 * @param c Cyan (0-1)
 * @param m Magenta (0-1)
 * @param y Yellow (0-1)
 * @param k Black (0-1)
 * @param profile ICC profile to use for conversion
 * @param options 변환 옵션
 * @returns RGB 색상 (0-255)
 */
const cmykToRgb = async (
  c: number, 
  m: number, 
  y: number, 
  k: number,
  profile: 'ISO_COATED' | 'JAPAN_COLOR_2001' = 'JAPAN_COLOR_2001',
  options?: { intent?: 'PERCEPTUAL' | 'RELATIVE_COLORIMETRIC' }
): Promise<RGB> => {
  // @pf/color-runtime은 optional dependency - 직접 레거시 폴백 사용
  return cmykToRgbLegacy(c, m, y, k)
}

/**
 * 동기 버전: CMYK → RGB (레거시 알고리즘만 사용)
 * 
 * @deprecated 가능하면 비동기 cmykToRgb() 사용을 권장합니다.
 */
const cmykToRgbSync = (c: number, m: number, y: number, k: number): RGB => {
  return cmykToRgbLegacy(c, m, y, k)
}

/**
 * RGB to CMYK conversion with ICC profile support (LCMS2 기반)
 * 
 * @param r Red (0-255)
 * @param g Green (0-255)
 * @param b Blue (0-255)
 * @param profile ICC profile to use for conversion
 * @param options 변환 옵션
 * @returns CMYK 색상 (0-1)
 */
const rgbToCmyk = async (
  r: number, 
  g: number, 
  b: number,
  profile?: 'ISO_COATED' | 'JAPAN_COLOR_2001',
  options?: { intent?: 'PERCEPTUAL' | 'RELATIVE_COLORIMETRIC' }
): Promise<CMYK> => {
  // @pf/color-runtime은 optional dependency - 직접 레거시 폴백 사용
  return rgbToCmykSimple(r, g, b)
}

/**
 * 동기 버전: RGB → CMYK (단순 알고리즘)
 * 
 * @deprecated 가능하면 비동기 rgbToCmyk() 사용을 권장합니다.
 */
const rgbToCmykSync = (r: number, g: number, b: number): CMYK => {
  return rgbToCmykSimple(r, g, b)
}

/**
 * RGB → CMYK 단순 변환 (프로파일 없음)
 */
const rgbToCmykSimple = (r: number, g: number, b: number): CMYK => {
  r = r / 255
  g = g / 255
  b = b / 255

  const k: number = 1 - Math.max(r, g, b)
  const c: number = (1 - r - k) / (1 - k)
  const m: number = (1 - g - k) / (1 - k)
  const y: number = (1 - b - k) / (1 - k)

  return {
    c: isNaN(c) ? 0 : c,
    m: isNaN(m) ? 0 : m,
    y: isNaN(y) ? 0 : y,
    k: isNaN(k) ? 0 : k
  }
}


export {
  hex8ToRgba,
  hexToRgb,
  hsl2Hex,
  hsl2Rgb,
  hslToRgb,
  parseRgb,
  parseRgba,
  rgb2Hex,
  rgbToHsl,
  rgbToHue,
  rgbaToHex8,
  hsvToRgb,
  rgbToHsv,
  hsvToHsl,
  cmykToRgb,         // 비동기 (LCMS2 기반)
  cmykToRgbSync,     // 동기 (레거시)
  cmykToRgbLegacy,   // 레거시
  rgbToCmyk,         // 비동기 (LCMS2 기반)
  rgbToCmykSync,     // 동기 (레거시)
  parseColorValue,
  toStringRgba
}

