import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DomainError, ErrorCodes } from '../common/errors';

/**
 * rembg 사이드카 HTTP 클라이언트 (2026-08-05, S-P2A-B 샤드2 / D-12a=C).
 *
 * 배경: 워커 베이스 이미지가 Alpine(musl)이라 onnxruntime-node 계열은 설치는 되지만
 * 런타임 import 에서 터진다(스파이크 §1-1 실측). 따라서 배경제거 추론은 워커 프로세스가
 * 아니라 **별도 rembg 컨테이너**가 HTTP 로 수행하고, 워커는 얇은 클라이언트만 갖는다.
 * ⚠️ 워커에 ML 네이티브 의존(onnxruntime/@imgly 등)을 추가하지 마라 — 컨테이너가 안 뜬다.
 *
 * SSRF 가드: 대상 URL 은 **오직 env(REMBG_URL/REMBG_ENDPOINT)** 에서만 만들어진다.
 * 잡 페이로드가 줄 수 있는 값은 모델 키뿐이고, 그마저 화이트리스트 정규식으로 걸러
 * 쿼리스트링·경로를 오염시키지 못하게 한다.
 */

/** docker-compose 서비스명/포트 규약 — 실제 값은 compose(docker 트랙)가 env 로 주입 */
const DEFAULT_REMBG_URL = 'http://rembg:7000';
/** rembg FastAPI 서버의 배경제거 라우트 */
const DEFAULT_REMBG_ENDPOINT = '/api/remove';
/** 사이드카 콜드스타트(모델 최초 로드)까지 감안한 여유 타임아웃 */
const DEFAULT_REMBG_TIMEOUT_MS = 120_000;
/**
 * 워커측 기본 모델 키. 정본 기본값은 compose env(REMBG_MODEL)가 주입하지만,
 * env 미주입 환경에서도 **compose 기본값과 같은 모델**로 동작하도록 맞춰 둔다
 * (불일치 시 "모델이 바뀐 줄 모른 채 품질만 나빠지는" 관측 불가 상태가 된다).
 * ⚠️ 모델마다 라이선스가 다르다 — 상업 사용 가부는 D-12b 결정표를 따를 것.
 * birefnet-general = MIT(ZhengPeng7/BiRefNet). 폴백 u2net = Apache-2.0.
 */
const DEFAULT_REMBG_MODEL = 'birefnet-general';

/** rembg 세션(모델) 키 허용 문자 — URL 오염 방지용 화이트리스트 */
const MODEL_KEY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * CVE-2026-40086 방어선(2.0.75 에서 수정된 경로 순회) — `*_custom` 세션은
 * 외부 가중치 경로를 그대로 열기 때문에 **요청을 조립하는 이쪽에서도** 막는다.
 * API 프로듀서의 화이트리스트만 믿으면, 큐에 잡을 넣는 다른 경로가 생기는 순간 방어가 사라진다.
 */
const CUSTOM_SESSION_MARKER = '_custom';

/** PNG 시그니처 — 사이드카가 이미지 대신 에러 본문을 200 으로 주는 경우 탐지 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface RemoveBackgroundResult {
  /** 배경 제거 결과 PNG(알파) 바이트 */
  png: Buffer;
  /** 실제 요청에 사용된 모델 키 — 라이선스 감사 추적용 */
  model: string;
}

/** arraybuffer 응답 정규화 (node axios 는 Buffer 를 주지만 타입은 ArrayBuffer) */
function toBuffer(data: ArrayBuffer | Buffer): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/** 에러 메시지에 실을 본문 앞부분(바이트 전량을 로그에 쏟지 않는다) */
function previewBody(data: Buffer): string {
  return data.subarray(0, 200).toString('utf8').replace(/\s+/g, ' ').trim();
}

@Injectable()
export class RembgService {
  private readonly logger = new Logger(RembgService.name);
  private readonly baseUrl = (process.env.REMBG_URL || DEFAULT_REMBG_URL).replace(/\/$/, '');
  private readonly endpoint = process.env.REMBG_ENDPOINT || DEFAULT_REMBG_ENDPOINT;
  private readonly timeoutMs = Number(process.env.REMBG_TIMEOUT_MS) || DEFAULT_REMBG_TIMEOUT_MS;
  private readonly defaultModel = process.env.REMBG_MODEL || DEFAULT_REMBG_MODEL;

