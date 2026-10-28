import type { ApiErrorBody } from '@campusflow/shared';
import { cloudToken } from './cloudbase';
export const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = await cloudToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBase}/api${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, body?.error?.message || `请求失败 (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const send = <T>(path: string, body: unknown, method = 'POST') =>
  api<T>(path, { method, body: JSON.stringify(body) });
export async function downloadCSV(path: string, filename: string) {
  const token = await cloudToken();
  const response = await fetch(`${apiBase}/api${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message || '导出失败，请重新登录后重试');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
export function beijingInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16);
}
export function beijingISO(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}
