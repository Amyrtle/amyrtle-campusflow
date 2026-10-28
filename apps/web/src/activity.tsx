import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  QrCode,
  ScanLine,
  Share2,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  activityInputSchema,
  statusLabels,
  transitions,
  type Activity,
  type ActivityInput,
  type Analytics,
  type FormField,
  type Plan,
  type Registration,
  type Survey,
  type SurveyQuestion,
} from '@campusflow/shared';
import { api, beijingInput, beijingISO, dateTime, downloadCSV, send } from './api';
import { useAuth } from './session';
import { Empty, ErrorState, Field, Loading, PageHead, Submit, useToast } from './ui';
import { Stat } from './pages';
const AnalyticsCharts = lazy(() => import('./AnalyticsCharts'));

export function ActivityEditor() {
  const { id } = useParams();
  const { org } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const plan = (location.state as { plan?: Plan } | null)?.plan;
  const query = useQuery({
    queryKey: ['activity', id],
    queryFn: () => api<Activity>(`/activities/${id}`),
    enabled: !!id,
  });
  const [fields, setFields] = useState<FormField[]>(plan?.suggested_form_fields || []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (query.data) setFields(query.data.form_fields);
  }, [query.data]);
  if (!org)
    return (
      <Empty
        title="请先创建或加入组织"
        action={
          <Link to="/app/settings" className="btn primary">
            前往组织设置
          </Link>
        }
      />
    );
  if (!['Owner', 'Admin'].includes(org.role)) return <Empty title="你没有编辑活动的权限" />;
  if (id && query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const a = query.data;
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const dayAfter = new Date(Date.now() + 93600000).toISOString();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const value: ActivityInput = activityInputSchema.parse({
        title: f.get('title'),
        description: f.get('description'),
        category: f.get('category'),
        location: f.get('location'),
        capacity: Number(f.get('capacity')),
        start_time: beijingISO(String(f.get('start_time'))),
        end_time: beijingISO(String(f.get('end_time'))),
        registration_start: beijingISO(String(f.get('registration_start'))),
        registration_deadline: beijingISO(String(f.get('registration_deadline'))),
        cover_image: String(f.get('cover_image') || ''),
        form_fields: fields,
      });
      const result = await send<Activity>(
        id ? `/activities/${id}` : `/organizations/${org.id}/activities`,
        value,
        id ? 'PATCH' : 'POST',
      );
      await client.invalidateQueries({ queryKey: ['activities'] });
      await client.invalidateQueries({ queryKey: ['activity', id] });
      toast(id ? '活动已更新' : '活动草稿已创建');
      navigate(`/app/events/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Link className="back-link" to={id ? `/app/events/${id}` : '/app/events'}>
        <ArrowLeft size={16} />
        返回活动
      </Link>
      <PageHead eyebrow="MAKE IT HAPPEN" title={id ? '完善你的活动' : '一个好想法，即将发生。'}>
        补充真实的信息。保存草稿后，你可以预览并决定何时发布。
      </PageHead>
      <form onSubmit={submit} className="editor-layout">
        <div>
          <section className="panel">
            <div className="panel-title">
              <span className="section-number">01</span>
              <h2>活动基本信息</h2>
            </div>
            <div className="form-grid">
              <Field label="活动名称" wide>
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={a?.title || plan?.event_title || ''}
                  placeholder="为这次相聚起一个名字"
                />
              </Field>
              <Field label="活动简介" wide>
                <textarea
                  name="description"
                  rows={6}
                  maxLength={12000}
                  defaultValue={
                    a?.description ||
                    (plan
                      ? `${plan.event_summary}\n\n活动流程\n${plan.agenda.map((x) => `${x.time} ${x.title}：${x.description}`).join('\n')}`
                      : '')
                  }
                  placeholder="介绍活动亮点、适合人群与具体安排"
                />
              </Field>
              <Field label="活动分类">
                <input
                  name="category"
                  maxLength={60}
                  defaultValue={a?.category || '校园活动'}
                  list="categories"
                />
                <datalist id="categories">
                  <option>创意实践</option>
                  <option>科技交流</option>
                  <option>社群活动</option>
                  <option>赛事工作坊</option>
                </datalist>
              </Field>
              <Field label="活动地点">
                <input
                  name="location"
                  required
                  maxLength={200}
                  defaultValue={a?.location || '待确认'}
                />
              </Field>
              <Field label="封面图片 URL" wide hint="选填，使用你有权使用的 HTTPS 图片地址。">
                <input
                  name="cover_image"
                  type="url"
                  defaultValue={a?.cover_image || ''}
                  placeholder="https://…"
                />
              </Field>
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <span className="section-number">02</span>
              <h2>时间与报名</h2>
            </div>
            <p className="muted">以下日期与时间均为北京时间（UTC+8）。</p>
            <div className="form-grid">
              <Field label="活动开始">
                <input
                  name="start_time"
                  type="datetime-local"
                  required
                  defaultValue={beijingInput(a?.start_time || tomorrow)}
                />
              </Field>
              <Field label="活动结束">
                <input
                  name="end_time"
                  type="datetime-local"
                  required
                  defaultValue={beijingInput(a?.end_time || dayAfter)}
                />
              </Field>
              <Field label="报名开放">
                <input
                  name="registration_start"
                  type="datetime-local"
                  required
                  defaultValue={beijingInput(
                    a?.registration_start || new Date(Date.now() - 3600000).toISOString(),
                  )}
                />
              </Field>
              <Field label="报名截止">
                <input
                  name="registration_deadline"
                  type="datetime-local"
                  required
                  defaultValue={beijingInput(a?.registration_deadline || tomorrow)}
                />
              </Field>
              <Field label="活动人数上限" hint="1–10000 人；达到人数上限后自动停止接受报名。">
                <input
                  name="capacity"
                  type="number"
                  min={1}
                  max={10000}
                  required
                  defaultValue={a?.capacity || 100}
                />
              </Field>
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <span className="section-number">03</span>
              <h2>报名表单</h2>
            </div>
            <p className="muted">
              默认收集参与者称呼。只添加活动必需的信息，不建议收集学号、证件号码或住址。
            </p>
            {fields.map((field, i) => (
              <div className="custom-field" key={field.id}>
                <div className="form-grid">
                  <Field label={`问题 ${i + 1}`}>
                    <input
                      required
                      maxLength={80}
                      value={field.label}
                      onChange={(e) =>
                        setFields(
                          fields.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  </Field>
                  <Field label="回答类型">
                    <select
                      value={field.type}
                      onChange={(e) =>
                        setFields(
                          fields.map((x, n) =>
                            n === i
                              ? {
                                  ...x,
                                  type: e.target.value as 'text' | 'select',
                                  options:
                                    e.target.value === 'select' ? ['选项一', '选项二'] : undefined,
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="text">文本</option>
                      <option value="select">单选</option>
                    </select>
                  </Field>
                  {field.type === 'select' && (
                    <Field label="选项" hint="每行一个选项" wide>
                      <textarea
                        required
                        value={field.options?.join('\n') || ''}
                        onChange={(e) =>
                          setFields(
                            fields.map((x, n) =>
                              n === i ? { ...x, options: e.target.value.split('\n') } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                  )}
                </div>
                <div className="actions spread">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        setFields(
                          fields.map((x, n) =>
                            n === i ? { ...x, required: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    必填
                  </label>
                  <button
                    type="button"
                    className="text-btn danger"
                    onClick={() => setFields(fields.filter((_, n) => n !== i))}
                  >
                    <Trash2 size={15} />
                    移除
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn secondary"
              disabled={fields.length >= 15}
              onClick={() =>
                setFields([
                  ...fields,
                  { id: crypto.randomUUID(), label: '', type: 'text', required: false },
                ])
              }
            >
              <Plus size={16} />
              添加报名问题
            </button>
          </section>
        </div>
        <aside className="editor-aside">
          <div className="panel">
            <p className="eyebrow">READY WHEN YOU ARE</p>
            <h2>保留灵感，稳步推进。</h2>
            <p className="muted">
              草稿只对有权限的团队成员可见。检查活动信息后，再在详情页点击发布。
            </p>
            <ul className="check-list">
              <li>
                <CheckCircle2 size={16} />
                明确活动的时间与地点
              </li>
              <li>
                <CheckCircle2 size={16} />
                设置合理的参与人数
              </li>
              <li>
                <CheckCircle2 size={16} />
                仅收集必要的报名信息
              </li>
            </ul>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Submit pending={pending}>
              {id ? '保存修改' : '保存活动草稿'} <ArrowRight size={17} />
            </Submit>
            <Link className="btn ghost full" to={id ? `/app/events/${id}` : '/app/events'}>
              取消
            </Link>
          </div>
        </aside>
      </form>
    </>
  );
}

export function ActivityDetail() {
  const { id } = useParams();
  const { org } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const [pending, setPending] = useState(false);
  const query = useQuery({
    queryKey: ['activity', id],
    queryFn: () => api<Activity>(`/activities/${id}`),
    refetchInterval: 20000,
  });
  if (query.isPending) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const activity = query.data;
  const canManage = org?.role === 'Owner' || org?.role === 'Admin';
  const isViewer = org?.role === 'Viewer';
  const publicUrl = `${window.location.origin}/events/${activity.slug}`;
  const transition = async (status: string) => {
    if (status === 'Cancelled' && !window.confirm('确认取消活动？取消后不再接受报名。')) return;
    setPending(true);
    try {
      await send(`/activities/${id}/status`, { status });
      await client.invalidateQueries({ queryKey: ['activity', id] });
      await client.invalidateQueries({ queryKey: ['activities'] });
      toast(`活动已更新为${statusLabels[status as keyof typeof statusLabels]}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setPending(false);
    }
  };
  const copy = (text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast('链接已复制'))
      .catch(() => toast('浏览器不支持自动复制，请从地址栏复制', true));
  const tabs = [
    { key: 'overview', label: '活动概览' },
    ...(!isViewer
      ? [
          { key: 'registrations', label: '报名名单' },
          { key: 'checkin', label: '现场签到' },
        ]
      : []),
    { key: 'analytics', label: '数据分析' },
    ...(canManage
      ? [
          { key: 'survey', label: '反馈问卷' },
          { key: 'insight', label: '活动复盘' },
          { key: 'staff', label: '工作人员' },
        ]
      : []),
  ];
  return (
    <>
      <Link to="/app/events" className="back-link">
        <ArrowLeft size={16} />
        返回活动列表
      </Link>
      <PageHead
        eyebrow="EVENT WORKSPACE"
        title={activity.title}
        actions={
          canManage && (
            <>
              <Link className="btn secondary" to={`/app/events/${id}/edit`}>
                <Pencil size={16} />
                编辑活动
              </Link>
              {activity.status !== 'Draft' && (
                <button className="btn primary" onClick={() => copy(publicUrl)}>
                  <Share2 size={16} />
                  分享活动
                </button>
              )}
            </>
          )
        }
      >
        <span className={`status status-${activity.status}`}>
          {statusLabels[activity.status]}
        </span>{' '}
        <span className="detail-sub">
          {dateTime(activity.start_time)} · {activity.location}
        </span>
      </PageHead>
      <nav className="tabs" aria-label="活动详情导航">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'overview' && (
        <div className="detail-overview">
          <section className="panel">
            <div className="event-hero-art">
              {activity.cover_image ? (
                <img src={activity.cover_image} alt={activity.title} />
              ) : (
                <>
                  <div className="art-rings" />
                  <span className="eyebrow">LET’S MAKE IT HAPPEN</span>
                  <h2>{activity.category}</h2>
                  <span className="art-star">✳</span>
                </>
              )}
            </div>
            <h2>关于这场活动</h2>
            <p className="preserve-lines">{activity.description || '还没有填写活动介绍。'}</p>
            <div className="event-detail-facts">
              <div>
                <CalendarDays size={20} />
                <span>
                  <small>活动时间（北京时间）</small>
                  <strong>
                    {dateTime(activity.start_time)} — {dateTime(activity.end_time)}
                  </strong>
                </span>
              </div>
              <div>
                <MapPin size={20} />
                <span>
                  <small>活动地点</small>
                  <strong>{activity.location}</strong>
                </span>
              </div>
              <div>
                <Users size={20} />
                <span>
                  <small>参与名额</small>
                  <strong>
                    {activity.registration_count} / {activity.capacity} 人
                  </strong>
                </span>
              </div>
            </div>
          </section>
          <aside>
            <section className="panel">
              <h2>活动进展</h2>
              <div className="capacity-count">
                <strong>{activity.registration_count}</strong>
                <span>/ {activity.capacity} 人已报名</span>
              </div>
              <div className="progress">
                <span
                  style={{
                    width: `${Math.min(100, (activity.registration_count / activity.capacity) * 100)}%`,
                  }}
                />
              </div>
              <p className="muted">报名截止：{dateTime(activity.registration_deadline)}</p>
              {activity.status !== 'Draft' && (
                <Link
                  className="btn secondary full"
                  to={`/events/${activity.slug}`}
                  target="_blank"
                >
                  查看公开页面 <ExternalLink size={16} />
                </Link>
              )}
              {canManage && (
                <div className="status-actions">
                  {transitions[activity.status].map((status) => (
                    <button
                      className={`btn ${status === 'Published' ? 'primary' : 'secondary'} full`}
                      disabled={pending}
                      key={status}
                      onClick={() => void transition(status)}
                    >
                      {
                        {
                          Published: '发布并开放报名',
                          RegistrationClosed: '暂停报名',
                          InProgress: '开始活动与签到',
                          Completed: '结束活动',
                          Archived: '归档活动',
                          Cancelled: '取消活动',
                          Draft: '保存草稿',
                        }[status]
                      }
                    </button>
                  ))}
                </div>
              )}
            </section>
            {canManage && (
              <section className="panel small-panel">
                <h3>管理提醒</h3>
                <p className="muted">
                  确认信息准确后再发布。开始活动后，工作人员可以核验凭证并完成签到。
                </p>
                <button
                  className="text-btn danger"
                  onClick={async () => {
                    if (!window.confirm('确认删除这个活动及其关联数据？此操作不可撤销。')) return;
                    try {
                      await api(`/activities/${id}`, { method: 'DELETE' });
                      await client.invalidateQueries({ queryKey: ['activities'] });
                      navigate('/app/events');
                      toast('活动已删除');
                    } catch (e) {
                      toast((e as Error).message, true);
                    }
                  }}
                >
                  删除活动
                </button>
              </section>
            )}
          </aside>
        </div>
      )}
      {tab === 'registrations' && !isViewer && (
        <Registrations activity={activity} canManage={canManage} />
      )}
      {tab === 'checkin' && !isViewer && <Checkin activity={activity} />}
      {tab === 'analytics' && <AnalyticsPanel activity={activity} />}
      {tab === 'survey' && canManage && <SurveyEditor activity={activity} />}
      {tab === 'insight' && canManage && <Insight activity={activity} />}
      {tab === 'staff' && canManage && <StaffEditor activity={activity} />}
    </>
  );
}
function Registrations({ activity, canManage }: { activity: Activity; canManage: boolean }) {
  const toast = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['registrations', activity.id],
    queryFn: () => api<Registration[]>(`/activities/${activity.id}/registrations`),
    refetchInterval: 15000,
  });
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>报名名单</h2>
          <p className="muted">仅有权限的团队成员可以访问参与者信息。</p>
        </div>
        <div className="actions">
          <input
            aria-label="搜索参与者"
            placeholder="搜索参与者称呼"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {canManage && (
            <button
              className="btn secondary"
              onClick={() =>
                void downloadCSV(
                  `/activities/${activity.id}/export.csv`,
                  `campusflow-${activity.id}.csv`,
                ).catch((e) => toast((e as Error).message, true))
              }
            >
              <Download size={16} />
              导出 CSV
            </button>
          )}
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : !query.data?.length ? (
        <Empty title="正在等待第一位参与者">发布并分享活动链接，让大家加入。</Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>参与者</th>
                <th>报名时间</th>
                <th>补充信息</th>
                <th>签到状态</th>
                {canManage && <th>管理</th>}
              </tr>
            </thead>
            <tbody>
              {query.data
                .filter((r) => r.display_name.includes(search))
                .map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.display_name}</strong>
                    </td>
                    <td>{dateTime(r.created_at)}</td>
                    <td>
                      {Object.entries(r.answers || {}).map(([key, value]) => (
                        <div key={key}>
                          <small>
                            {activity.form_fields.find((f) => f.id === key)?.label || key}：
                          </small>
                          {value}
                        </div>
                      ))}
                    </td>
                    <td>
                      {r.checked_in_at ? (
                        <span className="status status-Published">
                          已签到 · {dateTime(r.checked_in_at)}
                        </span>
                      ) : (
                        <span className="muted">未签到</span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <button
                          className="text-btn danger"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `确认删除 ${r.display_name} 的报名记录？其签到凭证也会失效。`,
                              )
                            )
                              return;
                            try {
                              await api(`/activities/${activity.id}/registrations/${r.id}`, {
                                method: 'DELETE',
                              });
                              await client.invalidateQueries({
                                queryKey: ['registrations', activity.id],
                              });
                              await client.invalidateQueries({
                                queryKey: ['activity', activity.id],
                              });
                              toast('报名记录已删除');
                            } catch (e) {
                              toast((e as Error).message, true);
                            }
                          }}
                        >
                          删除
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Checkin({ activity }: { activity: Activity }) {
  const toast = useToast();
  const client = useQueryClient();
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState<{
    already_checked_in: boolean;
    registration: Registration;
  } | null>(null);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const verify = async (value: string, fromCamera = false) => {
    if (busy.current) return;
    busy.current = true;
    // Read one ticket at a time. Failed requests remain available for an explicit retry.
    setScanning(false);
    if (fromCamera) setToken(value.trim());
    setPending(true);
    setError('');
    setResult(null);
    try {
      const r = await send<{ already_checked_in: boolean; registration: Registration }>(
        `/activities/${activity.id}/checkin`,
        { token: value.trim() },
      );
      setResult(r);
      setToken('');
      setScanning(false);
      await client.invalidateQueries({ queryKey: ['activity', activity.id] });
      await client.invalidateQueries({ queryKey: ['registrations', activity.id] });
      toast(r.already_checked_in ? '这位参与者已经签到' : '签到成功');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
      busy.current = false;
    }
  };
  useEffect(() => {
    if (!scanning || !video.current) return;
    const preview = video.current;
    let controls: { stop: () => void } | undefined;
    let stream: MediaStream | undefined;
    let cancelled = false;
    const releaseCamera = () => {
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (preview.srcObject === stream) preview.srcObject = null;
    };
    const pauseWhenHidden = () => {
      if (document.hidden) setScanning(false);
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    void import('@zxing/browser')
      .then(async ({ BrowserQRCodeReader }) => {
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) {
          releaseCamera();
          return;
        }
        const reader = new BrowserQRCodeReader();
        const scan = await reader.decodeFromStream(
          stream,
          preview,
          (result, _error, scanControls) => {
            if (result && !cancelled && !busy.current) {
              scanControls.stop();
              void verify(result.getText(), true);
            }
          },
        );
        if (cancelled) scan.stop();
        else controls = scan;
      })
      .catch((error: unknown) => {
        releaseCamera();
        if (cancelled) return;
        const name = error instanceof Error ? error.name : '';
        const reason =
          name === 'NotAllowedError' || name === 'SecurityError'
            ? '未获得摄像头权限，请在浏览器的网站设置中允许摄像头后重试'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? '没有找到可用摄像头'
              : name === 'NotReadableError'
                ? '摄像头可能正被其他应用占用，请关闭占用摄像头的应用后重试'
                : '摄像头暂时无法启动，请重试';
        setCameraError(`${reason}。也可使用下方手动签到。`);
        setScanning(false);
      });
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      releaseCamera();
    };
  }, [scanning]);
  return (
    <div className="checkin-layout">
      <section className="panel scanner-panel">
        <div className="panel-title">
          <ScanLine size={22} />
          <h2>现场签到</h2>
        </div>
        <p className="muted">扫描参与者的电子凭证，或输入其完整签到码。</p>
        <div className="scanner-viewport">
          {scanning ? (
            <video ref={video} autoPlay muted playsInline />
          ) : (
            <>
              <div className="scan-corners">
                <QrCode size={68} />
              </div>
              <p>让每一位到场者，被认真记录。</p>
            </>
          )}
          <span className="scan-caption">{activity.title}</span>
        </div>
        {cameraError && (
          <p className="form-error" role="alert">
            {cameraError}
          </p>
        )}
        <button
          className="btn secondary full"
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.isSecureContext) {
              setCameraError('摄像头需要 HTTPS 或 localhost 安全环境。请使用手动输入。');
              return;
            }
            if (!navigator.mediaDevices?.getUserMedia) {
              setCameraError(
                '当前浏览器无法调用摄像头。请使用 Safari 或 Chrome，或在下方手动签到。',
              );
              return;
            }
            setCameraError('');
            setScanning(!scanning);
          }}
        >
          {scanning ? <X size={18} /> : <Camera size={18} />}{' '}
          {scanning ? '停止扫描' : '开启摄像头扫码'}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify(token);
          }}
        >
          <Field label="手动输入签到码">
            <textarea
              rows={3}
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="粘贴参与者的完整签到凭证"
              autoComplete="off"
            />
          </Field>
          <Submit pending={pending}>
            核验并签到 <CheckCircle2 size={17} />
          </Submit>
        </form>
      </section>
      <aside>
        <section className="panel">
          <h2>签到结果</h2>
          {error ? (
            <div className="checkin-result failed" role="alert">
              <X size={36} />
              <h3>未能签到</h3>
              <p>{error}</p>
            </div>
          ) : result ? (
            <div className="checkin-result" role="status">
              <CheckCircle2 size={40} />
              <h3>{result.already_checked_in ? '已经签到，无需重复' : '签到成功'}</h3>
              <p>{result.registration.display_name}</p>
              {result.registration.checked_in_at && (
                <small>{dateTime(result.registration.checked_in_at)}</small>
              )}
            </div>
          ) : (
            <Empty title="等待核验凭证">签到结果会显示在这里。</Empty>
          )}
          <div className="checkin-count">
            <strong>{activity.checkin_count}</strong>
            <span> / {activity.registration_count} 人已签到</span>
          </div>
        </section>
        <section className="panel small-panel">
          <h3>现场小提示</h3>
          <p className="muted">
            同一凭证重复扫描不会重复计数。请确认正在为正确的活动签到。若凭证失效，请联系活动管理员。
          </p>
        </section>
      </aside>
    </div>
  );
}
function AnalyticsPanel({ activity }: { activity: Activity }) {
  const query = useQuery({
    queryKey: ['analytics', activity.id],
    queryFn: () => api<Analytics>(`/activities/${activity.id}/analytics`),
    refetchInterval: 15000,
  });
  if (query.isPending) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const data = query.data;
  return (
    <>
      <div className="stats-grid">
        <Stat
          label="有效报名"
          value={data.registration_count}
          detail={`剩余 ${data.remaining} 个名额`}
        />
        <Stat label="实际签到" value={data.checkin_count} detail="去重后的有效签到" />
        <Stat label="未签到" value={data.absent_count} detail="已报名但尚未签到" />
        <Stat
          label="签到率"
          value={`${Number(data.checkin_rate).toFixed(1)}%`}
          detail="有效签到 / 有效报名 × 100%"
        />
      </div>
      <Suspense fallback={<Loading label="正在加载图表" />}>
        <AnalyticsCharts data={data} />
      </Suspense>
    </>
  );
}
function Insight({ activity }: { activity: Activity }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState('');
  const [mode, setMode] = useState('');
  const query = useQuery({
    queryKey: ['insight', activity.id],
    queryFn: () =>
      api<{ report: string; mode: string } | null>(`/activities/${activity.id}/insight`),
  });
  useEffect(() => {
    if (query.data) {
      setReport(query.data.report);
      setMode(query.data.mode);
    }
  }, [query.data]);
  const generate = async () => {
    setPending(true);
    try {
      const r = await send<{ report: string; mode: string }>(
        `/activities/${activity.id}/insight`,
        {},
      );
      setReport(r.report);
      setMode(r.mode);
      toast('复盘草稿已生成');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="panel insight-panel">
      <div className="section-heading">
        <div>
          <h2>CampusFlow Insight</h2>
          <p className="muted">结合真实报名、签到与反馈数据，留下下一次可以借鉴的经验。</p>
        </div>
        <button className="btn primary" disabled={pending} onClick={() => void generate()}>
          <Sparkles size={17} />
          {pending ? '正在生成…' : report ? '重新生成复盘' : '生成活动复盘'}
        </button>
      </div>
      {mode && (
        <p className="notice">
          {mode === 'mock'
            ? '本地模板复盘 · 基于真实统计数据，非真实 AI 模型输出。'
            : 'AI 模型生成 · 请核对数据与结论后再分享。'}
        </p>
      )}
      {report ? (
        <>
          <Field label="复盘报告（可编辑）">
            <textarea
              rows={22}
              value={report}
              maxLength={20000}
              onChange={(e) => setReport(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await send(`/activities/${activity.id}/insight`, { report }, 'PUT');
                  toast('复盘报告已保存');
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              保存报告
            </button>
            <button
              className="btn secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(report)
                  .then(() => toast('复盘文本已复制'))
                  .catch(() => toast('请手动复制文本', true))
              }
            >
              <ClipboardCopy size={16} />
              复制文本
            </button>
          </div>
        </>
      ) : (
        <Empty title="把这次经验，留给下一场活动">
          完成活动后生成复盘。缺失的反馈和执行记录会明确标注。
        </Empty>
      )}
    </section>
  );
}
function SurveyEditor({ activity }: { activity: Activity }) {
  const toast = useToast();
  const query = useQuery({
    queryKey: ['survey', activity.id],
    queryFn: () => api<Survey>(`/activities/${activity.id}/survey`),
    retry: false,
  });
  const [title, setTitle] = useState('活动体验反馈');
  const [questions, setQuestions] = useState<SurveyQuestion[]>([
    { id: crypto.randomUUID(), title: '这次活动的整体体验如何？', type: 'rating', required: true },
    { id: crypto.randomUUID(), title: '有什么建议留给下一次活动？', type: 'text', required: false },
  ]);
  const [saved, setSaved] = useState<Survey | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (query.data) {
      setTitle(query.data.title);
      setQuestions(query.data.questions);
      setSaved(query.data);
    }
  }, [query.data]);
  const update = (i: number, value: Partial<SurveyQuestion>) =>
    setQuestions((q) => q.map((x, n) => (n === i ? { ...x, ...value } : x)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const r = await send<Survey>(
        `/activities/${activity.id}/survey`,
        { title, questions },
        'PUT',
      );
      setSaved(r);
      toast('问卷已保存');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="panel survey-editor">
      <div className="section-heading">
        <div>
          <h2>听见参与者的声音</h2>
          <p className="muted">参与者使用报名凭证提交，每张凭证仅能提交一次。</p>
        </div>
        {saved && (
          <Link className="btn secondary" to={`/surveys/${saved.id}`} target="_blank">
            <ExternalLink size={16} />
            打开问卷
          </Link>
        )}
      </div>
      {saved && (
        <p className="notice">
          问卷链接：
          <Link to={`/surveys/${saved.id}`}>
            {window.location.origin}/surveys/{saved.id}
          </Link>
          {saved.response_count !== undefined && ` · 已收到 ${saved.response_count} 份反馈`}
        </p>
      )}
      <form onSubmit={submit}>
        <Field label="问卷标题">
          <input
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {questions.map((q, i) => (
          <div className="custom-field" key={q.id}>
            <div className="form-grid">
              <Field label={`问题 ${i + 1}`}>
                <input
                  required
                  value={q.title}
                  maxLength={200}
                  onChange={(e) => update(i, { title: e.target.value })}
                />
              </Field>
              <Field label="类型">
                <select
                  value={q.type}
                  onChange={(e) =>
                    update(i, {
                      type: e.target.value as SurveyQuestion['type'],
                      options: ['single', 'multiple'].includes(e.target.value)
                        ? ['选项一', '选项二']
                        : undefined,
                    })
                  }
                >
                  <option value="rating">评分（1–5）</option>
                  <option value="text">文本回答</option>
                  <option value="single">单选题</option>
                  <option value="multiple">多选题</option>
                </select>
              </Field>
              {['single', 'multiple'].includes(q.type) && (
                <Field label="回答选项" hint="每行一项" wide>
                  <textarea
                    required
                    value={q.options?.join('\n') || ''}
                    onChange={(e) => update(i, { options: e.target.value.split('\n') })}
                  />
                </Field>
              )}
            </div>
            <div className="actions spread">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                必答
              </label>
              <button
                type="button"
                className="text-btn danger"
                onClick={() => setQuestions(questions.filter((_, n) => i !== n))}
              >
                删除问题
              </button>
            </div>
          </div>
        ))}
        <div className="actions">
          <button
            type="button"
            className="btn secondary"
            disabled={questions.length >= 20}
            onClick={() =>
              setQuestions([
                ...questions,
                { id: crypto.randomUUID(), title: '', type: 'text', required: false },
              ])
            }
          >
            <Plus size={16} />
            添加问题
          </button>
          <Submit pending={pending}>保存问卷</Submit>
        </div>
      </form>
      {saved && <SurveyResults activityId={activity.id} />}
    </section>
  );
}
function SurveyResults({ activityId }: { activityId: string }) {
  const query = useQuery({
    queryKey: ['survey-results', activityId],
    queryFn: () =>
      api<{
        response_count: number;
        questions: (SurveyQuestion & {
          average?: number | null;
          answer_count?: number;
          counts?: Record<string, number>;
        })[];
      }>(`/activities/${activityId}/survey/results`),
    refetchInterval: 15000,
  });
  if (query.isPending) return <Loading label="正在读取反馈汇总" />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  return (
    <section className="survey-results">
      <div className="section-heading">
        <div>
          <h2>反馈汇总</h2>
          <p className="muted">已收到 {query.data.response_count} 份反馈 · 仅展示汇总结果</p>
        </div>
        <button className="btn secondary" onClick={() => void query.refetch()}>
          刷新反馈
        </button>
      </div>
      {query.data.questions.map((q) => (
        <article key={q.id}>
          <h3>{q.title}</h3>
          {q.type === 'rating' ? (
            <p className="survey-score">
              <strong>{q.average === null ? '—' : Number(q.average).toFixed(1)}</strong>
              <span> / 5 平均评分</span>
            </p>
          ) : q.type === 'text' ? (
            <p className="muted">收到 {q.answer_count || 0} 条文本回答，未在此公开展示内容。</p>
          ) : (
            <div>
              {Object.entries(q.counts || {}).map(([option, count]) => (
                <div className="survey-result-option" key={option}>
                  <span>{option}</span>
                  <div className="progress">
                    <span
                      style={{
                        width: `${query.data!.response_count ? (count / query.data!.response_count) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
function StaffEditor({ activity }: { activity: Activity }) {
  const toast = useToast();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const members = useQuery({
    queryKey: ['members', activity.organization_id],
    queryFn: () =>
      api<{ user_id: string; display_name: string; email: string; role: string }[]>(
        `/organizations/${activity.organization_id}/members`,
      ),
  });
  const staff = useQuery({
    queryKey: ['staff', activity.id],
    queryFn: () =>
      api<{ user_id: string; display_name: string; email: string }[]>(
        `/activities/${activity.id}/staff`,
      ),
  });
  return (
    <section className="panel">
      <h2>分配活动工作人员</h2>
      <p className="muted">Staff 成员只能访问被分配的活动，负责人和管理员自动拥有管理权限。</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setPending(true);
          void send(`/activities/${activity.id}/staff`, { user_id: f.get('user_id') })
            .then(async () => {
              await client.invalidateQueries({ queryKey: ['staff', activity.id] });
              toast('工作人员已分配');
            })
            .catch((e) => toast((e as Error).message, true))
            .finally(() => setPending(false));
        }}
      >
        <Field label="选择工作人员">
          <select name="user_id" required defaultValue="">
            <option value="" disabled>
              选择组织内的 Staff 成员
            </option>
            {members.data
              ?.filter((m) => m.role === 'Staff')
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name} · {m.email}
                </option>
              ))}
          </select>
        </Field>
        <Submit pending={pending}>添加工作人员</Submit>
      </form>
      {staff.isPending ? (
        <Loading />
      ) : staff.error ? (
        <ErrorState error={staff.error} />
      ) : !staff.data?.length ? (
        <Empty title="还没有分配工作人员" />
      ) : (
        <div className="member-list">
          {staff.data.map((s) => (
            <div key={s.user_id}>
              <span className="avatar">{s.display_name?.[0] || 'S'}</span>
              <span>
                <strong>{s.display_name || s.user_id}</strong>
                <small>{s.email}</small>
              </span>
              <button
                className="text-btn danger"
                onClick={async () => {
                  try {
                    await api(`/activities/${activity.id}/staff/${s.user_id}`, {
                      method: 'DELETE',
                    });
                    await client.invalidateQueries({ queryKey: ['staff', activity.id] });
                    toast('已移除分配');
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
