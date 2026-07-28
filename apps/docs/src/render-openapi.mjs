/**
 * render-openapi.mjs — 생성 스펙(openapi-partner.json) → 마크다운 (shard ① 소유)
 *
 * 마크다운을 만들고 render-md 가 HTML 로 옮긴다(앵커 정책·표 스크롤 래핑을 한 곳에서 재사용).
 *
 * ⚠️ 렌더 허용/금지는 계약 §3-G 를 **코드로 강제**한다. 특히:
 *   - 응답 **스키마·예시 슬롯을 아예 두지 않는다**. 서버에 `@ApiResponse({type})` 이 0건이고
 *     성공 봉투는 런타임 인터셉터 소관이라 **스펙에 응답 타입이 존재하지 않는다**.
 *     없는 것을 지어내면 허위 문서화다. 상태코드는 "선언된 응답" 라벨로만 노출한다.
 *   - `multipart/form-data` 스키마는 렌더하지 않는다. 스펙이 `{fileId}`(AssetInputDto)로 오기돼
 *     있으나 실제 컨트롤러는 `FileInterceptor('file')` 이라 그대로 실으면 파트너가 틀린 필드를 쓴다.
 *   - `info.description`(내부 설계서 경로) · `securitySchemes` 원문(`bearerFormat:"JWT"` 오도)은
 *     읽지도 않는다.
 *
 * ⚠️ 오버라이드 드리프트 방지(핵심 불변식):
 *   `descriptionOverrides` / `summaryOverrides` 는 스펙 원문을 **무조건 덮어쓴다**. 그래서 원문이
 *   나중에 고쳐져도 오버라이드가 영원히 이기고, **스테일한 서술이 조용히 발행된다**(허위 문서화).
 *   이를 막기 위해 오버라이드는 `{ text, expectedSource }` 형태만 허용하고, 렌더 시점에
 *   스펙 원문과 `expectedSource` 를 대조해 다르면 **빌드를 깨뜨린다**. 등재해 놓고 스펙에서
 *   대응을 찾지 못한 키(고아 오버라이드)도 마찬가지로 깨뜨린다 — 조용히 죽은 치환은 없다.
 */

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/**
 * @param {object} spec  openapi-partner.json 파싱 결과
 * @param {object} cfg   site.config.mjs 의 OPENAPI
 * @returns {{ markdown: string, stats: {paths:number, operations:number, schemas:number} }}
 */
export function renderOpenApiMarkdown(spec, cfg) {
  const ops = collectOperations(spec);
  const groups = groupOperations(ops, cfg.groups);
  /** 어떤 설정 키가 실제로 스펙에 적용됐는지 — 고아 등재를 뒤에서 잡는다. */
  const usage = { descriptionOverrides: new Set(), summaryOverrides: new Set(), enumNotes: new Set() };

  const out = [];
  out.push('## API 레퍼런스 (자동 생성) {#api-reference}', '');
  out.push(
    `모든 경로는 base URL \`${cfg.baseUrl}\` 기준이며, 전 오퍼레이션에 파트너 키 인증이 필요하다.`,
    '아래 내용은 서버 라우트 정의에서 자동 생성한 것이라 구현과 함께 갱신된다.',
    '',
  );

  for (const group of groups) {
    if (group.operations.length === 0) continue;
    out.push(`### ${group.label} {#grp-${slugPath(group.prefix)}}`, '');
    for (const op of group.operations) {
      out.push(...renderOperation(op, spec, cfg, usage));
    }
  }

  assertNoOrphans('descriptionOverrides', cfg.descriptionOverrides, usage.descriptionOverrides);
  assertNoOrphans('summaryOverrides', cfg.summaryOverrides, usage.summaryOverrides);
  assertNoOrphans('enumNotes', cfg.enumNotes, usage.enumNotes);

  const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
  return {
    markdown: out.join('\n'),
    stats: { paths: Object.keys(spec.paths ?? {}).length, operations: ops.length, schemas: schemaCount },
  };
}

/** 비교용 정규화 — 공백 접힘/줄바꿈 차이는 무시하고 **사실 변화만** 잡는다. */
function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 오버라이드 1건을 검증하고 치환 문자열을 돌려준다.
 * 형태가 `{ text, expectedSource }` 가 아니거나 원문이 스냅샷과 다르면 즉시 throw(빌드 실패).
 */
