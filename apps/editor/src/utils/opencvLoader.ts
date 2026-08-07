/**
 * OpenCV 배선 — SPA 엔트리(main.tsx) 전용 side-effect 모듈. (2026-08-07 워커 전환)
 *
 * 실측 확정 사실: @techstark/opencv-js 의 dist/opencv.js(wasm 인라인 UMD)는 **메인 스레드에서는
 * 어떤 로드 방식으로도 실행이 끝나지 않는다** — ESM import 도, 클래식 <script> 태그도 실제
 * Chrome 탭을 10분+ 굳혔다(canvas-core/utils/contourExtractor.ts 헤더에 실측 경위).
 *
 * 그래서 윤곽 추출(cv 사용부 전체)을 **Blob 클래식 워커**로 옮긴다:
 *  - Blob 워커인 이유: vite 는 dev 에서 워커를 module 로 서빙하는데 module 워커는
 *    importScripts 를 못 쓴다. Blob + 클래식 워커는 dev/build 모두 동일하게 동작한다.
 *  - 워커 안의 importScripts 는 Emscripten UMD 의 `typeof importScripts==='function'` 분기
 *    (가장 잘 검증된 웹 경로)를 타고, 어떤 이상 동작도 UI 스레드를 굳히지 못한다.
 *  - 메인 쪽은 타임아웃으로 반드시 끝난다(실패 시 호출부 토스트).
 *
 * ⚠️ 임베드 IIFE(embed.tsx)에서는 이 모듈을 import 하지 않는다 — 임베드는 opencvStubPlugin 의
 *    스텁 폴백 경로를 유지하고, 10MB 자산이 dist-embed 에 유입되지 않아야 한다(단일 파일 계약).
 */
import opencvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url'
import {
  configureOpenCv,
  configureContourExtractor,
  type ContourExtractInput,
  type ContourExtractResult
} from '@storige/canvas-core'

/** 첫 호출 상한 — 10MB 다운로드 + wasm 컴파일이 워커에서 겹칠 수 있다. */
const FIRST_CALL_TIMEOUT_MS = 60_000
/** 예열 이후 호출 상한. */
const WARM_CALL_TIMEOUT_MS = 20_000

/**
 * 워커 본문 — 클래식 워커 스코프에서 실행된다(문자열로 두는 이유는 위 Blob 설명 참조).
 * cv 파이프라인은 ImageProcessingPlugin 의 종전 메인 스레드 구현과 동일 규약이다:
 * RGBA→GRAY→blur(kSize)→threshold(0,BINARY)→findContours(EXTERNAL,SIMPLE)
 * → 면적>1000 필터(+스캔 상한·복사본 즉시 delete) → 다중이면 convexHull → approxPolyDP.
 */
const WORKER_SOURCE = String.raw`
'use strict';
var cvReadyPromise = null;

function ensureCv(url) {
  if (cvReadyPromise) return cvReadyPromise;
  cvReadyPromise = new Promise(function (resolve, reject) {
    try {
      importScripts(url);
    } catch (e) {
      cvReadyPromise = null;
      reject(new Error('opencv importScripts 실패: ' + (e && e.message ? e.message : e)));
      return;
    }
    var c = self.cv;
    if (!c) { cvReadyPromise = null; reject(new Error('opencv 전역(cv)이 만들어지지 않았습니다')); return; }
    if (typeof c.Mat === 'function') { resolve(c); return; }
    if (typeof c.then === 'function') {
      Promise.resolve(c).then(function (m) { resolve(m && typeof m.Mat === 'function' ? m : self.cv); }, reject);
      return;
    }
    // classic: onRuntimeInitialized + 폴링 이중화(콜백이 이미 지났을 수 있다)
    var iv = setInterval(function () {
      if (self.cv && typeof self.cv.Mat === 'function') { clearInterval(iv); resolve(self.cv); }
    }, 50);
    try {
      var prev = c.onRuntimeInitialized;
      c.onRuntimeInitialized = function () {
        try { if (typeof prev === 'function') prev(); } catch (e) {}
        clearInterval(iv);
        resolve(self.cv && typeof self.cv.Mat === 'function' ? self.cv : c);
      };
    } catch (e) {}
  });
  return cvReadyPromise;
}

function extract(cv, p) {
  var imageData = new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);
  var src = cv.matFromImageData(imageData);
  var gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  var blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(p.kSize, p.kSize), 0);
  var binary = new cv.Mat();
  cv.threshold(blur, binary, 0, 255, cv.THRESH_BINARY);
  var contours = new cv.MatVector();
  var hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  var total = contours.size();
  var scanned = Math.min(total, p.scanLimit);
  var kept = [];
  for (var i = 0; i < scanned; i++) {
    var c = contours.get(i);
    var area = cv.contourArea(c);
    if (area > 1000) kept.push({ c: c, area: area });
    else c.delete(); // MatVector.get 은 복사본 — 즉시 해제(누수 방지)
  }
  kept.sort(function (a, b) { return b.area - a.area; });
  var useHull = kept.length > 1;

  var pts = [];
  for (var k = 0; k < kept.length; k++) {
    var kc = kept[k].c;
    if (pts.length >= p.hullMaxInputPoints) { kc.delete(); continue; }
    var step = Math.max(1, Math.ceil(kc.rows / p.hullMaxInputPoints));
    for (var j = 0; j < kc.rows; j += step) {
      pts.push([kc.data32S[j * 2], kc.data32S[j * 2 + 1]]);
    }
    kc.delete();
  }

  var outMat;
  if (useHull) {
    var pm = cv.matFromArray(pts.length, 1, cv.CV_32SC2, [].concat.apply([], pts));
    outMat = new cv.Mat();
    cv.convexHull(pm, outMat, false, true);
    pm.delete();
  } else {
    outMat = cv.matFromArray(pts.length, 1, cv.CV_32SC2, [].concat.apply([], pts));
  }

  // 근사화 — epsilon 은 둘레 비율(크기 무관). 실패해도 칼선은 나와야 하므로 폴백.
  var finalMat = outMat;
  try {
    var peri = cv.arcLength(outMat, true);
    var eps = Math.max(0.5, peri * p.approxEpsilonRatio);
    var simp = new cv.Mat();
    cv.approxPolyDP(outMat, simp, eps, true);
    if (simp.rows >= 3) { outMat.delete(); finalMat = simp; } else { simp.delete(); }
  } catch (e) {}

  var out = [];
  for (var m = 0; m < finalMat.data32S.length; m += 2) {
    out.push([finalMat.data32S[m], finalMat.data32S[m + 1]]);
  }
  finalMat.delete();
  contours.delete(); hierarchy.delete(); binary.delete(); blur.delete(); gray.delete(); src.delete();
  return { points: out, useHull: useHull, meta: { totalContours: total, scanned: scanned } };
}

self.onmessage = function (ev) {
  var id = ev.data.id, type = ev.data.type, payload = ev.data.payload;
  Promise.resolve()
    .then(function () { return ensureCv(payload.url); })
    .then(function (cv) {
      if (type === 'warmup') return { warmed: true };
      return extract(cv, payload);
    })
    .then(function (result) { self.postMessage({ id: id, ok: true, result: result }); })
    .catch(function (e) { self.postMessage({ id: id, ok: false, error: String(e && e.message ? e.message : e) }); });
};
`

