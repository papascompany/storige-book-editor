// PSD 비텍스트 레이어 합성 → 배경 PNG (브라우저 canvas / Node sharp).
// ⚠️ 입력 layers 에는 텍스트 레이어가 포함되면 안 된다(호출측에서 kind==='raster'만 전달).
//    그래야 "추출 텍스트 제외 합성"이 되어 텍스트 이중 렌더를 막는다.
//
// 각 레이어는 { left, top, width, height, rgba(Uint8ClampedArray RGBA) }. z-순서(앞이 아래).
// 결과: { dataUrl, widthPx, heightPx } — PSD 원본 px(원본 해상도 그대로, 인쇄 해상도 보존).

/**
 * @param {{left:number,top:number,width:number,height:number,rgba:Uint8ClampedArray}[]} layers
 * @param {number} W  PSD canvas width(px)
 * @param {number} H  PSD canvas height(px)
 * @returns {Promise<{dataUrl:string, widthPx:number, heightPx:number}>}
 */
export async function compositeLayersToPng(layers, W, H) {
  if (typeof document !== 'undefined') {
    // 브라우저: 레이어별 임시 캔버스 → drawImage 로 알파 합성(위치/클리핑 자동)
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    for (const l of layers) {
      if (!l.rgba || !l.width || !l.height) continue;
      const tmp = document.createElement('canvas');
      tmp.width = l.width;
      tmp.height = l.height;
      const tctx = tmp.getContext('2d');
      tctx.putImageData(new ImageData(new Uint8ClampedArray(l.rgba), l.width, l.height), 0, 0);
      ctx.drawImage(tmp, Math.round(l.left), Math.round(l.top));
    }
    return { dataUrl: canvas.toDataURL('image/png'), widthPx: W, heightPx: H };
  }

  // Node: sharp 로 합성. (모듈명 변수화 → 번들러 정적분석 회피)
  const sharpName = 'sharp';
  const sharp = (await import(/* @vite-ignore */ sharpName)).default;
  const base = sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  const composites = [];
  for (const l of layers) {
    if (!l.rgba || !l.width || !l.height) continue;
    const left = Math.round(l.left);
    const top = Math.round(l.top);
    if (left < 0 || top < 0 || left + l.width > W || top + l.height > H) {
      // 캔버스 밖으로 나가는 레이어는 sharp composite 가 음수/초과 오프셋을 거부 → 스킵(Node 한정).
      // 브라우저 경로는 drawImage 로 정상 클리핑됨.
      continue;
    }
    composites.push({
      input: Buffer.from(l.rgba.buffer, l.rgba.byteOffset, l.rgba.byteLength),
      raw: { width: l.width, height: l.height, channels: 4 },
      left,
      top,
    });
  }
  const buf = await base.composite(composites).png().toBuffer();
  return { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), widthPx: W, heightPx: H };
}
