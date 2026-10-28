export const cloudEnabled = Boolean(import.meta.env.VITE_CLOUDBASE_ENV_ID);
type CloudAuth = ReturnType<ReturnType<(typeof import('@cloudbase/js-sdk'))['init']>['auth']>;
let cloudAuthPromise: Promise<CloudAuth> | undefined;
export async function getCloudAuth() {
  if (!cloudEnabled) throw new Error('未配置 CloudBase 环境');
  cloudAuthPromise ||= import('@cloudbase/js-sdk').then(({ default: cloudbase }) =>
    cloudbase
      .init({
        env: import.meta.env.VITE_CLOUDBASE_ENV_ID,
        region: import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai',
        accessKey: import.meta.env.VITE_PUBLISHABLE_KEY || undefined,
      })
      .auth(),
  );
  return cloudAuthPromise;
}
export async function cloudToken() {
  if (!cloudEnabled) return null;
  try {
    const { data, error } = await (await getCloudAuth()).getSession();
    const session = data.session;
    if (error || !session?.user || session.user.is_anonymous) return null;
    return session.access_token || null;
  } catch {
    return null;
  }
}
