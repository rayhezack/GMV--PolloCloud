import { PageHeader, DataTable } from '@/components/system';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
import '../DataPage/data-page.css';
import AdminManagementPage from '@/pages/AdminManagementPage/AdminManagementPage';

const roleNames: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '编辑者',
  viewer: '查看者',
};

export default function PermissionsPage() {
  const { user, loading } = usePollocloudUser();
  const canManage = canManagePollocloudApp(user);
  const [managementOpen, setManagementOpen] = useState(false);

  return (
    <section className="v62-page v62-sheet-page permissions-page">
      <PageHeader title="账号与权限" />
      <div className="permissions-inner">
        <div className="permissions-identity">
          <div>
            <strong>{loading ? '正在读取权限' : user?.userName || 'Pollo AI'}</strong>
            <span>
              {loading ? '验证中' : user ? roleNames[user.role] || user.role : '私有应用权限由 Pollo Cloud 管理'}
            </span>
          </div>
        </div>
        <DataTable
          rows={[
            { id: 'view', label: '查看看板与诊断报告', permission: '可用' },
            {
              id: 'sync',
              label: '更新数据',
              permission: loading ? '检查中' : canManage ? '可用' : '需要所有者或协作者权限',
            },
            {
              id: 'report',
              label: '生成报告',
              permission: loading ? '检查中' : canManage ? '可用' : '需要所有者或协作者权限',
            },
            {
              id: 'members',
              label: '管理访问成员',
              permission: loading ? '检查中' : canManage ? '可用' : '仅所有者、管理员或编辑者可用',
            },
          ]}
          columns={[
            { key: 'label', header: '操作', render: (r) => r.label },
            { key: 'permission', header: '当前权限', render: (r) => r.permission },
          ]}
        />
        {canManage ? (
          <div className="permissions-admin-panel">
            {STATIC_DEMO_MODE ? (
              <AdminManagementPage embedded />
            ) : (
              <div className="permissions-share-management">
                <div>
                  <h2>管理访问成员</h2>
                  <p>添加成员、调整访问权限或管理已有协作者。</p>
                </div>
                <Button onClick={() => setManagementOpen(true)}>管理成员</Button>
              </div>
            )}
          </div>
        ) : loading ? null : (
          <div className="permissions-readonly">当前账号为只读角色。如需调整成员，请联系应用所有者。</div>
        )}
      </div>
      {canManage && (
        <Dialog open={managementOpen} onOpenChange={setManagementOpen}>
          <DialogContent className="member-management-dialog" aria-describedby={undefined}>
            <DialogTitle className="sr-only">管理访问成员</DialogTitle>
            <iframe
              src="https://pollocloud.com/apps/pollo-ai/share?embed=1&from=%2Fpermissions"
              title="成员与访问权限"
            />
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
