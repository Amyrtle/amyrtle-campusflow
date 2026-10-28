import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Analytics } from '@campusflow/shared';
import { Empty, Field } from './ui';
export default function AnalyticsCharts({ data }: { data: Analytics }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <>
      <div className="chart-filters">
        <Field label="趋势开始日期">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="趋势结束日期">
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <button
          className="btn secondary"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          显示全部日期
        </button>
        <p className="muted">日期仅筛选下方趋势图；上方指标统计整场活动。</p>
      </div>
      <div className="charts-grid">
        {[
          { key: 'registration_trend', title: '报名趋势', color: '#7961df' },
          { key: 'checkin_trend', title: '签到时间分布', color: '#31a6a3' },
        ].map((chart) => {
          const rows = data[chart.key as 'registration_trend' | 'checkin_trend'].filter(
            (row) =>
              (!from || row.date.slice(0, 10) >= from) && (!to || row.date.slice(0, 10) <= to),
          );
          return (
            <section className="panel" key={chart.key}>
              <h2>{chart.title}</h2>
              <p className="muted">按北京时间分组 · 真实业务数据</p>
              {!rows.length ? (
                <Empty title="所选日期内还没有数据" />
              ) : (
                <div className="chart">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => String(v).slice(5, 16)}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip labelFormatter={(v) => String(v)} formatter={(v) => [v, '人数']} />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke={chart.color}
                        fill={chart.color}
                        fillOpacity={0.13}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
