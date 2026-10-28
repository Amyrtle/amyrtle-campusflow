import { expect, it, vi } from 'vitest';
import { createApp } from '../../services/api/src/app';

it('云托管就绪检查在数据库失联时返回503且不泄露连接信息', async () => {
  const app = await createApp({ dataDir: 'memory://', authMode: 'local' });
  try {
    const healthy = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json().status).toBe('ok');
    const connection = vi
      .spyOn(app.db, 'query')
      .mockRejectedValue(new Error('private-database-connection-details'));
    try {
      const unhealthy = await app.inject({ method: 'GET', url: '/api/health' });
      expect(unhealthy.statusCode).toBe(503);
      expect(unhealthy.json()).toEqual({ status: 'unavailable', code: 'DATABASE_UNAVAILABLE' });
      expect(unhealthy.body).not.toContain('private-database');
    } finally {
      connection.mockRestore();
    }
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