function applyOverride(kind, key, entry, sourceValue) {
  if (
    typeof entry !== 'object' ||
    entry === null ||
    typeof entry.text !== 'string' ||
    typeof entry.expectedSource !== 'string'
  ) {
    throw new Error(
      `OPENAPI.${kind}['${key}'] 는 { text, expectedSource } 형태여야 한다.\n` +
        `→ 오버라이드는 스펙 원문을 무조건 덮어쓰므로, 대조할 원문 스냅샷 없이는 등재할 수 없다.`,
    );
  }
  const actual = normalizeText(sourceValue);
  const expected = normalizeText(entry.expectedSource);
  if (actual !== expected) {
    throw new Error(
      `OPENAPI.${kind}['${key}'] 의 expectedSource 가 스펙 원문과 다르다 — ` +
        `서버 원문이 바뀌었는데 오버라이드가 옛 서술을 발행하려 한다(허위 문서화 위험).\n` +
        `  스펙 원문 : ${actual || '(없음)'}\n` +
        `  등재 스냅샷: ${expected || '(없음)'}\n` +
        `→ 현재 동작을 다시 확인해 text 를 고친 뒤 expectedSource 를 새 원문으로 갱신하라. ` +
        `원문만으로 충분해졌으면 오버라이드를 삭제하는 것이 낫다.`,
    );
  }
  return entry.text;
}

/** 등재했으나 스펙에서 대응을 찾지 못한 키 = 조용히 죽은 치환. */
function assertNoOrphans(kind, cfgMap, used) {
  const orphans = Object.keys(cfgMap ?? {}).filter((key) => !used.has(key));
  if (orphans.length) {
    throw new Error(
      `OPENAPI.${kind} 에 스펙 대응을 찾지 못한 키 ${orphans.length}건: ${orphans.join(', ')}\n` +
        `→ 스펙에서 해당 속성/오퍼레이션이 사라졌거나 이름이 바뀌었다. 치환이 조용히 죽는 것을 막기 위해 빌드를 세운다.`,
    );
  }
}

function collectOperations(spec) {
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHOD_ORDER) {
      const op = item[method];
      if (!op) continue;
      ops.push({ path, method, op });
    }
  }
  return ops.sort(
    (a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
  );
}

function groupOperations(ops, groupDefs) {
  const assigned = new Set();
  const groups = groupDefs.map((def) => ({ ...def, operations: [] }));
  // 긴 prefix 가 먼저 매칭되도록 정렬한 사본으로 판정한다(/books 가 /book-specs 를 삼키지 않도록).
  const byLength = [...groups].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of ops) {
    const hit = byLength.find((g) => entry.path === g.prefix || entry.path.startsWith(`${g.prefix}/`));
    if (!hit) throw new Error(`OPENAPI.groups 에 대응 prefix 가 없는 경로: ${entry.path}`);
    hit.operations.push(entry);
    assigned.add(entry.path + ' ' + entry.method);
  }
  if (assigned.size !== ops.length) throw new Error('오퍼레이션 그룹 배정이 누락됐다');
  return groups;
}

function renderOperation({ path, method, op }, spec, cfg, usage) {
  const out = [];
  const id = operationAnchor(method, path);
  const label = `${method.toUpperCase()} ${path}`;

  out.push(`#### ${label} {#${id}}`, '');

  const summaryOverride = cfg.summaryOverrides?.[op.operationId];
  let summary = op.summary;
  if (summaryOverride !== undefined) {
    usage.summaryOverrides.add(op.operationId);
    summary = applyOverride('summaryOverrides', op.operationId, summaryOverride, op.summary);
  }
  if (summary) out.push(escapeMd(summary), '');

  // 파라미터
  const params = op.parameters ?? [];
  if (params.length) {
    out.push('**요청 파라미터**', '');
    out.push('| 이름 | 위치 | 필수 | 설명 | 예시 |', '| --- | --- | --- | --- | --- |');
    for (const p of params) {
      out.push(
        `| \`${p.name}\` | ${p.in} | ${p.required ? '필수' : '선택'} | ${cell(p.description)} | ${
          p.example === undefined ? '—' : `\`${cell(String(p.example))}\``
        } |`,
      );
    }
    out.push('');
  }

  // 요청 본문
  const content = op.requestBody?.content ?? {};
  const jsonSchema = content['application/json']?.schema;
  const hasMultipart = Boolean(content['multipart/form-data']);

  if (jsonSchema) {
    const resolved = resolveRef(spec, jsonSchema);
    if (resolved.name) {
      out.push(`**요청 본문** \`application/json\` — ${resolved.name}`, '');
      out.push(...renderSchemaTable(resolved.name, resolved.schema, cfg, usage));
    }
  }

  if (hasMultipart) {
    out.push(
      callout(
        'warn',
        `<strong>멀티파트 업로드 계약은 이 자동 생성 스펙이 부정확하다.</strong> 파일 직접 업로드 시의 실제 필드명과 제약은 ` +
          `<a href="${cfg.multipartNoticeHref}">유형 1 §2.0</a> 을 따르라. 이 페이지의 요청 본문 표는 ` +
          `<code>application/json</code>(자산 참조 투입) 경우에만 유효하다.`,
      ),
      '',
    );
  }

  // 선언된 응답 — 스키마/예시 슬롯 없음(의도적)
  const responses = op.responses ?? {};
  const codes = Object.keys(responses).sort();
  out.push(`**${cfg.responsesLabel}**`, '');
  if (!codes.some((c) => /^2\d\d$/.test(c))) {
    out.push(
      `> 이 오퍼레이션에는 성공(2xx) 응답이 스펙에 선언돼 있지 않다. 아래 표는 **선언된 것만** 보여 준다.`,
      '',
    );
  }
  out.push('| 코드 | 설명 |', '| --- | --- |');
  for (const code of codes) {
    out.push(`| \`${code}\` | ${cell(responses[code]?.description) || '—'} |`);
  }
  out.push('');

  return out;
}

