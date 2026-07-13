/**
 * 고객 첨부 내지 PDF 모달 — 인쇄 워크플로우 v1 Phase 4 (2026-05-19).
 *
 * 흐름 (사용자 결정 6건 반영):
 *   1) 파일 선택 (application/pdf 만)
 *   2) /storage/upload-public 또는 /files/upload 로 업로드
 *   3) /worker-jobs/validate (또는 external) 로 검증 잡 생성
 *   4) 폴링: 검증 완료까지 대기 (최대 30s)
 *   5) 결정 3-4: 실패 시 첨부 거부 + 사용자에게 issue 표시
 *   6) 결정 3-2: passed + PDF 페이지수 > 내지 수 인 경우 자동확장 선택 모달
 *   7) /edit-sessions/guest/:id 또는 /edit-sessions/:id 에 contentPdfFileId 저장
 *
 * 결정 3-3: 첨부 성공 시 캔버스 편집 차단 (호출자가 readonly 처리).
 */
import { useEffect, useRef, useState } from 'react'
import { apiClient, toUserMessage } from '../../api/client'
import { editSessionsApi } from '../../api/edit-sessions'
import { useGuestStore } from '../../stores/useGuestStore'
import { uploadViaPresigned, PresignedNotConfiguredError } from '../../api/presigned-upload'

interface Issue {
  code: string
  message: string
  autoFixable?: boolean
}

export interface ValidationResult {
  status: 'completed' | 'fixable' | 'failed'
  pageCount?: number
  /** 실측 페이지 크기(mm) — 검증 result metadata.pageSize (T3 도련 변환 안내 표기용) */
  pageSize?: { width: number; height: number }
  issues?: Issue[]
  warnings?: Issue[]
  /**
   * T3 P2-6(2026-07-13, additive): 도련 자동변환(fix-bleed) 성공 마커 — 세션에 영속되는
   * 검증 result 에 병기. 경고(BLEED_MISSING 등)는 원본(sourceFileId) 기준 검증이고 실제
   * 첨부(contentPdfFileId)는 변환본(fixedFileId)임을 admin 열람자가 식별할 수 있게 한다.
   * 기존 필드 구조는 무변경(변환 성공 시에만 추가).
   */
  bleedFixed?: {
    sourceFileId: string
    fixedFileId: string
    targetSize: { width: number; height: number }
  }
}

/**
 * T3 P2-5(2026-07-13): fix-bleed 폴링 상한(회) — 파일 크기 비례 산출.
 * 기본 40회(×1.5s ≈ 60s) + 100MB 당 20회(≈30s), 추가분 상한 160회 → 총 상한 200회(≈5분).
 * 종전 60s 고정은 대용량(최대 2GB 허용)에서 항상 초과 → 변환 성공하고도 타임아웃 오탐.
 */
export function computeBleedFixPollLimit(fileSizeBytes: number): number {
  const HUNDRED_MB = 100 * 1024 * 1024
  const extra = Math.min(160, Math.ceil(Math.max(0, fileSizeBytes) / HUNDRED_MB) * 20)
  return 40 + extra
}

/**
 * T3(2026-07-13): 목표 작업 사이즈(mm) = 재단(판형) + 사방 bleedMm×2 — 클라 계산(표기·마커
 * 전용, 실 변환값은 서버가 templateSet 으로 권위 산출). 폴백은 validate 의 size 폴백(A4)·
 * bleed 폴백(3)과 동일 기준(레거시 호환).
 */
export function computeBleedFixTargetSize(
  trimSize: { width: number; height: number } | undefined,
  bleedMm: number | undefined,
): { width: number; height: number } {
  const trim = trimSize ?? { width: 210, height: 297 }
  const b = bleedMm ?? 3
  return { width: trim.width + b * 2, height: trim.height + b * 2 }
}

/**
 * T3 P1-3(2026-07-13): fix-bleed 발화 게이트 — 불변식 '재단 사이즈 매치(=completed) + 도련
 * 없음(BLEED_MISSING)일 때만'. 종전엔 failed 만 배제해 fixable(SIZE_MISMATCH+BLEED_MISSING
 * 동반)에서도 발화 → 완전 오사이즈 업로드가 "자동으로 도련을 넣어 변환합니다" 경로로 유입됐다.
 */
