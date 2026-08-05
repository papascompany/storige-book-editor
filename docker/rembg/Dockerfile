# ─────────────────────────────────────────────────────────────────
# S-P2A 배경제거(CUTOUT) 추론 사이드카 — rembg HTTP 서버
#
# 왜 사이드카인가: 워커 이미지 베이스가 node:24-alpine(musl) 이라
#   onnxruntime-node 계열은 **설치는 성공하고 런타임 import 에서 터진다**(실측).
#   → 추론은 이 python(glibc) 컨테이너가 HTTP 로 전담하고,
#     워커는 ML 네이티브 의존을 일절 갖지 않는다(아키텍처 확정).
#
# rembg 는 CLI/서버 컴포넌트와 ONNX 런타임이 모두 **extra** 로 분리돼 있다.
#   [cli] = fastapi·uvicorn·click·python-multipart·gradio (HTTP 서버)
#   [cpu] = onnxruntime (없으면 추론 시점에 import 실패 — 서버는 뜨는데 요청만 죽는다)
#   → 반드시 두 extra 를 함께 설치한다. GPU 없음(VPS CPU 전용)이라 [gpu] 는 쓰지 않는다.
# ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim

# 버전 핀 근거:
#   - 2.0.75 미만은 CVE-2026-40086(경로 순회, CVSS 5.3) 영향 —
#     `*_custom` 모델의 model_path 로 임의 파일을 ONNX 로 열어 존재/권한이 유출된다.
#     2.0.75 에서 수정. 여기서는 그보다 상위인 2.0.77(최신 릴리스)로 핀한다.
#   - rembg 는 python >=3.11,<4.0 요구 → 3.12-slim 사용.
ARG REMBG_VERSION=2.0.77

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # 모델 가중치 캐시 경로. rembg 기본값은 ~/.u2net 이고 U2NET_HOME 으로 덮어쓴다.
    # compose 에서 이 경로에 named volume 을 물려 재생성 시 콜드 다운로드를 막는다.
    U2NET_HOME=/home/rembg/.u2net \
    # 4vCPU 박스를 워커(ghostscript/qpdf)와 나눠 쓰므로 ONNX 스레드를 묶어 둔다.
    # 늘리려면 compose environment 에서 덮어쓴다(REMBG_OMP_NUM_THREADS).
    OMP_NUM_THREADS=2 \
    REMBG_PORT=7000 \
    REMBG_LOG_LEVEL=info \
    REMBG_THREADS=2

# non-root 실행 계정. 홈(=모델 캐시 상위)을 미리 만들어 소유권을 맞춰 두면
# named volume 최초 생성 시 이 소유권이 그대로 복사된다.
RUN groupadd --system rembg \
 && useradd --system --gid rembg --create-home --home-dir /home/rembg rembg \
 && mkdir -p /home/rembg/.u2net \
 && chown -R rembg:rembg /home/rembg

RUN pip install --no-cache-dir "rembg[cli,cpu]==${REMBG_VERSION}"

USER rembg
WORKDIR /home/rembg

# 내부 네트워크 전용 포트. compose 에서 ports: 매핑을 하지 않는다(아래 주석 참조).
EXPOSE 7000

# --no-ui: Gradio 데모 UI(/) 를 끈다. idle CPU 를 줄이고 공격 표면도 줄인다.
#   API 는 그대로 /api/remove (GET=url 파라미터, POST=multipart file), 문서는 /api.
# sh -c + exec: 위 ENV 튜닝 값을 인자로 넘기면서도 PID 1 시그널 처리를 유지한다.
CMD ["sh", "-c", "exec rembg s --host 0.0.0.0 --port \"$REMBG_PORT\" --log_level \"$REMBG_LOG_LEVEL\" --threads \"$REMBG_THREADS\" --no-ui"]
