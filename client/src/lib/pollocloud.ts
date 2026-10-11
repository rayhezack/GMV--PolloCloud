import { POLLOCLOUD_APP_OWNER_ID } from '@shared/auth.constants';

export type PollocloudRole = 'owner' | 'admin' | 'editor' | 'viewer' | string;

export type PollocloudUser = {
  userId: string;
  userName: string;
  avatar?: string;
  role: PollocloudRole;
};

type ApiResponse<T> = {
  data: T;
  status: number;
};

function getCsrfToken(): string | undefined {
  return typeof window !== 'undefined'
    ? (window as Window & { csrfToken?: string }).csrfToken
    : undefined;
}

export async function apiRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const csrfToken = getCsrfToken();
  if (csrfToken && !headers.has('x-suda-csrf-token')) {
    headers.set('x-suda-csrf-token', csrfToken);
  }
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? ((await response.json()) as T)
    : ((await response.text()) as T);
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message: unknown }).message)
        : `请求失败（${response.status}）`;
    const error = new Error(message) as Error & { response?: ApiResponse<T> };
    error.response = { data, status: response.status };
    throw error;
  }
  return { data, status: response.status };
}

function unwrapUser(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  const nested = item.user ?? item.data;
  if (!nested || typeof nested !== 'object') return value;
  const nestedItem = nested as Record<string, unknown>;
  return nestedItem.user ?? nested;
}

export function readPollocloudUser(value: unknown): PollocloudUser | null {
  value = unwrapUser(value);
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const userId = String(
    item.userId ?? item.user_id ?? item.openId ?? item.open_id ?? item.id ?? '',
  );
  if (!userId) return null;
  const explicitRole = item.role ?? item.myRole ?? item.my_role;
  const isAdmin = item.isAdmin === true || item.is_admin === true;
  return {
    userId,
    userName: String(
      item.userName ??
        item.user_name ??
        item.displayName ??
        item.display_name ??
        item.name ??
        '',
    ),
    avatar: String(item.avatar ?? item.avatarUrl ?? item.avatar_url ?? '') || undefined,
    role: String(
      explicitRole ??
        (userId === POLLOCLOUD_APP_OWNER_ID
          ? 'owner'
          : isAdmin
            ? 'admin'
            : 'viewer'),
    ) as PollocloudRole,
  };
}

export function canManagePollocloudApp(
  user: PollocloudUser | null | undefined,
): boolean {
  return Boolean(user && ['owner', 'admin', 'editor'].includes(user.role));
}

export async function getPollocloudUser(): Promise<PollocloudUser | null> {
  if (import.meta.env.VITE_DATA_MODE === 'demo') {
    const role = new URLSearchParams(window.location.search).get('previewRole');
    return {
      userId: 'preview-user',
      userName: '本地评审',
      role: role === 'admin' ? 'admin' : 'viewer',
    };
  }
  try {
    const response = await apiRequest<unknown>('/_pollocloud/me');
    return readPollocloudUser(response.data);
  } catch {
    return null;
  }
}