interface PendingCall {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let callSeq = 0
let warmed = false
const pending = new Map<number, PendingCall>()

/** 절대 URL — Blob 워커의 importScripts 는 blob origin 기준이라 상대경로가 깨진다. */
function absoluteScriptUrl(): string {
  return new URL(opencvScriptUrl, window.location.origin).href
}

function failAllPending(reason: string): void {
  for (const [, call] of pending) {
    clearTimeout(call.timer)
    call.reject(new Error(reason))
  }
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' })
  worker = new Worker(URL.createObjectURL(blob))
  worker.onmessage = (ev: MessageEvent) => {
    const { id, ok, result, error } = ev.data ?? {}
    const call = pending.get(id)
    if (!call) return // 타임아웃으로 이미 정리된 응답 — 무시
    pending.delete(id)
    clearTimeout(call.timer)
    if (ok) call.resolve(result)
    else call.reject(new Error(error || '윤곽 추출 워커 오류'))
  }
  worker.onerror = (e) => {
    // 워커 자체가 죽으면 걸려 있는 호출 전부 실패 처리 + 다음 호출에서 재생성
    failAllPending(`윤곽 추출 워커가 중단되었습니다: ${e.message || 'unknown'}`)
    worker?.terminate()
    worker = null
    warmed = false
  }
  return worker
}

function callWorker<T>(
  type: 'warmup' | 'extract',
  payload: Record<string, unknown>,
  timeoutMs: number,
  transfer?: Transferable[]
): Promise<T> {
  const id = ++callSeq
  const w = getWorker()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(
        new Error(
          `이미지 윤곽 처리가 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.`
        )
      )
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    w.postMessage({ id, type, payload }, transfer ?? [])
  })
}

// ── 배선 ────────────────────────────────────────────────────────────
// 1) 윤곽 추출기(정상 경로) — cv 사용부 전체가 워커에서 돈다.
configureContourExtractor(async (input: ContourExtractInput): Promise<ContourExtractResult> => {
  const timeout = warmed ? WARM_CALL_TIMEOUT_MS : FIRST_CALL_TIMEOUT_MS
  // ⚠️ buffer 는 transfer 로 넘긴다(캡 적용본 ≤1280 장변 ≈ 최대 6.5MB — 복사 회피).
  const result = await callWorker<ContourExtractResult>(
    'extract',
    {
      url: absoluteScriptUrl(),
      data: input.data,
      width: input.width,
      height: input.height,
      kSize: input.kSize,
      scanLimit: input.scanLimit,
      hullMaxInputPoints: input.hullMaxInputPoints,
      approxEpsilonRatio: input.approxEpsilonRatio
    },
    timeout,
    [input.data.buffer]
  )
  warmed = true
  return result
})

// 2) 메인 스레드 getCv 폴백(다른 cv 사용 메서드용)에도 자산 URL 은 주입해 둔다 —
//    단, 그 경로는 실측상 실행 불능이라 20s 타임아웃 → 에러로 끝난다(프리즈 방지가 목적).
configureOpenCv({ scriptUrl: opencvScriptUrl })

// 3) 예열 — idle 에 워커에서 10MB 다운로드+wasm 컴파일을 미리 끝내 첫 '효과'의 대기를 줄인다.
//    워커라 UI 는 어떤 경우에도 굳지 않는다. 실패는 silent(실사용 시 재시도).
if (typeof window !== 'undefined') {
  const schedule =
    'requestIdleCallback' in window
      ? (cb: () => void) => (window as any).requestIdleCallback(cb, { timeout: 5000 })
      : (cb: () => void) => setTimeout(cb, 1500)
  schedule(() => {
    callWorker('warmup', { url: absoluteScriptUrl() }, 120_000).then(
      () => {
        warmed = true
      },
      () => {
        /* silent */
      }
    )
  })
}
