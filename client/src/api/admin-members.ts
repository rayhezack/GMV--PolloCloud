import { apiRequest } from '@/lib/pollocloud';
import type {
  AddAdminMembersRequest,
  AdminMembersResponse,
  RemoveAdminMemberResponse,
} from '@shared/api.interface';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';

let demoMembers: AdminMembersResponse['members'] = [
  { userId: 'preview-user', name: '本地评审管理员' },
];

function getAdminMembersResponse(response: {
  status?: number;
  data?: unknown;
}): AdminMembersResponse {
  if (response.status === 403) {
    throw new Error('无操作权限，请联系管理员分配角色');
  }

  const data = response.data as Partial<AdminMembersResponse> | undefined;
  if (!data || !Array.isArray(data.members)) {
    throw new Error('管理员数据返回异常');
  }

  return {
    members: data.members,
    includesAppDevelopers: Boolean(data.includesAppDevelopers),
  };
}

export async function getAdminMembers(): Promise<AdminMembersResponse> {
  if (STATIC_DEMO_MODE) {
    return { members: demoMembers, includesAppDevelopers: true };
  }
  const response = await apiRequest<AdminMembersResponse>('/api/admin-members');
  return getAdminMembersResponse(response);
}

export async function addAdminMembers(
  req: AddAdminMembersRequest,
): Promise<AdminMembersResponse> {
  if (STATIC_DEMO_MODE) {
    const existing = new Set(demoMembers.map((member) => member.userId));
    demoMembers = [
      ...demoMembers,
      ...req.userIds
        .filter((userId) => !existing.has(userId))
        .map((userId) => ({ userId, name: userId })),
    ];
    return { members: demoMembers, includesAppDevelopers: true };
  }
  const response = await apiRequest<AdminMembersResponse>('/api/admin-members', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  return getAdminMembersResponse(response);
}

export async function removeAdminMember(
  userId: string,
): Promise<RemoveAdminMemberResponse> {
  if (STATIC_DEMO_MODE) {
    demoMembers = demoMembers.filter((member) => member.userId !== userId);
    return { removedUserId: userId };
  }
  const response = await apiRequest<RemoveAdminMemberResponse>(`/api/admin-members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  if (response.status === 403) {
    throw new Error('无操作权限，请联系管理员分配角色');
  }

  const data = response.data as Partial<RemoveAdminMemberResponse> | undefined;
  if (!data?.removedUserId) {
    throw new Error('管理员移除结果返回异常');
  }
  return { removedUserId: data.removedUserId };
}
