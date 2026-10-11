import { ShieldCheck } from 'lucide-react';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
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

  return (
    <section className="permissions-page" aria-labelledby="permissions-title">
      <div className="permissions-inner">
        <header className="permissions-header">
          <div>
            <h1 id="permissions-title">账号与权限</h1>
            <p>查看当前权限，并管理看板的访问成员。</p>
          </div>
          {canManage && !STATIC_DEMO_MODE ? <span data-pollocloud-share /> : null}
        </header>
        <div className="permissions-identity">
          <ShieldCheck size={20} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <strong>{loading ? '正在读取权限' : user?.userName || 'Pollo AI'}</strong>
            <span>{loading ? '验证中' : user ? roleNames[user.role] || user.role : '私有应用权限由 Pollo Cloud 管理'}</span>
          </div>
        </div>
        <div className="permissions-table" role="table" aria-label="操作权限">
          <div role="row"><strong role="columnheader">操作</strong><strong role="columnheader">当前权限</strong></div>
          <div role="row"><span role="cell">查看看板与诊断报告</span><span role="cell">可用</span></div>
          <div role="row"><span role="cell">更新数据</span><span role="cell">{loading ? '检查中' : canManage ? '可用' : '需要所有者或协作者权限'}</span></div>
          <div role="row"><span role="cell">更新报告</span><span role="cell">当前部署暂不可用</span></div>
          <div role="row"><span role="cell">管理访问成员</span><span role="cell">{loading ? '检查中' : canManage ? '可用' : '仅所有者、管理员或编辑者可用'}</span></div>
        </div>
        {canManage ? (
          <div className="permissions-admin-panel">
            {STATIC_DEMO_MODE ? <AdminManagementPage embedded /> : (
              <div className="permissions-share-management">
                <div>
                  <h2>访问成员</h2>
                  <p>访问者可查看看板，协作者可更新数据。</p>
                </div>
              </div>
            )}
          </div>
        ) : loading ? null : (
          <div className="permissions-readonly">当前账号为只读角色。如需调整成员，请联系应用所有者。</div>
        )}
      </div>
    </section>
  );
}