export function shouldRunBleedFix(result: ValidationResult): boolean {
  return (
    result.status === 'completed' &&
    (result.warnings ?? []).some((w) => w.code === 'BLEED_MISSING')
  )
}

/** T3 P1-1/P1-2/P2-5(2026-07-13): fix-bleed 잡 폴링 결과 — runBleedFix 가 상태/문구로 매핑 */
export type BleedFixPollOutcome =
  | { kind: 'completed'; outputFileId: string }
  /** COMPLETED 인데 grace 재폴링 후에도 outputFileId 미등록 — 등록 실패 판정 */
  | { kind: 'completed-no-output' }
  | { kind: 'failed' }
  | { kind: 'timeout' }
  /** P1-1: 모달 닫힘 취소 — 호출측은 상태 갱신 없이 조용히 중단 */
  | { kind: 'cancelled' }

export interface BleedFixPollOptions {
  /** 폴링 상한(회) — computeBleedFixPollLimit(file.size) 로 산출 */
  maxAttempts: number
  /** P1-2: COMPLETED+outputFileId=null 레이스 grace 재폴링 횟수 (기본 5) */
  graceAttempts?: number
  /** 폴링 간격(ms) — 테스트 단축용 (기본 1500) */
  intervalMs?: number
  /** P1-1: 취소 신호 — true 면 즉시 cancelled 반환 */
  isCancelled?: () => boolean
}

/**
 * T3(2026-07-13): fix-bleed 잡 상태 폴링.
 * P1-2: API 가 status=COMPLETED 를 먼저 저장한 뒤 별도 save 로 outputFileId 를 등록하는
 * 2단계 쓰기라, 그 틈에 조회하면 COMPLETED+null — 즉시 '등록 실패' 처리하지 않고 grace
 * 재폴링(기본 5회×간격) 후에도 null 이면 실패 판정한다.
 */
export async function pollBleedFixJob(
  getJob: () => Promise<{ status: string; outputFileId?: string | null }>,
  {
    maxAttempts,
    graceAttempts = 5,
    intervalMs = 1500,
    isCancelled = () => false,
  }: BleedFixPollOptions,
): Promise<BleedFixPollOutcome> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  for (let a = 0; a < maxAttempts; a++) {
    await sleep(intervalMs)
    if (isCancelled()) return { kind: 'cancelled' }
    const job = await getJob()
    const s = (job.status || '').toUpperCase()
    if (s === 'COMPLETED') {
      let outputFileId = job.outputFileId ?? null
      for (let g = 0; !outputFileId && g < graceAttempts; g++) {
        await sleep(intervalMs)
        if (isCancelled()) return { kind: 'cancelled' }
        outputFileId = (await getJob()).outputFileId ?? null
      }
      return outputFileId ? { kind: 'completed', outputFileId } : { kind: 'completed-no-output' }
    }
    if (s === 'FAILED') return { kind: 'failed' }
  }
  return { kind: 'timeout' }
}

/** T3(2026-07-13): 도련 자동변환(fix-bleed) 진행 상태 — 모달 내 지속 배너/실패 안내용 */
interface BleedFixState {
  /** 검증 실측 크기(mm, 반올림 표기) — metadata.pageSize 누락 시 null(문구 생략) */
  measured: { width: number; height: number } | null
  /** 목표 작업 크기(mm, 반올림 표기) = trimSize + 2×bleedMm 클라 계산(표기 전용 — 실값은 서버 권위) */
  target: { width: number; height: number }
  status: 'converting' | 'done' | 'failed'
}

interface Props {
  open: boolean
  sessionId: string
  /** 현재 내지 페이지 수 (자동확장 비교용) */
  currentContentPageCount: number
  /** 자동확장 가능 여부 (templateSet.canAddPage) */
  canAddPage: boolean
  /**
   * 검증 기준 재단 사이즈(mm) — templateSet 판형 (C+ G1, 2026-07-11).
   * 종전 A4(210×297) 하드코드는 비-A4 상품의 정상 크기 PDF 를 SIZE_MISMATCH 로
   * 오검증했고(FIXABLE=첨부허용이 마스킹), 워커 게이팅 ON 시 첨부 전면 차단으로
   * flip 하는 원인이었다. 미제공 시에만 A4 폴백(레거시 호환).
   */
  trimSize?: { width: number; height: number }
  /**
   * 검증/변환 기준 도련(mm) — templateSet.bleedMm (T3, 2026-07-13).
   * 종전 orderOptions.bleed:3 하드코드 치환. 미제공 시 3(레거시 호환).
   */
  bleedMm?: number
  /**
   * 도련 자동변환(fix-bleed) 잡 생성용 templateSet id (T3, 2026-07-13).
   * 미제공 시 BLEED_MISSING 이어도 변환 없이 기존 흐름 그대로(레거시 호환).
   */
  templateSetId?: string | null
  /** 닫기 */
  onClose: () => void
  /** 첨부 성공 + 페이지수 합의 끝났을 때 호출 */
  onAttached: (result: {
    contentPdfFileId: string
    contentPdfPageCount: number
    targetPageCount: number  // 자동확장 후 내지 페이지 수
    validationResult: ValidationResult
  }) => void
}

