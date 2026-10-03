import type { ReactElement } from 'react';
import { Alert, Card, Descriptions, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import type { ValidationError, ValidationWarning } from '../api/worker-jobs';
import {
  countInfoWarnings,
  errorCodeLabel,
  formatMmSize,
  formatMmSizeOrDash,
  isInfoWarning,
  trimBoxBasisDetail,
  trimBoxBasisDetailText,
  warningCodeLabel,
  type ValidationView,
} from './validationResultHelpers';

const { Text } = Typography;

type ErrorRow = ValidationError & { key: string };
type WarningRow = ValidationWarning & { key: string };

const renderAutoFixable = (autoFixable: boolean, record: ValidationError | ValidationWarning) =>
  autoFixable ? <Tag color="blue">{record.fixMethod || 'Yes'}</Tag> : <Tag>No</Tag>;

const errorColumns: ColumnsType<ErrorRow> = [
  {
    title: '코드',
    dataIndex: 'code',
    key: 'code',
    render: (code: string) => <Tag color="error">{errorCodeLabel(code)}</Tag>,
  },
  {
    title: '메시지',
    dataIndex: 'message',
    key: 'message',
  },
  {
    title: '자동 수정',
    dataIndex: 'autoFixable',
    key: 'autoFixable',
    render: renderAutoFixable,
  },
];

const warningColumns: ColumnsType<WarningRow> = [
  {
    title: '코드',
    dataIndex: 'code',
    key: 'code',
    // 정보성 경고(TRIMBOX_SIZE_BASIS 등)는 판정과 무관하므로 정보 색으로 표시한다
    render: (code: string) => (
      <Tag color={isInfoWarning(code) ? 'blue' : 'warning'}>{warningCodeLabel(code)}</Tag>
    ),
  },
  {
    title: '메시지',
    dataIndex: 'message',
    key: 'message',
    render: (msg: string, record) => {
      const detail = trimBoxBasisDetail(record);
      if (!detail) return msg;
      return (
        <>
          <div>{msg}</div>
          <Text type="secondary">{trimBoxBasisDetailText(detail)}</Text>
        </>
      );
    },
  },
  {
    title: '자동 수정',
    dataIndex: 'autoFixable',
    key: 'autoFixable',
    render: renderAutoFixable,
  },
];

export interface ValidationResultViewProps {
  result: ValidationView;
}

/**
 * 검증 결과 요약·PDF 메타데이터·에러·경고 표 (Worker 테스트·워커 작업 상세·세션 작업 목록 공용).
 * result 는 extractValidationResult 로 타입을 확인한 값만 받는다.
 */
export function ValidationResultView({ result }: ValidationResultViewProps): ReactElement {
  const { isValid, errors, warnings, metadata } = result;
  const infoCount = countInfoWarnings(warnings);
  const summary = `에러: ${errors.length}개, 경고: ${warnings.length}개${
    infoCount > 0 ? ` (정보 ${infoCount}개 포함)` : ''
  }`;

  return (
    <div>
      {/* Result Summary */}
      <Alert
        type={isValid ? 'success' : 'error'}
        message={isValid ? '검증 통과' : '검증 실패'}
        description={summary}
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* Metadata */}
      <Card title="PDF 메타데이터" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="페이지 수">{metadata.pageCount || '-'}</Descriptions.Item>
          <Descriptions.Item label="페이지 크기">{formatMmSizeOrDash(metadata.pageSize)}</Descriptions.Item>
          <Descriptions.Item label="재단 여백">
            {metadata.hasBleed ? `있음 (${metadata.bleedSize || 0}mm)` : '없음'}
          </Descriptions.Item>
          <Descriptions.Item label="색상 모드">{metadata.colorMode || '-'}</Descriptions.Item>
          {metadata.trimBox ? (
            <Descriptions.Item label="재단 크기(TrimBox)">{formatMmSize(metadata.trimBox)}</Descriptions.Item>
          ) : null}
        </Descriptions>
      </Card>

      {/* Errors */}
      {errors.length > 0 && (
        <Card
          title={<><CloseCircleOutlined style={{ color: '#ff4d4f' }} /> 에러 ({errors.length})</>}
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Table<ErrorRow>
            dataSource={errors.map((e, idx) => ({ ...e, key: `error-${idx}` }))}
            columns={errorColumns}
            pagination={false}
            size="small"
          />
        </Card>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card
          title={<><ExclamationCircleOutlined style={{ color: '#faad14' }} /> 경고 ({warnings.length})</>}
          size="small"
        >
          <Table<WarningRow>
            dataSource={warnings.map((w, idx) => ({ ...w, key: `warning-${idx}` }))}
            columns={warningColumns}
            pagination={false}
            size="small"
          />
        </Card>
      )}
    </div>
  );
}
