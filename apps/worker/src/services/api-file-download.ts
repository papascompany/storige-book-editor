import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api';

/** API가 s3 backend 파일에 넘기는 마커. */
export function isApiMarker(url: string): boolean {
  return typeof url === 'string' && url.startsWith('api://');
}

/** api://<fileId> → GET /files/:id/download/external (WORKER_API_KEY). API가 local/s3 라우팅. */
export async function downloadViaApi(url: string): Promise<Uint8Array> {
  const fileId = url.slice('api://'.length);
  const res = await axios.get(
    `${API_BASE_URL}/files/${encodeURIComponent(fileId)}/download/external`,
    {
      headers: { 'X-API-Key': process.env.WORKER_API_KEY || '' },
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    },
  );
  return new Uint8Array(res.data as ArrayBuffer);
}
