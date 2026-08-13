/**
 * 표지·내지 칸/구조 분류와 세트 조립.
 * 한글 정본: docs/PRINT_TEMPLATE_GLOSSARY.md
 */

export type PrintTemplateKind = 'cover-fixed' | 'cover-split' | 'inner-sheet' | 'inner-spread' | 'other'

export type InnerRepeatMode = 'last' | 'cycle'

export interface PrintTemplateLike {
  type?: string | null
  width?: number | null
  height?: number | null
  spreadConfig?: {
    regionScope?: string | null
    conversionMode?: string | null
    spec?: { coverWidthMm?: number; coverHeightMm?: number } | null
    innerSpec?: { pageWidthMm?: number; pageHeightMm?: number } | null
  } | null
}

export function classifyPrintTemplate(t: PrintTemplateLike | null | undefined): PrintTemplateKind {
  if (!t) return 'other'
  if (t.type === 'page') return 'inner-sheet'
  if (t.type !== 'spread') return 'other'
  if (t.spreadConfig?.regionScope === 'inner') return 'inner-spread'
  if (t.spreadConfig?.conversionMode === 'flat-spread') return 'cover-fixed'
  return 'cover-split'
}

export function isCoverKind(kind: PrintTemplateKind): boolean {
  return kind === 'cover-fixed' || kind === 'cover-split'
}

export function printKindLabel(kind: PrintTemplateKind): string {
  switch (kind) {
    case 'cover-fixed':
      return '표지펼침면'
    case 'cover-split':
      return '표지3분할'
    case 'inner-sheet':
      return '내지낱장'
    case 'inner-spread':
      return '내지펼침면'
    default:
      return '기타'
  }
}

export function samePrintFormat(a: PrintTemplateLike, b: PrintTemplateLike): boolean {
  const ka = classifyPrintTemplate(a)
  const kb = classifyPrintTemplate(b)
  if (ka !== kb) return false
  if (ka === 'cover-fixed' || ka === 'cover-split') {
    const aw = a.spreadConfig?.spec?.coverWidthMm ?? a.width
    const ah = a.spreadConfig?.spec?.coverHeightMm ?? a.height
    const bw = b.spreadConfig?.spec?.coverWidthMm ?? b.width
    const bh = b.spreadConfig?.spec?.coverHeightMm ?? b.height
    return aw === bw && ah === bh
  }
  if (ka === 'inner-spread') {
    const aw = a.spreadConfig?.innerSpec?.pageWidthMm
    const ah = a.spreadConfig?.innerSpec?.pageHeightMm
    const bw = b.spreadConfig?.innerSpec?.pageWidthMm
    const bh = b.spreadConfig?.innerSpec?.pageHeightMm
    return aw === bw && ah === bh
  }
  return a.width === b.width && a.height === b.height
}

export interface AssembledPrintTemplates<T extends PrintTemplateLike> {
  coverDefault: T | null
  coverPool: T[]
  innerUnit: 'sheet' | 'spread' | 'none'
  innerSeeds: T[]
  innerPool: T[]
}

export function assemblePrintTemplates<T extends PrintTemplateLike>(
  templates: readonly T[],
): AssembledPrintTemplates<T> {
  const covers: T[] = []
  const sheets: T[] = []
  const innerSpreads: T[] = []
  for (const t of templates) {
    const kind = classifyPrintTemplate(t)
    if (isCoverKind(kind)) covers.push(t)
    else if (kind === 'inner-sheet') sheets.push(t)
    else if (kind === 'inner-spread') innerSpreads.push(t)
  }
  const innerUnit: AssembledPrintTemplates<T>['innerUnit'] =
    innerSpreads.length > 0 ? 'spread' : sheets.length > 0 ? 'sheet' : 'none'
  const innerSeeds = innerUnit === 'spread' ? innerSpreads : innerUnit === 'sheet' ? sheets : []
  return {
    coverDefault: covers[0] ?? null,
    coverPool: covers,
    innerUnit,
    innerSeeds,
    innerPool: innerSeeds,
  }
}

/** 세트 저장 검증. 통과면 null, 아니면 운영자 메시지. */
export function validatePrintTemplateAssembly(templates: readonly PrintTemplateLike[]): string | null {
  for (const t of templates) {
    if (t.type === 'wing' || t.type === 'cover' || t.type === 'spine') {
      return '책모드에서는 날개/표지/책등 단품 템플릿을 쓸 수 없습니다. 표지펼침면 또는 표지3분할을 쓰세요.'
    }
  }
  const assembled = assemblePrintTemplates(templates)
  const coverKinds = new Set(
    assembled.coverPool.map((t) => classifyPrintTemplate(t)),
  )
  if (coverKinds.size > 1) {
    return '표지펼침면과 표지3분할을 한 세트에 섞을 수 없습니다.'
  }
  const sheets = templates.filter((t) => classifyPrintTemplate(t) === 'inner-sheet')
  const innerSpreads = templates.filter((t) => classifyPrintTemplate(t) === 'inner-spread')
  if (sheets.length > 0 && innerSpreads.length > 0) {
    return '내지낱장과 내지펼침면을 한 세트에 섞을 수 없습니다.'
  }
  if (!assembled.coverDefault && assembled.innerSeeds.length === 0) {
    return '표지 또는 내지 템플릿이 최소 1개 필요합니다.'
  }
  return null
}

export function expandPrintSeeds<T>(
  seeds: readonly T[],
  targetCount: number,
  mode: InnerRepeatMode = 'last',
): T[] {
  if (seeds.length === 0 || !Number.isFinite(targetCount) || targetCount <= 0) return []
  const n = Math.floor(targetCount)
  if (n <= seeds.length) return seeds.slice(0, n)
  const out: T[] = seeds.slice()
  if (mode === 'cycle') {
    while (out.length < n) out.push(seeds[out.length % seeds.length])
  } else {
    const last = seeds[seeds.length - 1]
    while (out.length < n) out.push(last)
  }
  return out
}

export function filterSwapCandidates<T extends PrintTemplateLike & { id?: string }>(
  catalog: readonly T[],
  current: PrintTemplateLike & { id?: string },
  linkedIds: ReadonlySet<string>,
): T[] {
  const kind = classifyPrintTemplate(current)
  if (kind === 'other') return []
  return catalog.filter((t) => {
    if (t.id && !linkedIds.has(t.id)) return false
    return classifyPrintTemplate(t) === kind && samePrintFormat(t, current)
  })
}