  /** 잡이 요청한 모델 키 검증 + 기본값 폴백. 부적합하면 즉시 실패(URL 오염 차단). */
  resolveModel(requested?: string): string {
    const key = (requested ?? '').trim() || this.defaultModel;
    if (!MODEL_KEY_PATTERN.test(key)) {
      throw new DomainError(
        ErrorCodes.INVALID_OUTPUT_OPTIONS,
        `허용되지 않는 배경제거 모델 키입니다: ${JSON.stringify(key).slice(0, 80)}`,
        { model: key },
      );
    }
    // MODEL_KEY_PATTERN 이 밑줄을 허용하므로 `u2net_custom` 류가 통과한다 — 별도로 차단.
    if (key.toLowerCase().includes(CUSTOM_SESSION_MARKER)) {
      throw new DomainError(
        ErrorCodes.INVALID_OUTPUT_OPTIONS,
        `custom 세션 모델은 허용되지 않습니다(CVE-2026-40086 경로 순회 벡터): ${key}`,
        { model: key },
      );
    }
    return key;
  }

  /**
   * 이미지 바이트를 사이드카로 보내 알파 PNG 를 받는다.
   * @param input          추론 입력 이미지 바이트(픽셀 캡은 호출자가 이미 적용)
   * @param requestedModel 잡이 지정한 모델 키(선택) — 미지정 시 env 기본값
   */
  async removeBackground(input: Buffer, requestedModel?: string): Promise<RemoveBackgroundResult> {
    const model = this.resolveModel(requestedModel);
    const url = this.buildUrl();

    // multipart 는 손으로 조립한다 — 워커에 신규 의존(form-data 등)을 추가하지 않기 위함.
    //
    // ⚠️ **model 은 반드시 바디 필드다.** rembg 의 `GET /api/remove` 는 model 을 쿼리로 받지만
    //    `POST /api/remove` 의 쿼리 파라미터는 bgc·extras 뿐이고 model 은 multipart 필드다
    //    (OpenAPI 실측, v2.0.77). 쿼리로 보내면 **에러 없이 무시되고 기본 모델(u2net)로 추론**돼
    //    결과는 정상처럼 보이는데 CutoutJobResult.model 만 거짓이 된다 — 라이선스 감사 추적
    //    (D-12b)이 통째로 틀어지는 조용한 실패라, 실기 스모크에서만 잡혔다.
    const boundary = `----storige${uuidv4().replace(/-/g, '')}`;
    const modelPart = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${model}\r\n`,
      'utf8',
    );
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="input.png"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([modelPart, head, input, tail]);

    let status: number;
    let data: Buffer;
    try {
      // validateStatus 를 무력화해 비2xx 도 본문을 읽는다(에러 원인 진단용).
      const res = await axios.post<ArrayBuffer | Buffer>(url, body, {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
          Accept: 'image/png',
        },
        responseType: 'arraybuffer',
        timeout: this.timeoutMs,
        maxRedirects: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      });
      status = res.status;
      data = toBuffer(res.data);
    } catch (error) {
      // 네트워크/타임아웃 — 사이드카 미기동·과부하가 대부분이라 SERVICE_UNAVAILABLE.
      const message = error instanceof Error ? error.message : String(error);
      throw new DomainError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        `rembg 사이드카 호출 실패: ${message}`,
        { model, endpoint: this.endpoint },
      );
    }

    if (status < 200 || status >= 300) {
      throw new DomainError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        `rembg 배경제거 실패 (HTTP ${status}): ${previewBody(data)}`,
        { model, status },
      );
    }

    if (data.length < PNG_MAGIC.length || !data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      // 200 인데 PNG 가 아니면 사이드카 설정 오류(에러 JSON/HTML 반환 등).
      throw new DomainError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        `rembg 응답이 PNG 가 아닙니다 (${data.length} bytes): ${previewBody(data)}`,
        { model, status },
      );
    }

    this.logger.log(`rembg[${model}]: ${input.length}B → ${data.length}B`);
    return { png: data, model };
  }

  /**
   * 대상 URL 조립 — 호스트·경로는 **오직 env** 에서만 온다(SSRF 가드).
   * 모델은 쿼리가 아니라 multipart 바디 필드로 보낸다(removeBackground 주석 참조).
   */
  private buildUrl(): string {
    const ep = this.endpoint.startsWith('/') ? this.endpoint : `/${this.endpoint}`;
    return new URL(`${this.baseUrl}${ep}`).toString();
  }
}
