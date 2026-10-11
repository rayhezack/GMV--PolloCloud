import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { adminMembersApi } from '@/api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { AdminMember } from '@shared/api.interface';

const AdminManagementPage = ({ embedded = false }: { embedded?: boolean }) => {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [includesAppDevelopers, setIncludesAppDevelopers] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [memberToRemove, setMemberToRemove] = useState<AdminMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const applyResponse = useCallback(
    (response: Awaited<ReturnType<typeof adminMembersApi.getAdminMembers>>) => {
      setMembers(response.members);
      setIncludesAppDevelopers(response.includesAppDevelopers);
    },
    [],
  );

  const loadMembers = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError('');
      applyResponse(await adminMembersApi.getAdminMembers());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '管理员列表加载失败';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleAdd = async () => {
    if (selectedUserIds.length === 0) return;
    try {
      setSaving(true);
      applyResponse(
        await adminMembersApi.addAdminMembers({ userIds: selectedUserIds }),
      );
      setSelectedUserIds([]);
      toast.success('管理员已添加');
    } catch {
      toast.error('添加失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!memberToRemove) return;
    try {
      setSaving(true);
      const { removedUserId } = await adminMembersApi.removeAdminMember(
        memberToRemove.userId,
      );
      setMembers((current) =>
        current.filter((member) => member.userId !== removedUserId),
      );
      setMemberToRemove(null);
      toast.success('管理员已移除');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.error(message.includes('至少保留') ? message : '移除失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const canRemove = members.length > 1 || includesAppDevelopers;

  return (
    <div className={embedded ? 'w-full' : 'mx-auto w-full max-w-[1200px] px-4 py-10 md:px-8'}>
      <header className="flex items-start gap-3 border-b border-border pb-6">
        <span className="flex size-9 shrink-0 items-center justify-center bg-primary text-primary-foreground">
          <ShieldCheck className="size-5" />
        </span>
        <div>
          <h1 className={embedded ? 'text-lg font-semibold text-foreground' : 'text-2xl font-semibold text-foreground'}>
            {embedded ? '访问成员' : '管理员管理'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理可同步数据和生成诊断报告的成员。
          </p>
        </div>
      </header>

      <section className="border-b border-border py-7">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-foreground">添加管理员</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            输入 Pollocloud 用户 ID，添加后立即获得管理员权限。
          </p>
        </div>
        <div className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <input
              className="h-9 w-full rounded-full border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              value={selectedUserIds.join(', ')}
              onChange={(event) =>
                setSelectedUserIds(
                  event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                )
              }
              placeholder="多个 ID 用逗号分隔"
            />
          </div>
          <Button
            type="button"
            className="shrink-0"
            disabled={selectedUserIds.length === 0 || saving}
            onClick={handleAdd}
          >
            <UserPlus className="size-4" />
            {saving ? '正在保存' : '添加管理员'}
          </Button>
        </div>
      </section>

      <section className="pt-7">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              当前管理员
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {members.length} 名指定成员
              {includesAppDevelopers ? '，应用开发者同时拥有权限' : ''}
            </p>
          </div>
        </div>
        {loadError ? (
          <div className="flex items-center justify-between gap-4 border-y border-destructive/30 bg-destructive/5 px-4 py-5 text-sm text-destructive">
            <span>{loadError}</span>
            <Button type="button" variant="outline" onClick={() => void loadMembers()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_72px] gap-4 bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground">
              <span>管理员</span><span>权限范围</span><span className="text-right">操作</span>
            </div>
            {loading ? <div className="px-4 py-8 text-sm text-muted-foreground">正在加载…</div> : members.length === 0 ? <div className="px-4 py-8 text-sm text-muted-foreground">暂无指定管理员</div> : members.map((member) => (
              <div key={member.userId} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_72px] items-center gap-4 border-t border-border px-4 py-3 text-sm">
                <div className="min-w-0"><div className="truncate font-medium text-foreground">{member.name || member.userId}</div><div className="truncate text-xs text-muted-foreground">{member.userId}</div></div>
                <span className="text-muted-foreground">同步、报告、管理员</span>
                <Button type="button" variant="ghost" size="icon" disabled={!canRemove || saving} aria-label={`移除管理员 ${member.name}`} title={canRemove ? '移除管理员' : '至少保留一名管理员'} onClick={() => setMemberToRemove(member)}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <AlertDialog
        open={Boolean(memberToRemove)}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除管理员？</AlertDialogTitle>
            <AlertDialogDescription>
              {memberToRemove?.name} 将无法再同步数据、生成报告或管理管理员。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={saving}
                onClick={handleRemove}
              >
                确认移除
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminManagementPage;