export function ContentPdfAttachModal({
  open,
  sessionId,
  currentContentPageCount,
  canAddPage,
  trimSize,
  bleedMm,
  templateSetId,
  onClose,
  onAttached,
}: Props) {
  const guestToken = useGuestStore((s) => s.guestToken)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPageMismatch, setShowPageMismatch] = useState(false)
  const [guideRendering, setGuideRendering] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [bleedFix, setBleedFix] = useState<BleedFixState | null>(null)

  /**
   * P1-1(2026-07-13 리뷰): 모달 조기 닫힘 → 유령 첨부 방지.
   * 백드롭 클릭(handleClose)으로 닫아도 진행 중 async 체인(검증 폴링→runBleedFix→
   * applyAttachment→가이드 렌더)이 계속 실행되어, 닫힌 뒤 세션에 contentPdfFileId 를
   * PATCH 하고 '첨부됨' 상태를 되살렸다. 닫기 시 true — 각 await 경계에서 확인해
   * 상태 갱신·PATCH 없이 조용히 중단한다. 재오픈/업로드 시작 시 false 리셋.
   */
  const cancelledRef = useRef<boolean>(false)
  useEffect(() => {
    if (open) cancelledRef.current = false
  }, [open])

  if (!open) return null

  const reset = () => {
    setFile(null)
    setUploading(false)
    setValidating(false)
    setValidationResult(null)
    setUploadedFileId(null)
    setError(null)
    setShowPageMismatch(false)
    setGuideRendering(false)
    setUploadPct(0)
    setBleedFix(null)
  }

  const handleClose = () => {
    cancelledRef.current = true // P1-1: 진행 중 async 체인 무력화(각 await 경계 가드가 확인)
    reset()
    onClose()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.type !== 'application/pdf') {
      setError('PDF 파일만 첨부 가능합니다.')
      return
    }
    // 대용량 허용(presigned 직결). 상한 2GB.
    const MAX_ATTACH = 2 * 1024 * 1024 * 1024
    if (f.size > MAX_ATTACH) {
      setError('파일 크기는 2GB 이하만 허용됩니다.')
      return
    }
    setError(null)
    setFile(f)
  }

  /**
   * T3(2026-07-13): 도련 자동 삽입(fix-bleed) — 재단 사이즈로 업로드된 PDF 를 작업 사이즈
   * (판형+bleedMm×2, 실값은 서버가 templateSet 으로 권위 산출)로 변환한 새 파일 id 반환.
   * 실패/타임아웃/outputFileId 미등록(등록 best-effort — COMPLETED 인데 null 이론상 가능)
   * 시 null — 호출측은 첨부를 중단해야 한다(원본 폴백 금지: 잘못된 크기 인쇄 유입 방지).
   */
  const runBleedFix = async (
    sourceFileId: string,
    tsId: string,
    vres: ValidationResult,
  ): Promise<string | null> => {
    // 안내 배너 수치 — 실측=검증 metadata.pageSize, 목표=trimSize+2×bleedMm 클라 계산(반올림 표기).
    // trimSize 폴백은 validate 의 size 폴백(A4)과 동일 기준(레거시 호환).
    const target = computeBleedFixTargetSize(trimSize, bleedMm)
    setBleedFix({
      measured: vres.pageSize
        ? { width: Math.round(vres.pageSize.width), height: Math.round(vres.pageSize.height) }
        : null,
      target: { width: Math.round(target.width), height: Math.round(target.height) },
      status: 'converting',
    })
    try {
      // 사이즈류 필드는 보내지 않는다 — 서버가 templateSet 으로 권위 산출(@Public 계약,
      // forbidNonWhitelisted 로 여분 필드는 400).
      const fixRes = await apiClient.post<{ id: string }>('/worker-jobs/fix-bleed', {
        fileId: sourceFileId,
        templateSetId: tsId,
      })
      const fixJobId = fixRes.data.id

      // 폴링 — 기존 render-pages 패턴(1.5s 간격, 동일 라우트·동일 apiClient).
      // outputFileId 는 잡 응답 최상위 필드(validate 의 result 이중중첩 방어와 무관).
      // P2-5: 상한은 파일 크기 비례(기본 40회≈60s + 100MB 당 20회, 총 상한 200회≈5분)
      //   — 종전 60s 고정은 대용량(최대 2GB)에서 항상 초과.
      // P1-2: COMPLETED+outputFileId=null 레이스는 pollBleedFixJob 내부 grace 재폴링으로 흡수.
      // P1-1: 모달 닫힘(cancelledRef) 시 cancelled — 상태 갱신 없이 조용히 중단.
      const outcome = await pollBleedFixJob(
        async () =>
          (
            await apiClient.get<{ status: string; outputFileId?: string | null }>(
              `/worker-jobs/${fixJobId}`,
            )
          ).data,
        {
          maxAttempts: computeBleedFixPollLimit(file?.size ?? 0),
          isCancelled: () => cancelledRef.current,
        },
      )

      if (outcome.kind === 'cancelled') return null // P1-1: 조용히 중단(오류 표기도 없음)
      if (outcome.kind === 'completed') {
        setBleedFix((prev) => (prev ? { ...prev, status: 'done' } : prev))
        return outcome.outputFileId
      }
      setBleedFix((prev) => (prev ? { ...prev, status: 'failed' } : prev))
      setError(
        outcome.kind === 'failed'
          ? '도련 자동 변환에 실패했습니다. 파일 확인 후 다시 시도해주세요.'
          : outcome.kind === 'completed-no-output'
            ? '도련 변환 결과 등록에 실패했습니다. 다시 시도해주세요.'
            : '도련 변환 시간 초과. 파일이 큰 경우 변환에 시간이 오래 걸릴 수 있습니다. 잠시 후 다시 시도해주세요.',
      )
      return null
    } catch (err) {
      if (cancelledRef.current) return null // P1-1: 닫힌 뒤 오류 — 상태 갱신 없이 중단
      console.error('[ContentPdfAttachModal] fix-bleed', err)
      setBleedFix((prev) => (prev ? { ...prev, status: 'failed' } : prev))
      setError(toUserMessage(err, '도련 자동 변환에 실패했습니다.'))
      return null
    }
  }

  const handleUploadAndValidate = async () => {
    if (!file) return
    cancelledRef.current = false // P1-1: 업로드 시작 시 리셋
    setUploading(true)
    setError(null)
    try {
      // 1) 업로드 — 파일 크기로 경로 분기. 두 경로 모두 fileId 로 통일.
      //    ≤50MB → 기존 /storage/upload-public 멀티파트 폼(검증된 경로, API multer 50MB).
      //    >50MB → presigned 직결(R2 PUT). 미구성(503) 시 명확히 안내.
      const SMALL_THRESHOLD = 50 * 1024 * 1024
      let fileId: string

      const uploadSmallFallback = async (): Promise<string> => {
        // /storage/upload-public 으로 업로드 (게스트도 사용 가능).
        // 임베드(호스트 프록시) 우회 → Storige API 직결. 호스트가 apiBaseUrl 로 base 를
        // 자사 프록시(예: Vercel 서버리스 4.5MB 본문 한도)로 덮어쓴 경우, 정상 크기 PDF
        // (예: 6MB)도 413 "Request Entity Too Large" 로 막히던 문제 해소.
        const form = new FormData()
        form.append('file', file)
        const res = await apiClient.post<{ id: string; url: string }>(
          '/storage/upload-public?category=uploads',
          form,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            baseURL: apiClient.getDirectBaseUrl(),
          }
        )
        return res.data.id
      }

      setUploadPct(0)
      if (file.size <= SMALL_THRESHOLD) {
        // ≤50MB → 기존 멀티파트 폼 업로드(검증된 경로)
        fileId = await uploadSmallFallback()
      } else {
        // >50MB → presigned 직결. 미구성(503) 식별 시 사용자에게 명확히 안내.
        try {
          const r = await uploadViaPresigned(file, {
            isPublic: true, type: 'content', onProgress: setUploadPct,
          })
          fileId = r.fileId
        } catch (e) {
          if (e instanceof PresignedNotConfiguredError) {
            // driver=local → 50MB multer 로는 >50MB 불가. 사용자에게 명확히 안내.
            setError('현재 대용량 업로드(50MB 초과)가 비활성화되어 있습니다. 50MB 이하 PDF 로 시도하거나 관리자에게 문의해주세요.')
            setUploading(false)
            return
          }
          throw e
        }
      }
      if (cancelledRef.current) return // P1-1: 업로드 중 닫힘 — 검증 잡 미생성·상태 미갱신
      setUploadedFileId(fileId)
      setUploading(false)

      // 2) 워커 검증 잡 생성 — 게스트도 가능한 endpoint (validate는 정책상 인증 없음 또는 게스트 허용)
      //    검증 잡 결과 폴링은 단순화 — 향후 SSE 또는 WebSocket 으로 개선.
      setValidating(true)
      const validateRes = await apiClient.post<{ id: string }>(
        '/worker-jobs/validate',
        {
          fileId,
          fileType: 'content',
          orderOptions: {
            // 결정 3-4: 검증 실패 시 거부.
            // C+ G1(2026-07-11): A4 하드코드 제거 — templateSet 판형(trimSize)으로 검증.
            // T3(2026-07-13): bleed 하드코드(3) → templateSet.bleedMm prop 치환(미제공 시 3).
            // validatePageSize 는 재단/재단+블리드×2 어느 쪽이든 매칭을 인정하므로
            // 블리드 0 상품의 재단 크기 PDF 도 통과한다(bleed 0 이면 BLEED_MISSING 자체 미발화).
            // ⚠️ sizeToleranceMm 는 보내지 않는다 — 워커 LEGACY 1mm 폴백 유지
            //    (0.2 로 좁히면 실측 오차 PDF 오검증 실회귀, 2026-06-10 이력).
            size: trimSize ?? { width: 210, height: 297 },
            pages: currentContentPageCount,
            binding: 'perfect',
            bleed: bleedMm ?? 3,
          },
        }
      )
      const jobId = validateRes.data.id

      // 3) 폴링 (최대 30초)
      let attempts = 0
      let result: ValidationResult | null = null
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 1000))
        if (cancelledRef.current) return // P1-1: 검증 폴링 중 닫힘(pre-existing 갭) — 조용히 중단
        const job = await apiClient.get<{ status: string; result?: any; errorMessage?: string }>(
          `/worker-jobs/${jobId}`,
        )
        const s = (job.data.status || '').toUpperCase()
        if (s === 'COMPLETED' || s === 'FIXABLE' || s === 'FAILED') {
          // C+ G1: 검증 잡 result 는 프로세서가 { result } 로 감싸 저장하는 이중 중첩
          // (job.result.result = { isValid, errors, warnings, metadata }) — 방어적으로
          // 단일 중첩도 지원. 종전 코드는 result.pageCount/issues(존재하지 않는 필드)를
          // 읽어 항상 undefined → 페이지수 0·이슈 미표시 버그였다.
          const vr = job.data.result?.result ?? job.data.result
          result = {
            status: s === 'COMPLETED' ? 'completed' : s === 'FIXABLE' ? 'fixable' : 'failed',
            pageCount: vr?.metadata?.pageCount,
            pageSize: vr?.metadata?.pageSize, // T3: 도련 변환 안내 배너 실측 표기용
            issues: vr?.errors?.length ? vr.errors : (job.data.errorMessage ? [{ code: 'WORKER_ERROR', message: job.data.errorMessage }] : []),
            warnings: vr?.warnings,
          }
          break
        }
        attempts++
      }
      if (cancelledRef.current) return // P1-1: 마지막 조회 대기 중 닫힘 — 상태 미갱신
      setValidating(false)

      if (!result) {
        setError('검증 시간 초과. 다시 시도해주세요.')
        return
      }
      setValidationResult(result)

      // 결정 3-4: failed 면 첨부 거부, 사용자가 재첨부만 가능
      if (result.status === 'failed') {
        // 모달 안에서 issues 표시만 — onAttached 호출 안 함
        return
      }

      // T3(2026-07-13): 재단 사이즈 업로드(BLEED_MISSING 경고 = 재단 사이즈 매치·도련 없음
      // 확정 신호) → fix-bleed 잡으로 작업 사이즈(판형+bleedMm×2) 변환본 생성. 이후 첨부와
      // 가이드 래스터(applyAttachment 내 render-pages)는 전부 변환본 outputFileId 로 수행
      // — 미리보기 사방 여백 중앙 정렬은 contentPdfGuide 경로 무수정으로 자동 성립하고,
      // 최종 저장·인쇄(underlay=contentPdfFileId)도 변환본이 된다.
      // templateSetId 미제공(레거시 호출자) 또는 경고 없음이면 기존 흐름 무변경.
      // P1-3: completed 한정 게이트(shouldRunBleedFix) — fixable(SIZE_MISMATCH 동반) 미발화.
      let effectiveFileId = fileId
      if (shouldRunBleedFix(result) && templateSetId) {
        const fixedFileId = await runBleedFix(fileId, templateSetId, result)
        if (cancelledRef.current) return // P1-1: 변환 중 닫힘 — 첨부·상태 갱신 없이 중단
        if (!fixedFileId) {
          // 실패/타임아웃 — 원본 첨부로 폴백하지 않고 명확히 중단(잘못된 크기 인쇄 유입 방지).
          // 오류 표기는 runBleedFix 가 수행(bleedFix.status='failed' 분기 렌더).
          return
        }
        effectiveFileId = fixedFileId
        // P2-6: 세션에 영속되는 검증 result 에 additive 마커 병기 — 경고=원본 기준,
        // 첨부 파일=변환본(fixedFileId)임을 admin 열람자가 식별. 기존 필드 무변경.
        result = {
          ...result,
          bleedFixed: {
            sourceFileId: fileId,
            fixedFileId,
            targetSize: computeBleedFixTargetSize(trimSize, bleedMm),
          },
        }
        // 페이지수 확인 모달(showPageMismatch) 경로도 변환본 fileId + 마커 포함 result 사용.
        setValidationResult(result)
        setUploadedFileId(fixedFileId)
      }

      // 결정 3-2: PDF 페이지수 < 내지 수 → 자동확장 선택 모달
      const pdfPages = result.pageCount ?? 0
      if (pdfPages > currentContentPageCount && canAddPage) {
        setShowPageMismatch(true)
        return
      }

      // 정상 흐름: 그대로 첨부 (페이지수 동일 또는 PDF 가 적음)
      const targetPageCount = pdfPages > currentContentPageCount && canAddPage
        ? pdfPages
        : currentContentPageCount
      await applyAttachment(effectiveFileId, pdfPages, targetPageCount, result)
    } catch (err) {
      if (cancelledRef.current) return // P1-1: 닫힌 뒤 오류 — 상태 갱신 없이 중단
      console.error('[ContentPdfAttachModal]', err)
      setError(toUserMessage(err, '업로드/검증에 실패했습니다.'))
      setUploading(false)
      setValidating(false)
    }
  }

  const applyAttachment = async (
    fileId: string,
    pdfPages: number,
    targetPageCount: number,
    result: ValidationResult,
  ) => {
    // P1-1: 진입 직전 가드 — 닫힌 모달에서 세션 PATCH('첨부됨' 부활) 금지
    if (cancelledRef.current) return
    try {
      // 1) 세션에 첨부 + underlay(표시전용) 모드 저장 — 게스트 / 회원 분기
      const basePayload = {
        contentPdfFileId: fileId,
        contentPdfPageCount: pdfPages,
        contentPdfValidationResult: result as unknown as Record<string, any>,
        contentPdfMode: 'underlay' as const,
      }
      if (guestToken) {
        await editSessionsApi.updateGuest(sessionId, guestToken, basePayload)
      } else {
        await editSessionsApi.update(sessionId, basePayload)
      }

      // 2) 가이드 래스터 잡 트리거 + 폴링 → metadata.contentPdfGuide 저장 (best-effort)
      //    실패해도 첨부 자체는 성공 처리(가이드는 다음 로드/재시도에 생성 가능).
      setGuideRendering(true)
      try {
        // ⚠️ editSessionId 는 보내지 않는다 (C+ G1 리뷰 적발, 2026-07-11).
        //    DTO 상 '추적용'이지만 editSessionId 가 있으면 render 잡이 세션 workerStatus
        //    상태기계(updateEditSessionWorkerStatus)에 진입해, 편집 중(미완료) 세션이
        //    검증 없이 VALIDATED/FAILED 로 오염된다. 가이드 저장은 아래에서 모달이 직접
        //    수행하므로 세션 연결 없이도 기능 손실이 없다.
        //    (종전엔 pageCount:0 이 @Min(1) 400 으로 거부돼 잡 자체가 휴면이었음 —
        //     pageCount 실값화(파싱 수정)로 처음 깨어나는 경로라 여기서 차단.)
        const renderRes = await apiClient.post<{ id: string }>('/worker-jobs/render-pages', {
          fileId,
          pageCount: pdfPages,
        })
        const rjid = renderRes.data.id
        let guide: any = null
        for (let a = 0; a < 40; a++) {
          await new Promise((r) => setTimeout(r, 1500))
          if (cancelledRef.current) return // P1-1: 가이드 폴링 중 닫힘 — metadata PATCH·onAttached 없이 중단
          const job = await apiClient.get<{ status: string; result?: any }>(`/worker-jobs/${rjid}`)
          const s = (job.data.status || '').toUpperCase()
          if (s === 'COMPLETED') { guide = job.data.result; break }
          if (s === 'FAILED') break
        }
        if (cancelledRef.current) return // P1-1: 마지막 조회 대기 중 닫힘
        if (guide?.pageImageUrls?.length) {
          const metaPayload = {
            metadata: {
              contentPdfGuide: {
                sourceFileId: fileId,
                resolution: guide.resolution,
                pageImageUrls: guide.pageImageUrls,
                renderedAt: guide.renderedAt,
              },
            },
          }
          if (guestToken) {
            await editSessionsApi.updateGuest(sessionId, guestToken, metaPayload)
          } else {
            await editSessionsApi.update(sessionId, metaPayload)
          }
        }
      } catch (e) {
        console.warn('[ContentPdfAttachModal] 가이드 래스터 실패(첨부는 성공):', e)
      } finally {
        setGuideRendering(false)
      }

      if (cancelledRef.current) return // P1-1: metadata PATCH 대기 중 닫힘 — '첨부됨' 콜백 억제
      onAttached({
        contentPdfFileId: fileId,
        contentPdfPageCount: pdfPages,
        targetPageCount,
        validationResult: result,
      })
      reset()
      onClose()
    } catch (err) {
      if (cancelledRef.current) return // P1-1: 닫힌 뒤 오류 — 상태 갱신 없이 중단
      console.error('[ContentPdfAttachModal] applyAttachment', err)
      setError(toUserMessage(err, '세션 업데이트에 실패했습니다.'))
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: 'white', padding: 24, borderRadius: 8, minWidth: 480, maxWidth: 640, maxHeight: '80vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 16 }}>내지 PDF 첨부</h2>

        {guideRendering && (
          <div style={{ background: '#e3f2fd', padding: 12, borderRadius: 4, marginBottom: 12, color: '#1565c0', fontSize: 14 }}>
            내지 가이드를 생성하는 중입니다… (페이지 수에 따라 최대 1분)
          </div>
        )}

        {/* T3(2026-07-13): 도련 자동변환 지속 배너 — 변환 시작부터 첨부 완료(모달 닫힘)까지 유지 */}
        {bleedFix && bleedFix.status !== 'failed' && (
          <div style={{ background: '#e8f5e9', padding: 12, borderRadius: 4, marginBottom: 12, color: '#2e7d32', fontSize: 14 }}>
            {bleedFix.measured && (
              <>고객님의 작업 사이즈가 <b>{bleedFix.measured.width}×{bleedFix.measured.height}mm</b>로 업로드 되었습니다.{' '}</>
            )}
            자동으로 도련을 넣어 <b>{bleedFix.target.width}×{bleedFix.target.height}mm</b>로 변환합니다.
            {bleedFix.status === 'converting' ? ' (변환 중…)' : ' (변환 완료)'}
          </div>
        )}

        {!validationResult && (
          <>
            <p style={{ color: '#666', fontSize: 14, marginBottom: 12 }}>
              직접 작성한 PDF 를 첨부하면 각 페이지가 내지에 <strong>가이드</strong>로 표시됩니다.
              최종 내지 인쇄는 <strong>첨부한 원본 PDF 그대로</strong> 입니다(편집 내용은 내지 인쇄에 반영되지 않습니다).
            </p>
            <input type="file" accept="application/pdf" onChange={handleFileChange} disabled={uploading || validating} />
            {uploading && file && file.size > 50 * 1024 * 1024 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>업로드 중… {uploadPct}%</div>
                <div style={{ height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${uploadPct}%`, height: '100%', background: '#1976d2', transition: 'width .2s' }} />
                </div>
              </div>
            )}
            {file && (
              <p style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
                선택: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)
              </p>
            )}
            {error && <div style={{ color: '#d32f2f', marginTop: 12 }}>{error}</div>}

            <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleClose} disabled={uploading || validating}>취소</button>
              <button
                onClick={handleUploadAndValidate}
                disabled={!file || uploading || validating}
                style={{ background: '#1976d2', color: 'white', padding: '6px 16px', border: 0, borderRadius: 4, cursor: 'pointer' }}
              >
                {uploading ? '업로드 중…' : validating ? '검증 중…' : '업로드 + 검증'}
              </button>
            </div>
          </>
        )}

        {validationResult?.status === 'failed' && (
          <>
            <div style={{ color: '#d32f2f', marginTop: 12, fontWeight: 600 }}>검증 실패 — 첨부할 수 없습니다.</div>
            <p style={{ color: '#666', fontSize: 13 }}>
              아래 이슈를 해결 후 다시 첨부해주세요. (결정 3-4: 강제 진행 불허)
            </p>
            <ul style={{ background: '#fff3f3', padding: 12, borderRadius: 4 }}>
              {validationResult.issues?.map((i, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  <strong>{i.code}</strong>: {i.message}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={reset}>다시 시도</button>
            </div>
          </>
        )}

        {/* T3(2026-07-13): 도련 변환 실패 — 원본 폴백 없이 명확히 중단(잘못된 크기 인쇄 유입 방지) */}
        {bleedFix?.status === 'failed' && (
          <>
            <div style={{ color: '#d32f2f', marginTop: 12, fontWeight: 600 }}>
              도련 자동 변환 실패 — 첨부를 중단했습니다.
            </div>
            <p style={{ color: '#666', fontSize: 13 }}>
              잘못된 크기로 인쇄되는 것을 막기 위해 원본 그대로는 첨부하지 않습니다. 다시 시도해주세요.
            </p>
            {error && <div style={{ color: '#d32f2f', fontSize: 13 }}>{error}</div>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={reset}>다시 시도</button>
            </div>
          </>
        )}

        {showPageMismatch && validationResult && uploadedFileId && (
          <>
            {/* C+ G1 리뷰 반영(2026-07-11): 종전 '자동 확장' 라벨은 빈 약속 — targetPageCount
                소비처가 없어 현재 편집 화면의 페이지수/가이드는 즉시 바뀌지 않는다(파싱
                수정으로 이 모달이 처음 실노출되면서 드러남). 실제 효과(인쇄·표시는 첨부
                PDF 페이지수 기준)를 그대로 말하는 카피로 정직화. */}
            <div style={{ background: '#fff8e1', padding: 12, borderRadius: 4, marginTop: 16 }}>
              <strong>페이지 수 확인</strong>
              <p style={{ fontSize: 13, marginTop: 8 }}>
                PDF 가 <b>{validationResult.pageCount}페이지</b>, 현재 내지가 <b>{currentContentPageCount}페이지</b> 입니다.
                그대로 첨부하면 <b>인쇄는 첨부한 PDF({validationResult.pageCount}페이지) 기준</b>이며,
                지금 보이는 편집 화면의 페이지 수는 바뀌지 않습니다.
              </p>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleClose}>취소</button>
              <button
                onClick={() => applyAttachment(
                  uploadedFileId,
                  validationResult.pageCount ?? 0,
                  validationResult.pageCount ?? currentContentPageCount,
                  validationResult,
                )}
                style={{ background: '#1976d2', color: 'white', padding: '6px 16px', border: 0, borderRadius: 4, cursor: 'pointer' }}
              >
                PDF 페이지수({validationResult.pageCount}p)로 첨부
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
