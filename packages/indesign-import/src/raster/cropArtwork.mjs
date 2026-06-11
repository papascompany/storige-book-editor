// flat-spine 모드용 크롭 헬퍼 — 전폭 300dpi PNG dataUrl 에서 수직 슬라이스를 잘라
// '흰 배경으로 합성'한 PNG dataUrl 을 만든다.
//
// 흰 배경 합성이 필수인 이유: flat-spine 의 z-order 은폐 전제(spine-artwork 가 최하단에 3배폭으로
// 깔리고 back/front-artwork 가 그 위를 덮음)는 각 PNG 가 '불투명'해야 성립한다. 투명 PNG 면
// 아래층 spine 크롭이 비쳐 이중상이 생긴다. vector/hybrid 경로의 기존 동작(투명 PNG)은 불변.
//
// 환경: rasterize.mjs 와 동일하게 브라우저(admin)/Node 양쪽 지원.
//   - 브라우저: <canvas> fillRect(흰 배경) → drawImage(sx/sw 크롭).
//   - Node:    sharp .extract() + .flatten({background:'#ffffff'}).

/**
 * @param {string} dataUrl   전폭 아트워크 PNG dataUrl (rasterizeArtwork 출력)
 * @param {{left:number, width:number}} crop  수직 슬라이스(px, 좌상단원점)
 * @param {number} heightPx  전폭 아트워크 높이(px) — 크롭 높이는 항상 전체 높이
 * @returns {Promise<{dataUrl:string, widthPx:number, heightPx:number}>}
 */
export async function cropArtworkPng(dataUrl, crop, heightPx) {
  if (typeof document !== 'undefined') {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('artwork PNG image load failed'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    // 흰 배경 선행(불투명 보장) 후 크롭 드로잉.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, crop.width, heightPx);
    ctx.drawImage(img, crop.left, 0, crop.width, heightPx, 0, 0, crop.width, heightPx);
    return { dataUrl: canvas.toDataURL('image/png'), widthPx: crop.width, heightPx };
  }

  // Node: sharp. (rasterize.mjs 와 동일하게 모듈명을 변수로 둬 Vite 정적 분석 차단.)
  const sharpName = 'sharp';
  const sharp = (await import(/* @vite-ignore */ sharpName)).default;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buf = await sharp(Buffer.from(base64, 'base64'))
    .extract({ left: crop.left, top: 0, width: crop.width, height: heightPx })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
  return {
    dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
    widthPx: crop.width,
    heightPx,
  };
}
