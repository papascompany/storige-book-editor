/**
 * partnerView 를 거쳐 응답하는 핸들러는 모두 @ApiResponse type PartnerJobViewDto 를 단다.
 *
 * dto/partner-job-view.dto.spec.ts 는 Swagger 문서의 $ref 로 9라우트를 고정하지만,
 * 새 핸들러가 this.partnerView() 로 응답하면서 @ApiResponse type 을 빠뜨리면 $ref 자체가
 * 생기지 않아 그 검사를 통과한다. 여기서는 controller 소스에서 this.partnerView() 를 호출하는
 * 메서드를 직접 찾아, 각 메서드의 Swagger 응답 메타데이터에 PartnerJobViewDto 가 있는지 본다.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { WorkerJobsController } from './worker-jobs.controller';
import { PartnerJobViewDto } from './dto/partner-job-view.dto';

/** 메서드 본문에 this.partnerView(...) 호출이 있는 WorkerJobsController 메서드 이름 집합. */
function handlersCallingPartnerView(): string[] {
  const file = path.join(__dirname, 'worker-jobs.controller.ts');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set<string>();

  const callsPartnerView = (node: ts.Node): boolean => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.expression.name.text === 'partnerView'
    ) {
      return true;
    }
    return ts.forEachChild(node, callsPartnerView) ?? false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'WorkerJobsController') {
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          member.body &&
          ts.isIdentifier(member.name) &&
          member.name.text !== 'partnerView' &&
          callsPartnerView(member.body)
        ) {
          names.add(member.name.text);
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...names].sort();
}

function responseTypes(method: string): unknown[] {
  const handler = (WorkerJobsController.prototype as unknown as Record<string, unknown>)[method];
  const meta = Reflect.getMetadata(DECORATORS.API_RESPONSE, handler as object) as
    | Record<string, { type?: unknown }>
    | undefined;
  return Object.values(meta ?? {}).map((r) => r.type);
}

describe('partnerView 응답 핸들러의 Swagger 응답 타입', () => {
  const handlers = handlersCallingPartnerView();

  it('partnerView 로 응답하는 핸들러 집합(늘거나 줄면 이 목록과 문서 spec 을 함께 갱신)', () => {
    expect(handlers).toEqual(
      [
        'createAttachPagePadJob',
        'createBleedFixJob',
        'createComposeMixed',
        'createPageCountFixJobExternal',
        'createRenderPages',
        'createSplitSynthesisJobExternal',
        'createSynthesisJobExternal',
        'createValidationJobExternal',
        'findOneExternal',
      ].sort(),
    );
  });

  it.each(handlers)('%s 는 @ApiResponse type PartnerJobViewDto 를 단다', (method) => {
    expect(responseTypes(method)).toContain(PartnerJobViewDto);
  });
});