function renderSchemaTable(schemaName, schema, cfg, usage) {
  const out = [];
  const required = new Set(schema.required ?? []);
  out.push('| 속성 | 타입 | 필수 | 설명 |', '| --- | --- | --- | --- |');
  for (const [prop, def] of Object.entries(schema.properties ?? {})) {
    const key = `${schemaName}.${prop}`;

    const descOverride = cfg.descriptionOverrides?.[key];
    let description = def.description ?? '';
    if (descOverride !== undefined) {
      usage.descriptionOverrides.add(key);
      description = applyOverride('descriptionOverrides', key, descOverride, def.description);
    }

    const notes = cfg.enumNotes?.[key] ?? {};
    if (cfg.enumNotes?.[key] !== undefined) {
      usage.enumNotes.add(key);
      const allowed = new Set(def.enum ?? []);
      const unknown = Object.keys(notes).filter((v) => !allowed.has(v));
      if (unknown.length) {
        throw new Error(
          `OPENAPI.enumNotes['${key}'] 에 스펙 enum 에 없는 값 ${unknown.length}건: ${unknown.join(', ')}\n` +
            `  스펙 허용값: ${[...allowed].join(', ') || '(enum 아님)'}\n` +
            `→ 서버 enum 이 바뀌었다. 주석이 조용히 사라지는 것을 막기 위해 빌드를 세운다.`,
        );
      }
    }

    const extra = def.enum
      ? ` 허용값: ${def.enum
          .map((v) => `\`${v}\`${notes[v] ? ` (${notes[v]})` : ''}`)
          .join(', ')}.`
      : '';
    const dflt = def.default !== undefined ? ` 기본값 \`${JSON.stringify(def.default)}\`.` : '';
    out.push(
      `| \`${prop}\` | ${typeLabel(def)} | ${required.has(prop) ? '필수' : '선택'} | ${cell(
        `${description}${extra}${dflt}`,
      )} |`,
    );
  }
  out.push('');
  return out;
}

function typeLabel(def) {
  if (def.type === 'array') return `array&lt;${def.items?.type ?? 'object'}&gt;`;
  return def.type ?? 'object';
}

function resolveRef(spec, schema) {
  if (schema?.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const resolved = spec.components?.schemas?.[name];
    if (!resolved) throw new Error(`스키마 참조를 해석할 수 없다: ${schema.$ref}`);
    return { name, schema: resolved };
  }
  return { name: null, schema };
}

export function operationAnchor(method, path) {
  return `op-${method}-${slugPath(path)}`;
}

function slugPath(path) {
  return path
    .replace(/^\/api\/v1\/?/, '')
    .replace(/[{}]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'root';
}

/** 표 셀 안전화: 파이프 이스케이프 + 개행 제거 */
function cell(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

function escapeMd(value) {
  return String(value).replace(/\s*\n\s*/g, ' ').trim();
}

function callout(kind, innerHtml) {
  return `<div class="callout callout-${kind}"><p>${innerHtml}</p></div>`;
}
