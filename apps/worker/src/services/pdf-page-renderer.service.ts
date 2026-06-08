import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import { pdfToImage } from '../utils/ghostscript';

export interface RenderPagesResult {
  /** 페이지 순서대로의 이미지 상대 URL ('/storage/...') */
  pageImageUrls: string[];
  /** 실제 래스터한 페이지 수(상한 적용 후) */
  pageCount: number;
  /** 사용 해상도(dpi) */
  resolution: number;
  /** 원본 PDF 총 페이지 수(상한 적용 전) */
  sourcePageCount: number;
  /** 상한으로 잘렸는지 */
  truncated: boolean;
}

/**
 * 내지 PDF 표시전용 가이드 래스터화 서비스 (2026-06-07).
 *
 * 첨부 내지 PDF 각 페이지를 PNG 이미지로 변환해 `/storage/content-pdf-guides/<jobId>/`에 저장.
 * 편집기는 underlay 모드에서 이 이미지들을 `excludeFromExport:true` 잠금 가이드 배경으로 표시.
 * ⚠️ 표시 전용 — 최종 인쇄엔 미반영(워커 content.pdf 는 첨부 원본 그대로 방출).
 *
 * 화면 표시 목적이라 저해상도(기본 110dpi)로 메모리/시간 절약. 페이지 상한으로 폭주 방지.
 */
@Injectable()
export class PdfPageRendererService {
  private readonly logger = new Logger(PdfPageRendererService.name);
  private readonly storagePath = process.env.STORAGE_PATH || '/app/storage';
  private readonly guidesDir = 'content-pdf-guides';
  /** 가이드 화면표시용 해상도(dpi). 저해상도로 충분 — 메모리/렌더시간 절약. */
  private readonly dpi = Number(process.env.CONTENT_PDF_GUIDE_DPI) || 110;
  /** N페이지 메모리/시간 가드 상한. 초과분은 잘라내고 truncated=true. */
  private readonly maxPages = Number(process.env.CONTENT_PDF_GUIDE_MAX_PAGES) || 200;

  /**
   * 절대 경로(/app/storage/...) → nginx 서빙 가능한 상대 URL(/storage/...).
   * (pdf-converter.service 의 toStorageUrl 과 동일 규약)
   */
  private toStorageUrl(absPath: string): string {
    const base = this.storagePath.replace(/\/$/, '');
    if (absPath === base) return '/storage';
    if (absPath.startsWith(base + '/')) {
      return '/storage/' + absPath.substring(base.length + 1);
    }
    return absPath;
  }

  /**
   * 입력 PDF 바이트 로드 — '/storage/...'(API fileUrl), 절대/상대 경로, HTTP URL 모두 지원.
   * (pdf-converter.service 의 downloadFile 과 동일 규약)
   */
  private async loadBytes(url: string): Promise<Buffer> {
    if (url.startsWith('/storage/') || url.startsWith('storage/')) {
      const storageBase = process.env.WORKER_STORAGE_PATH || '../api';
      const filePath = url.startsWith('/storage/')
        ? `${storageBase}${url}`
        : `${storageBase}/${url}`;
      return fs.readFile(filePath);
    }
    if (url.startsWith('/') || url.startsWith('./')) {
      return fs.readFile(url);
    }
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  }

  /**
   * 내지 PDF 를 페이지 이미지로 래스터화.
   * @param fileUrl  내지 PDF 경로/URL (API 가 fileId → filePath 로 해석해 전달)
   * @param jobId    워커잡 ID (출력 디렉토리 네임스페이스)
   * @param pageCount 알려진 페이지 수(있으면 우선; 없으면 pdf-lib 로 추출)
   */
  async renderPages(
    fileUrl: string,
    jobId: string,
    pageCount?: number,
  ): Promise<RenderPagesResult> {
    const bytes = await this.loadBytes(fileUrl);

    // 페이지 수 결정 — 전달값 우선, 없으면 pdf-lib
    let sourcePageCount = pageCount ?? 0;
    if (!sourcePageCount || sourcePageCount < 1) {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      sourcePageCount = doc.getPageCount();
    }

    let renderCount = sourcePageCount;
    let truncated = false;
    if (renderCount > this.maxPages) {
      this.logger.warn(
        `content-pdf-guide[${jobId}]: pageCount ${renderCount} > 상한 ${this.maxPages} — 상한까지만 래스터`,
      );
      renderCount = this.maxPages;
      truncated = true;
    }

    // GS 입력용 임시 PDF
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpg-'));
    const inputPath = path.join(tmpDir, 'input.pdf');
    await fs.writeFile(inputPath, bytes);

    const outDir = path.join(this.storagePath, this.guidesDir, jobId);
    await fs.mkdir(outDir, { recursive: true });

    const pageImageUrls: string[] = [];
    try {
      for (let p = 1; p <= renderCount; p++) {
        const outPath = path.join(outDir, `page_${p}.png`);
        // pdfToImage 는 runGhostscript(타임아웃 없음) 사용 — 페이지 상한으로 폭주 방지.
        await pdfToImage(inputPath, outPath, {
          page: p,
          resolution: this.dpi,
          format: 'png',
        });
        pageImageUrls.push(this.toStorageUrl(outPath));
      }
      this.logger.log(
        `content-pdf-guide[${jobId}]: ${pageImageUrls.length}/${sourcePageCount}p @${this.dpi}dpi`,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    return {
      pageImageUrls,
      pageCount: renderCount,
      resolution: this.dpi,
      sourcePageCount,
      truncated,
    };
  }
}
