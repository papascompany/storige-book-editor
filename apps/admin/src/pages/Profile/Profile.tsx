import { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Space } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth';

const { Title, Text } = Typography;

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const Profile = () => {
  const [form] = Form.useForm<ChangePasswordFormValues>();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: ChangePasswordFormValues) => {
    setLoading(true);
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success('비밀번호가 변경되었습니다');
      form.resetFields();
    } catch (error: any) {
      console.error('Change password error:', error);
      message.error(error.response?.data?.message || '변경 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ maxWidth: 480 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            비밀번호 변경
          </Title>
          <Text type="secondary">관리자 계정의 비밀번호를 변경합니다.</Text>
        </div>

        <Form
          form={form}
          name="change-password"
          onFinish={onFinish}
          autoComplete="off"
          layout="vertical"
          size="large"
        >
          <Form.Item
            name="currentPassword"
            label="현재 비밀번호"
            rules={[{ required: true, message: '현재 비밀번호를 입력해주세요!' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="현재 비밀번호"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="새 비밀번호"
            rules={[
              { required: true, message: '새 비밀번호를 입력해주세요!' },
              { min: 8, message: '비밀번호는 최소 8자 이상이어야 합니다.' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="새 비밀번호 (최소 8자)"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="새 비밀번호 확인"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '새 비밀번호를 다시 입력해주세요!' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error('새 비밀번호가 일치하지 않습니다.'),
                  );
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="새 비밀번호 확인"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading}>
              비밀번호 변경
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  );
};
