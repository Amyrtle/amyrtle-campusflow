import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
} from 'lucide-react';
import {
  activityStatuses,
  planSchema,
  roles,
  statusLabels,
  type Activity,
  type Plan,
  type PlanResult,
  type Role,
} from '@campusflow/shared';
import { api, dateTime, send } from './api';
import { useAuth } from './session';
import { Brand, Empty, ErrorState, Field, Loading, PageHead, Submit, useToast } from './ui';
import { cloudEnabled, getCloudAuth } from './cloudbase';

export function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand />
        <nav>
          <a href="#workflow">活动工作流</a>
          <a href="#features">产品能力</a>
          <Link to="/login" className="btn secondary">
            进入工作台 <ArrowUpRight size={16} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-content">
            <span className="pill">
              <span className="live-dot" /> 为校园组织而设计
            </span>
            <h1>
              让每一场校园活动，
              <br />
              都有自己的
              <br />
              <em>智能运营团队。</em>
            </h1>
            <p className="hero-sub">
              从灵感萌芽，到现场相聚。
              <br />
              让策划、报名、签到与复盘在一个工作台里自然衔接。
            </p>
            <div className="actions">
              <Link to="/register" className="btn primary large">
                开始创建活动 <ArrowRight size={18} />
              </Link>
              <Link to="/login" className="btn ghost large">
                体验工作台 <ArrowUpRight size={18} />
              </Link>
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={16} /> 由你审核发布 · 报名数据由组织管理
            </div>
          </div>
          <div className="hero-visual" aria-label="从灵感到活动复盘的工作流程示意">
            <div className="orbit-label">FROM IDEA TO IMPACT</div>
            <div className="visual-window">
              <div className="window-bar">
                <span />
                <span />
                <span />
                <small>CampusFlow 工作流</small>
              </div>
              <div className="visual-heading">
                <span className="mini-mark">
                  <Sparkles size={20} />
                </span>
                <div>
                  <small>把好想法变成一场好活动</small>
                  <strong>你的下一场活动，从这里开始。</strong>
                </div>
              </div>
              <div className="visual-prompt">
                “我们想办一场校园 AIGC 创作交流会…”
                <span>
                  <ArrowRight size={16} />
                </span>
              </div>
              <div className="workflow-mini">
                <span className="step-bubble purple">
                  <WandSparkles />
                </span>
                <div>
                  <strong>一起完善活动方案</strong>
                  <small>目标 · 流程 · 分工 · 风险</small>
                </div>
                <CheckCircle2 className="accent" size={19} />
              </div>
              <div className="workflow-mini">
                <span className="step-bubble cyan">
                  <Users />
                </span>
                <div>
                  <strong>连接每一位参与者</strong>
                  <small>公开报名 · 电子凭证 · 现场签到</small>
                </div>
                <ArrowDown size={18} />
              </div>
              <div className="workflow-mini">
                <span className="step-bubble amber">
                  <ClipboardList />
                </span>
                <div>
                  <strong>让经验留到下一场</strong>
                  <small>真实数据 · 活动反馈 · AI 复盘</small>
                </div>
                <ArrowUpRight size={18} />
              </div>
              <div className="visual-bottom">
                <span>你的创意</span>
                <span className="line" />
                <span>我们的工作流</span>
              </div>
            </div>
            <div className="floating-note">
              <span className="note-spark">✦</span> 少一点忙乱，多一点热爱。
            </div>
            <span className="visual-caption">流程示意 · 非真实运营数据</span>
          </div>
        </section>
        <section id="workflow" className="workflow-section">
          <div className="section-intro">
            <p className="eyebrow">ONE CONNECTED WORKFLOW</p>
            <h2>
              把零散的工作，
              <br />
              连成顺畅的一程。
            </h2>
            <p>关注活动本身，让重复工作有序发生。</p>
          </div>
          <div className="workflow-steps">
            {[
              ['01', '说出你的想法', '用自然语言描述活动，生成可编辑的结构化方案。', Sparkles],
              ['02', '邀请大家参与', '确认方案后创建活动，发布报名链接与电子凭证。', CalendarDays],
              ['03', '让现场井然有序', '手机扫码或输入凭证签到，自动识别重复签到。', ShieldCheck],
              ['04', '为下一次积累', '查看报名和出席数据，结合反馈形成复盘。', ClipboardList],
            ].map(([number, title, text, Icon]) => {
              const I = Icon as typeof Sparkles;
              return (
                <article key={String(number)}>
                  <div className="step-top">
                    <span>{String(number)}</span>
                    <I size={22} />
                  </div>
                  <h3>{String(title)}</h3>
                  <p>{String(text)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section id="features" className="features-section">
          <div>
            <p className="eyebrow">BUILT FOR YOUR CAMPUS</p>
            <h2>
              认真对待每一场活动。
              <br />
              也认真对待每一份数据。
            </h2>
          </div>
          <div className="feature-lines">
            <p>
              <Check />
              组织角色与权限隔离
            </p>
            <p>
              <Check />
              可配置报名字段，按需收集信息
            </p>
            <p>
              <Check />
              满额自动停止报名，重复扫码不会重复计数
            </p>
            <p>
              <Check />
              清晰标识 AI 模板与真实模型输出
            </p>
          </div>
        </section>
        <section className="landing-cta">
          <p className="eyebrow">MAKE SOMETHING HAPPEN</p>
          <h2>
            下一场值得期待的活动，
            <br />
            从你的一个想法开始。
          </h2>
          <Link to="/register" className="btn primary large">
            打开你的工作空间 <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <p>为校园里的创造者与组织者而做。</p>
        <Link to="/privacy">隐私说明</Link>
        <span>© {new Date().getFullYear()} Amyrtle</span>
      </footer>
    </div>
  );
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const { session, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [verification, setVerification] = useState<{
    email: string;
    result: Awaited<ReturnType<Awaited<ReturnType<typeof getCloudAuth>>['getVerification']>>;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const verificationRequest = useRef(0);
  const sendingRequest = useRef(false);
  useEffect(() => {
    if (session)
      navigate((location.state as { from?: string } | null)?.from || '/app', { replace: true });
  }, [session, navigate, location.state]);
  useEffect(() => {
    if (!resendAt) return;
    const update = () => setResendSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  useEffect(
    () => () => {
      verificationRequest.current += 1;
    },
    [],
  );
  const getCode = async () => {
    if (sendingRequest.current || pending || resendAt > Date.now()) return;
    const targetEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setError('请先填写有效邮箱');
      return;
    }
    const requestId = ++verificationRequest.current;
    sendingRequest.current = true;
    setSending(true);
    setVerification(null);
    setCode('');
    setError('');
    try {
      const result = await (await getCloudAuth()).getVerification({ email: targetEmail });
      if (requestId !== verificationRequest.current) return;
      if (!result.verification_id) throw new Error('未取得有效验证码请求，请重新发送。');
      setVerification({ email: targetEmail, result });
      setResendSeconds(60);
      setResendAt(Date.now() + 60000);
      toast('验证码已发送，请检查邮箱');
    } catch (e) {
      if (requestId === verificationRequest.current) setError((e as Error).message);
    } finally {
      sendingRequest.current = false;
      setSending(false);
    }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const display_name = String(form.get('display_name') || email.split('@')[0]);
      const organization_name = String(form.get('organization_name') || '');
      if (cloudEnabled) {
        const targetEmail = email.trim().toLowerCase();
        if (!verification || verification.email !== targetEmail)
          throw new Error('请先为当前邮箱发送验证码');
        const auth = await getCloudAuth();
        const verificationCode = String(form.get('code')).trim();
        const verified = await auth.verify({
          verification_id: verification.result.verification_id,
          verification_code: verificationCode,
        });
        if (!verified.verification_token) throw new Error('验证码未验证成功，请重新发送。');
        if (verification.result.is_user)
          await auth.signIn({
            username: targetEmail,
            verification_token: verified.verification_token,
          });
        else {
          const result = await auth.signUp({
            email: targetEmail,
            verification_code: verificationCode,
            verification_token: verified.verification_token,
            name: display_name,
          });
          if (result.error) throw new Error(result.error.message);
        }
        const { data, error: sessionError } = await auth.getSession();
        if (sessionError) throw new Error(sessionError.message);
        if (!data.session?.access_token || !data.session.user || data.session.user.is_anonymous)
          throw new Error('未取得有效登录会话，请重新登录。');
        await send('/auth/cloudbase', {
          access_token: data.session.access_token,
          ...(organization_name ? { organization_name } : {}),
        });
      } else
        await send(`/auth/${register ? 'register' : 'login'}`, {
          email,
          password: String(form.get('password')),
          ...(register ? { display_name, organization_name } : {}),
        });
      await refresh();
      navigate('/app');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">YOUR IDEAS DESERVE A STAGE</p>
          <h1>
            把你热爱的事，
            <br />
            变成大家的
            <br />
            <em>共同记忆。</em>
          </h1>
          <p>CampusFlow 陪你完成从灵感到复盘的每一步。</p>
        </div>
        <small>AMYRTLE · CAMPUS OPERATIONS</small>
      </aside>
      <main className="auth-main">
        <Link to="/" className="back-link">
          ← 返回首页
        </Link>
        <div className="auth-card">
          <p className="eyebrow">LET’S MAKE IT HAPPEN</p>
          <h1>{register ? '建立你的工作空间' : '欢迎回来'}</h1>
          <p className="muted">
            {register ? '创建账号，开启下一场值得期待的活动。' : '登录后继续你的校园活动。'}
          </p>
          <div className="mode-notice">
            <span className="live-dot" />
            {cloudEnabled ? 'CloudBase 邮箱认证' : '本地开发模式 · 数据保存在本机'}
          </div>
          <form onSubmit={submit}>
            {register && (
              <Field label="你的称呼">
                <input
                  name="display_name"
                  required
                  maxLength={80}
                  autoComplete="name"
                  placeholder="怎么称呼你"
                />
              </Field>
            )}
            <Field label="邮箱">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={200}
                disabled={pending}
                value={email}
                onChange={(e) => {
                  verificationRequest.current += 1;
                  setEmail(e.target.value);
                  setVerification(null);
                  setCode('');
                  setError('');
                }}
                placeholder="you@example.com"
              />
            </Field>
            {cloudEnabled ? (
              <Field label="邮箱验证码">
                <div className="inline-field">
                  <input
                    name="code"
                    aria-label="邮箱验证码"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    required
                    disabled={pending}
                    maxLength={20}
                    autoComplete="one-time-code"
                    placeholder="输入验证码"
                  />
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => void getCode()}
                    disabled={sending || pending || resendSeconds > 0}
                  >
                    {sending
                      ? '发送中…'
                      : resendSeconds > 0
                        ? `${resendSeconds} 秒后重发`
                        : '发送验证码'}
                  </button>
                </div>
              </Field>
            ) : (
              <Field label="密码" hint="至少 10 个字符">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder="输入你的密码"
                />
              </Field>
            )}
            {register && (
              <Field label="组织名称">
                <input
                  name="organization_name"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="例如：校园创意工坊"
                />
              </Field>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Submit pending={pending}>
              {register ? '创建账号与组织' : '登录工作台'} <ArrowRight size={17} />
            </Submit>
          </form>
          <p className="auth-switch">
            {register ? '已经有账号？' : '还没有工作空间？'}{' '}
            <Link to={register ? '/login' : '/register'}>{register ? '去登录' : '立即注册'}</Link>
          </p>
          <p className="privacy-hint">
            继续使用即表示你已阅读<Link to="/privacy">隐私说明</Link>。
          </p>
        </div>
      </main>
    </div>
  );
}

function OrganizationEmpty() {
  return (
    <Empty
      title="先给你的团队一个空间"
      action={
        <Link className="btn primary" to="/app/settings">
          <Plus size={17} />
          创建或加入组织
        </Link>
      }
    >
      一个组织连接活动、成员与数据。你可以创建新组织，也可以凭邀请加入已有团队。
    </Empty>
  );
}
export function Dashboard({
  list = false,
  analytics = false,
}: {
  list?: boolean;
  analytics?: boolean;
}) {
  const { session, org } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const query = useQuery({
    queryKey: ['activities', org?.id],
    queryFn: () => api<Activity[]>(`/organizations/${org!.id}/activities`),
    enabled: !!org,
  });
  const activities = query.data || [];
  const registered = activities.reduce((n, a) => n + Number(a.registration_count), 0);
  const checked = activities.reduce((n, a) => n + Number(a.checkin_count), 0);
  const visible = activities.filter(
    (a) =>
      a.title.toLowerCase().includes(search.toLowerCase()) &&
      (status === 'all' || a.status === status),
  );
  const canManage = org?.role === 'Owner' || org?.role === 'Admin';
  if (!org) return <OrganizationEmpty />;
  return (
    <>
      <PageHead
        eyebrow={analytics ? 'EVENT INTELLIGENCE' : list ? 'YOUR EVENTS' : 'YOUR CAMPUS, CONNECTED'}
        title={
          analytics
            ? '每一次参与，都有迹可循。'
            : list
              ? '我的活动'
              : `你好，${session?.user.display_name}。`
        }
        actions={
          canManage && (
            <Link className="btn primary" to="/app/events/new">
              <Plus size={18} />
              创建活动
            </Link>
          )
        }
      >
        {analytics
          ? '指标来源于真实活动记录。选择活动查看趋势与出席表现。'
          : list
            ? '从第一份草稿，到最后一份复盘。'
            : '把想法向前推进一点，让下一场相聚更值得期待。'}
      </PageHead>
      {!list && (
        <div className="stats-grid">
          <Stat
            label="全部活动"
            value={activities.length}
            detail="当前组织内可访问的活动"
            icon={<CalendarDays size={20} />}
          />
          <Stat
            label="正在报名"
            value={activities.filter((a) => a.status === 'Published').length}
            detail="已发布并开放报名的活动"
            icon={<span className="live-dot" />}
          />
          <Stat
            label="累计报名"
            value={registered}
            detail={`已签到 ${checked} 人次`}
            icon={<Users size={20} />}
          />
          <Stat
            label="整体签到率"
            value={`${registered ? ((checked / registered) * 100).toFixed(1) : '0'}%`}
            detail="有效签到 / 有效报名"
            icon={<CheckCircle2 size={20} />}
          />
        </div>
      )}
      {!list && !analytics && canManage && (
        <section className="planner-banner">
          <div className="planner-spark">
            <Sparkles size={28} />
          </div>
          <div>
            <span className="eyebrow">CAMPUSFLOW AI PLANNER</span>
            <h2>下一场活动，还只有一个想法？</h2>
            <p>说说你想做什么，一起梳理流程、分工与执行清单。</p>
          </div>
          <Link to="/app/planner" className="btn secondary">
            开始策划 <ArrowRight size={17} />
          </Link>
          <span className="banner-decoration" aria-hidden="true">
            ✳
          </span>
        </section>
      )}
      <section className="events-section">
        <div className="section-heading">
          <div>
            <h2>
              {analytics ? '选择活动查看数据' : list ? '活动列表' : '活动一览'}{' '}
              <span className="count">{activities.length}</span>
            </h2>
            <p className="muted">所有时间均为北京时间</p>
          </div>
          <div className="filters">
            <label className="search">
              <Search size={17} />
              <input
                aria-label="搜索活动"
                placeholder="搜索活动名称"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="活动状态筛选"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">全部状态</option>
              {activityStatuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : !visible.length ? (
          <Empty
            title={activities.length ? '没有匹配的活动' : '第一场好活动，从这里开始'}
            action={
              canManage &&
              !activities.length && (
                <Link to="/app/events/new" className="btn primary">
                  <Plus size={17} />
                  创建第一场活动
                </Link>
              )
            }
          >
            {activities.length
              ? '换个名称或状态再试试。'
              : '创建活动后，你可以发布报名、管理签到，并看到真实的数据表现。'}
          </Empty>
        ) : (
          <div className="event-list">
            {visible.map((a, i) => (
              <Link
                className="event-row"
                key={a.id}
                to={`/app/events/${a.id}${analytics ? '?tab=analytics' : ''}`}
              >
                <div className={`event-cover tone-${i % 4}`}>
                  {a.cover_image ? <img src={a.cover_image} alt="" /> : <CalendarDays size={26} />}
                </div>
                <div className="event-row-main">
                  <div className="event-title-line">
                    <h3>{a.title}</h3>
                    <span className={`status status-${a.status}`}>{statusLabels[a.status]}</span>
                  </div>
                  <div className="event-meta">
                    <span>
                      <CalendarDays size={13} />
                      {dateTime(a.start_time)}
                    </span>
                    <span>
                      <MapPin size={13} />
                      {a.location}
                    </span>
                  </div>
                </div>
                <div className="event-row-stat">
                  <strong>
                    {a.registration_count}
                    <small> / {a.capacity}</small>
                  </strong>
                  <span>已报名</span>
                  <div className="mini-progress">
                    <span
                      style={{
                        width: `${Math.min(100, (Number(a.registration_count) / a.capacity) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <ArrowUpRight size={20} className="muted" />
              </Link>
            ))}
          </div>
        )}
      </section>
      {!list && !analytics && (
        <div className="dashboard-note">
          <CircleHelp size={17} />
          <span>从活动详情页分享报名链接，参与者无需注册管理账号。</span>
          <Link to="/privacy">
            了解数据管理 <ChevronRight size={14} />
          </Link>
        </div>
      )}
    </>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function Planner() {
  const { org } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<PlanResult | null>(null);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saved = useQuery({
    queryKey: ['plans', org?.id],
    queryFn: () => api<PlanResult[]>(`/organizations/${org!.id}/ai/plans`),
    enabled: !!org && ['Owner', 'Admin'].includes(org.role),
  });
  if (!org) return <OrganizationEmpty />;
  if (!['Owner', 'Admin'].includes(org.role))
    return <Empty title="仅活动管理者可生成策划方案">请联系组织 Owner 或 Admin。</Empty>;
  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      const data = await send<PlanResult>(`/organizations/${org.id}/ai/plan`, { prompt });
      setResult(data);
      await client.invalidateQueries({ queryKey: ['plans'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  const update = (patch: Partial<Plan>) =>
    setResult((r) => (r ? { ...r, plan: { ...r.plan, ...patch } } : r));
  const save = async (create = false) => {
    if (!result) return;
    setSaving(true);
    try {
      const plan = planSchema.parse(result.plan);
      await send(`/organizations/${org.id}/ai/plans/${result.id}`, { plan }, 'PUT');
      toast('策划草稿已保存');
      await client.invalidateQueries({ queryKey: ['plans'] });
      if (create) navigate('/app/events/new', { state: { plan } });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHead eyebrow="CAMPUSFLOW AI PLANNER" title="好活动，始于一个好想法。">
        从需求到执行，和你的策划助手一起推敲。所有方案都需要你确认。
      </PageHead>
      <div className="planner-layout">
        <section className="panel planner-input">
          <div className="panel-title">
            <Sparkles size={20} />
            <h2>你想举办什么活动？</h2>
          </div>
          <form onSubmit={generate}>
            <Field
              label="活动需求"
              hint="建议包含主题、目标人群、人数、时长和目标。未知信息可以留待确认。"
            >
              <textarea
                rows={8}
                required
                minLength={5}
                maxLength={4000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例如：准备办一场面向 80 名同学的 AIGC 创作交流会，时长 90 分钟，希望大家能动手创作并分享作品。"
              />
            </Field>
            <div className="prompt-count">{prompt.length} / 4000</div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Submit pending={pending}>
              生成策划方案 <WandSparkles size={17} />
            </Submit>
          </form>
          <div className="planner-stages">
            <p className="eyebrow">方案包含</p>
            {[
              '梳理需求与活动目标',
              '规划流程与宣传文案',
              '分工、物料和执行清单',
              '检查风险与待确认信息',
            ].map((s, i) => (
              <p key={s}>
                <span>0{i + 1}</span>
                {s}
              </p>
            ))}
          </div>
          {saved.data && saved.data.length > 0 && (
            <div className="saved-plans">
              <h3>最近的草稿</h3>
              {saved.data.slice(0, 6).map((p) => (
                <button key={p.id} onClick={() => setResult(p)}>
                  {p.plan.event_title}
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="panel plan-output">
          {pending ? (
            <Loading label="正在梳理活动方案" />
          ) : !result ? (
            <Empty title="给你的灵感一点结构">
              左侧描述活动需求，生成可编辑的策划草稿。发布始终由你决定。
            </Empty>
          ) : (
            <>
              <div className="section-heading">
                <h2>活动方案</h2>
                <span className={`pill ${result.mode === 'mock' ? 'warning-pill' : ''}`}>
                  {result.mode === 'mock' ? '本地模板 · 非真实 AI 输出' : 'AI 模型生成 · 请审核'}
                </span>
              </div>
              {result.warning && <p className="notice">{result.warning}</p>}
              <Field label="活动名称">
                <input
                  value={result.plan.event_title}
                  onChange={(e) => update({ event_title: e.target.value })}
                />
              </Field>
              <Field label="活动简介">
                <textarea
                  rows={3}
                  value={result.plan.event_summary}
                  onChange={(e) => update({ event_summary: e.target.value })}
                />
              </Field>
              <Field label="目标参与人群">
                <input
                  value={result.plan.target_audience}
                  onChange={(e) => update({ target_audience: e.target.value })}
                />
              </Field>
              <StringList
                label="活动目标"
                value={result.plan.objectives}
                onChange={(objectives) => update({ objectives })}
              />
              <h3 className="form-section-title">活动流程</h3>
              {result.plan.agenda.map((item, index) => (
                <div className="agenda-edit" key={index}>
                  <input
                    aria-label={`流程 ${index + 1} 时间`}
                    value={item.time}
                    onChange={(e) =>
                      update({
                        agenda: result.plan.agenda.map((a, i) =>
                          i === index ? { ...a, time: e.target.value } : a,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`流程 ${index + 1} 标题`}
                    value={item.title}
                    onChange={(e) =>
                      update({
                        agenda: result.plan.agenda.map((a, i) =>
                          i === index ? { ...a, title: e.target.value } : a,
                        ),
                      })
                    }
                  />
                  <textarea
                    aria-label={`流程 ${index + 1} 说明`}
                    value={item.description}
                    onChange={(e) =>
                      update({
                        agenda: result.plan.agenda.map((a, i) =>
                          i === index ? { ...a, description: e.target.value } : a,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <h3 className="form-section-title">人员分工</h3>
              {result.plan.staff_roles.map((item, index) => (
                <div className="inline-field" key={index}>
                  <input
                    aria-label={`岗位 ${index + 1}`}
                    value={item.role}
                    onChange={(e) =>
                      update({
                        staff_roles: result.plan.staff_roles.map((a, i) =>
                          i === index ? { ...a, role: e.target.value } : a,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`岗位 ${index + 1} 职责`}
                    value={item.responsibilities}
                    onChange={(e) =>
                      update({
                        staff_roles: result.plan.staff_roles.map((a, i) =>
                          i === index ? { ...a, responsibilities: e.target.value } : a,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <StringList
                label="物料清单"
                value={result.plan.materials}
                onChange={(materials) => update({ materials })}
              />
              <StringList
                label="执行清单"
                value={result.plan.checklist}
                onChange={(checklist) => update({ checklist })}
              />
              {(['short', 'long', 'social'] as const).map((key, i) => (
                <Field key={key} label={['简短宣传文案', '完整宣传文案', '社交平台文案'][i]}>
                  <textarea
                    rows={key === 'long' ? 5 : 3}
                    value={result.plan.promotion_copy[key]}
                    onChange={(e) =>
                      update({
                        promotion_copy: { ...result.plan.promotion_copy, [key]: e.target.value },
                      })
                    }
                  />
                </Field>
              ))}
              <StringList
                label="风险提醒"
                value={result.plan.risks}
                onChange={(risks) => update({ risks })}
              />
              <StringList
                label="方案假设"
                value={result.plan.assumptions}
                onChange={(assumptions) => update({ assumptions })}
              />
              <StringList
                label="待确认信息"
                value={result.plan.missing_information}
                onChange={(missing_information) => update({ missing_information })}
              />
              <div className="sticky-actions">
                <button className="btn secondary" disabled={saving} onClick={() => void save()}>
                  保存草稿
                </button>
                <button className="btn primary" disabled={saving} onClick={() => void save(true)}>
                  确认方案，创建活动 <ArrowRight size={17} />
                </button>
              </div>
              <p className="privacy-hint">
                下一步补充真实时间和地点。创建后仍为草稿，不会自动公开发布。
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
function StringList({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Field label={label} hint="每行一项">
      <textarea
        rows={Math.min(6, Math.max(2, value.length))}
        value={value.join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n'))}
      />
    </Field>
  );
}

interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
}
export function SettingsPage() {
  const { session, org, refresh, selectOrg } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [pending, setPending] = useState('');
  const [invite, setInvite] = useState('');
  const canManage = org?.role === 'Owner' || org?.role === 'Admin';
  const members = useQuery({
    queryKey: ['members', org?.id],
    queryFn: () => api<Member[]>(`/organizations/${org!.id}/members`),
    enabled: !!org && canManage,
  });
  const action = async (name: string, task: () => Promise<void>) => {
    setPending(name);
    try {
      await task();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setPending('');
    }
  };
  return (
    <>
      <PageHead eyebrow="YOUR TEAM" title="一起，让好事发生。">
        管理组织、团队成员和你的个人资料。
      </PageHead>
      <div className="settings-grid">
        <section className="panel">
          <h2>个人资料</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action('profile', async () => {
                await send('/auth/profile', { display_name: f.get('display_name') }, 'PATCH');
                await refresh();
                toast('资料已更新');
              });
            }}
          >
            <Field label="你的称呼">
              <input
                name="display_name"
                defaultValue={session?.user.display_name}
                maxLength={80}
                required
              />
            </Field>
            <Field label="登录邮箱">
              <input value={session?.user.email || ''} readOnly />
            </Field>
            <Submit pending={pending === 'profile'}>保存资料</Submit>
          </form>
        </section>
        <section className="panel">
          <h2>创建组织</h2>
          <p className="muted">为不同团队建立独立的活动与数据空间。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action('org', async () => {
                const o = await send<{ id: string }>('/organizations', { name: f.get('name') });
                await refresh();
                selectOrg(o.id);
                toast('组织已创建');
              });
            }}
          >
            <Field label="新组织名称">
              <input
                name="name"
                minLength={2}
                maxLength={100}
                required
                placeholder="例如：校园创意工坊"
              />
            </Field>
            <Submit pending={pending === 'org'}>创建组织</Submit>
          </form>
        </section>
        <section className="panel">
          <h2>接受团队邀请</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action('join', async () => {
                await send('/organizations/join', { token: f.get('token') });
                await refresh();
                toast('已加入组织');
              });
            }}
          >
            <Field label="邀请凭证" hint="使用受邀邮箱登录，并粘贴组织管理员提供的凭证。">
              <input name="token" required placeholder="粘贴邀请凭证" />
            </Field>
            <Submit pending={pending === 'join'}>加入组织</Submit>
          </form>
        </section>
        {canManage && (
          <section className="panel">
            <h2>邀请新成员</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action('invite', async () => {
                  const result = await send<{ token: string }>(
                    `/organizations/${org!.id}/members`,
                    { email: f.get('email'), role: f.get('role') },
                  );
                  setInvite(result.token);
                  toast('邀请已创建，请将凭证分享给该成员');
                });
              }}
            >
              <Field label="成员邮箱">
                <input name="email" type="email" required />
              </Field>
              <Field label="角色">
                <select name="role" defaultValue="Staff">
                  {roles
                    .filter((r) => r !== 'Owner')
                    .map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                </select>
              </Field>
              <Submit pending={pending === 'invite'}>生成邀请</Submit>
            </form>
            {invite && (
              <div className="invite-output">
                <p>邀请凭证（请私下分享给受邀人）</p>
                <textarea readOnly aria-label="邀请凭证" value={invite} />
                <button
                  className="btn secondary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(invite)
                      .then(() => toast('邀请凭证已复制'))
                      .catch(() => toast('请手动复制凭证', true))
                  }
                >
                  复制邀请凭证
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      {canManage && (
        <section className="panel members-panel">
          <div className="section-heading">
            <h2>{org?.name} · 团队成员</h2>
            <span className="pill">{org?.role}</span>
          </div>
          <p className="muted">
            Admin 管理活动与成员，Staff 执行指定活动签到，Viewer
            查看授权统计。工作人员需在活动详情中分配。
          </p>
          {members.isPending ? (
            <Loading />
          ) : members.error ? (
            <ErrorState error={members.error} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>邮箱</th>
                    <th>角色</th>
                    <th>管理</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data?.map((m) => (
                    <tr key={m.user_id}>
                      <td>{m.display_name}</td>
                      <td>{m.email}</td>
                      <td>
                        {m.role === 'Owner' || m.user_id === session?.user.id ? (
                          m.role
                        ) : (
                          <select
                            aria-label={`${m.display_name} 的角色`}
                            value={m.role}
                            onChange={(e) =>
                              void action('member', async () => {
                                await send(
                                  `/organizations/${org!.id}/members/${m.user_id}`,
                                  { role: e.target.value },
                                  'PATCH',
                                );
                                await client.invalidateQueries({ queryKey: ['members'] });
                                toast('角色已更新');
                              })
                            }
                          >
                            {roles
                              .filter((r) => r !== 'Owner')
                              .map((r) => (
                                <option key={r}>{r}</option>
                              ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {m.role !== 'Owner' && m.user_id !== session?.user.id && (
                          <button
                            className="text-btn danger"
                            onClick={() => {
                              if (window.confirm(`确认将 ${m.display_name} 移出组织？`))
                                void action('member', async () => {
                                  await api(`/organizations/${org!.id}/members/${m.user_id}`, {
                                    method: 'DELETE',
                                  });
                                  await client.invalidateQueries({ queryKey: ['members'] });
                                  toast('成员已移除');
                                });
                            }}
                          >
                            移除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
export function Privacy() {
  return (
    <div className="public-page">
      <header className="public-header">
        <Brand />
        <Link to="/">返回首页</Link>
      </header>
      <main className="prose">
        <p className="eyebrow">PRIVACY & TRUST</p>
        <h1>隐私与数据说明</h1>
        <p>
          CampusFlow
          帮助活动组织者管理报名、签到和活动反馈。活动报名信息由对应组织管理，管理端通过角色和活动权限限制访问。
        </p>
        <h2>我们收集哪些信息</h2>
        <p>
          管理账号需要邮箱与称呼。本地模式的密码经安全摘要处理。报名默认只需要参与者称呼，并可按活动需要填写组织者设置的字段。签到凭证不包含个人信息。
        </p>
        <h2>为什么使用这些信息</h2>
        <p>
          报名数据用于核对活动名额、生成签到凭证和统计出席情况。问卷用于活动改进。AI
          复盘只读取活动汇总数据和必要的反馈信息；请勿在自由文本中提交身份证、住址或无关敏感信息。
        </p>
        <h2>数据存储与保留</h2>
        <p>
          本地开发环境将数据持久化在运行应用的设备上。部署 CloudBase
          后，数据保存在部署者配置的腾讯云数据库。当前版本不会自动设置保留期限；活动组织者应在公开活动前明确告知参与者具体保留时长，并按约定删除数据。
        </p>
        <h2>更正与删除</h2>
        <p>
          需要更正或删除报名信息，请联系活动负责人，提供报名凭证或参与者称呼。组织管理员可删除报名记录。凭证属于私密信息，请勿公开分享。
        </p>
        <h2>你可以选择什么</h2>
        <p>
          参与者无需创建管理账号。选填内容可以不填写。摄像头权限只用于工作人员扫码签到，拒绝后仍可手动输入签到凭证。
        </p>
        <h2>发布前的责任</h2>
        <p>
          部署者需提供真实的组织联系方式、适用的保留期限与隐私告知，并确保有权收集活动所需信息。试点组织名称不代表已获得授权。
        </p>
        <Link to="/" className="btn secondary">
          返回首页
        </Link>
      </main>
    </div>
  );
}
export function NotFound() {
  return (
    <div className="not-found">
      <Brand />
      <Empty
        title="这个页面还没有发生"
        action={
          <Link to="/" className="btn primary">
            返回首页
          </Link>
        }
      >
        页面可能已移动，或者链接有误。
      </Empty>
    </div>
  );
}
