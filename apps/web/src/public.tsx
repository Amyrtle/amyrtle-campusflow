import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  MapPin,
  ShieldCheck,
  Ticket as TicketIcon,
  Users,
} from 'lucide-react';
import { statusLabels, type Activity, type Survey, type Ticket } from '@campusflow/shared';
import { api, dateTime, send } from './api';
import { Brand, Empty, ErrorState, Field, Loading, Submit, useToast } from './ui';

function PublicHeader() {
  return (
    <header className="public-header">
      <Brand />
      <Link to="/login">
        组织者入口 <ArrowRight size={15} />
      </Link>
    </header>
  );
}
function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>由 Amyrtle CampusFlow 提供支持</span>
      <Link to="/privacy">隐私说明</Link>
    </footer>
  );
}
export function PublicEvent() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const query = useQuery({
    queryKey: ['public-event', slug],
    queryFn: () => api<Activity>(`/public/events/${slug}`),
    refetchInterval: 30000,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(() => {
    const name = `campusflow-register-${slug}`;
    const saved = sessionStorage.getItem(name);
    if (saved) return saved;
    const created = crypto.randomUUID();
    sessionStorage.setItem(name, created);
    return created;
  });
  if (query.isPending)
    return (
      <div className="public-page">
        <PublicHeader />
        <Loading />
      </div>
    );
  if (query.error || !query.data)
    return (
      <div className="public-page">
        <PublicHeader />
        <ErrorState error={query.error} retry={() => void query.refetch()} />
        <PublicFooter />
      </div>
    );
  const a = query.data;
  const remaining = Math.max(0, a.capacity - Number(a.registration_count));
  const now = Date.now();
  const open =
    a.status === 'Published' &&
    remaining > 0 &&
    now >= Date.parse(a.registration_start) &&
    now <= Date.parse(a.registration_deadline);
  const closedReason =
    a.status === 'Cancelled'
      ? '活动已取消'
      : remaining <= 0
        ? '活动名额已满'
        : now < Date.parse(a.registration_start)
          ? '报名尚未开放'
          : now > Date.parse(a.registration_deadline)
            ? '报名已截止'
            : '当前未开放报名';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const answers = Object.fromEntries(
        a.form_fields.map((field) => [field.id, String(f.get(field.id) || '')]),
      );
      const ticket = await send<Ticket>(`/public/events/${slug}/register`, {
        display_name: f.get('display_name'),
        answers,
        consent: f.get('consent') === 'on',
        idempotency_key: key,
      });
      sessionStorage.setItem(`campusflow-ticket-${ticket.registration_id}`, JSON.stringify(ticket));
      toast('报名成功，请保存你的签到凭证');
      navigate(`/tickets/${ticket.registration_id}`, { state: { ticket } });
    } catch (e) {
      setError((e as Error).message);
      void query.refetch();
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-event">
        <div className="public-event-main">
          <div className="public-event-art">
            {a.cover_image ? (
              <img src={a.cover_image} alt={a.title} />
            ) : (
              <>
                <div className="art-rings" />
                <p>AMYRTLE CAMPUSFLOW</p>
                <h2>一起，让好事发生。</h2>
                <span className="art-star">✳</span>
                <small>MEET · CREATE · CONNECT</small>
              </>
            )}
          </div>
          <div className="public-event-heading">
            <span className="pill">{a.category}</span>
            <span className={`status status-${a.status}`}>{statusLabels[a.status]}</span>
            <h1>{a.title}</h1>
          </div>
          <div className="public-facts">
            <div>
              <CalendarDays size={21} />
              <span>
                <small>活动时间（北京时间）</small>
                <strong>
                  {dateTime(a.start_time)} — {dateTime(a.end_time)}
                </strong>
              </span>
            </div>
            <div>
              <MapPin size={21} />
              <span>
                <small>我们在这里相见</small>
                <strong>{a.location}</strong>
              </span>
            </div>
            <div>
              <Users size={21} />
              <span>
                <small>参与名额</small>
                <strong>
                  {a.capacity} 人 · 剩余 {remaining} 席
                </strong>
              </span>
            </div>
          </div>
          <section className="public-description">
            <h2>关于这场活动</h2>
            <p className="preserve-lines">{a.description || '更多活动安排请关注组织者通知。'}</p>
          </section>
        </div>
        <aside className="signup-panel">
          <div className="signup-intro">
            <span className="eyebrow">BE PART OF IT</span>
            <h2>留一个位置给你。</h2>
            <p>无需注册账号，填写信息即可参与。</p>
          </div>
          {open ? (
            <form onSubmit={submit}>
              <Field label="参与者称呼">
                <input
                  name="display_name"
                  required
                  maxLength={80}
                  autoComplete="nickname"
                  placeholder="我们怎么称呼你"
                />
              </Field>
              {a.form_fields.map((field) => (
                <Field key={field.id} label={`${field.label}${field.required ? ' *' : '（选填）'}`}>
                  {field.type === 'select' ? (
                    <select name={field.id} required={field.required} defaultValue="">
                      <option value="">请选择</option>
                      {field.options?.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input name={field.id} required={field.required} maxLength={1000} />
                  )}
                </Field>
              ))}
              <label className="checkbox consent">
                <input name="consent" type="checkbox" required />
                <span>
                  我已阅读
                  <Link to="/privacy" target="_blank">
                    隐私说明
                  </Link>
                  ，同意活动组织者为报名与签到使用以上信息。
                </span>
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Submit pending={pending}>
                确认报名 <ArrowRight size={17} />
              </Submit>
            </form>
          ) : (
            <div className="registration-closed">
              <CalendarDays size={30} />
              <h3>{closedReason}</h3>
              <p>
                {a.status === 'Cancelled'
                  ? '如有疑问，请联系活动组织者。'
                  : `报名时间：${dateTime(a.registration_start)} 至 ${dateTime(a.registration_deadline)}`}
              </p>
            </div>
          )}
          <p className="signup-deadline">报名截止：{dateTime(a.registration_deadline)}</p>
          <div className="secure-note">
            <ShieldCheck size={16} />
            <span>报名信息仅供活动运营使用</span>
          </div>
        </aside>
      </main>
      <PublicFooter />
    </div>
  );
}
export function TicketPage() {
  const { id } = useParams();
  const toast = useToast();
  const [qr, setQr] = useState('');
  const [ticket] = useState<Ticket | null>(() => {
    try {
      const value = sessionStorage.getItem(`campusflow-ticket-${id}`);
      return value ? (JSON.parse(value) as Ticket) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (ticket)
      void QRCode.toDataURL(ticket.token, {
        width: 400,
        margin: 2,
        color: { dark: '#151c3a', light: '#ffffff' },
      })
        .then(setQr)
        .catch(() => toast('二维码生成失败，请使用下方签到码', true));
  }, [ticket, toast]);
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="ticket-page">
        {!ticket ? (
          <Empty title="此设备上没有找到签到凭证">
            请使用报名时保存的二维码或签到码。凭证保存在报名时的浏览器会话中，清理会话后无法在此恢复；如未保存，请联系组织者。
          </Empty>
        ) : (
          <>
            <div className="success-heading">
              <span>
                <CheckCircle2 size={29} />
              </span>
              <p className="eyebrow">YOU’RE ON THE LIST</p>
              <h1>报名成功，期待相见。</h1>
              <p>请立即保存二维码或完整签到码，活动当天向工作人员出示。</p>
            </div>
            <section className="ticket-card">
              <div className="ticket-top">
                <span className="pill">
                  <TicketIcon size={14} /> 电子签到凭证
                </span>
                <h2>{ticket.title}</h2>
                <p>{ticket.display_name}，这个位置属于你。</p>
              </div>
              <div className="ticket-qr">
                {qr ? (
                  <img src={qr} alt="个人签到二维码" width={240} height={240} />
                ) : (
                  <Loading label="正在生成二维码" />
                )}
                <span>签到时请出示此码</span>
              </div>
              <div className="ticket-facts">
                <p>
                  <CalendarDays size={17} />
                  {dateTime(ticket.start_time)}
                </p>
                <p>
                  <MapPin size={17} />
                  {ticket.location}
                </p>
              </div>
              <div className="ticket-actions">
                {qr && (
                  <a
                    className="btn primary"
                    href={qr}
                    download={`CampusFlow-${ticket.registration_id}.png`}
                  >
                    <Download size={17} />
                    保存二维码
                  </a>
                )}
                <button
                  className="btn secondary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(ticket.token)
                      .then(() => toast('签到码已复制'))
                      .catch(() => toast('请从下方手动复制签到码', true))
                  }
                >
                  <ClipboardCopy size={17} />
                  复制签到码
                </button>
              </div>
              <details>
                <summary>查看完整签到码</summary>
                <textarea aria-label="完整签到码" readOnly rows={4} value={ticket.token} />
              </details>
            </section>
            <p className="ticket-warning">
              <ShieldCheck size={16} />
              这张凭证代表你的报名身份，请妥善保存，勿公开分享。清理浏览器会话会移除本页凭证。
            </p>
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
export function PublicSurvey() {
  const { id } = useParams();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['public-survey', id],
    queryFn: () => api<Survey>(`/public/surveys/${id}`),
  });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!query.data) return;
    setPending(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const answers: Record<string, unknown> = {};
      for (const q of query.data.questions) {
        const value =
          q.type === 'multiple'
            ? f.getAll(q.id).map(String)
            : q.type === 'rating' && f.get(q.id)
              ? Number(f.get(q.id))
              : String(f.get(q.id) || '');
        if (q.required && (value === '' || (Array.isArray(value) && !value.length)))
          throw new Error(`请回答：${q.title}`);
        answers[q.id] = value;
      }
      await send(`/public/surveys/${id}/responses`, {
        token: String(f.get('token')).trim(),
        answers,
      });
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="survey-page">
        {query.isPending ? (
          <Loading />
        ) : query.error || !query.data ? (
          <ErrorState error={query.error} />
        ) : success ? (
          <div className="survey-success">
            <CheckCircle2 size={48} />
            <h1>谢谢你的真诚反馈。</h1>
            <p>每一条建议，都让下一次相聚更好一点。</p>
            <Link className="btn secondary" to="/">
              了解 CampusFlow
            </Link>
          </div>
        ) : (
          <>
            <p className="eyebrow">EVERY VOICE MATTERS</p>
            <h1>{query.data.title}</h1>
            <p className="muted">
              无需填写真实姓名。使用报名签到码验证参与资格，每张凭证仅可提交一次。
            </p>
            <form className="panel" onSubmit={submit}>
              <Field label="报名签到码" hint="粘贴报名成功时保存的完整签到码，用于防止重复提交。">
                <textarea name="token" required rows={3} placeholder="你的完整签到码" />
              </Field>
              {query.data.questions.map((q, i) => (
                <fieldset className="survey-question" key={q.id}>
                  <legend>
                    {i + 1}. {q.title}
                    {q.required && <span> *</span>}
                  </legend>
                  {q.type === 'text' ? (
                    <textarea
                      name={q.id}
                      aria-label={q.title}
                      required={q.required}
                      maxLength={2000}
                      rows={3}
                    />
                  ) : q.type === 'rating' ? (
                    <>
                      <div className="rating-options">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label key={n}>
                            <input type="radio" name={q.id} value={n} required={q.required} />
                            <span>{n}</span>
                          </label>
                        ))}
                      </div>
                      <div className="rating-labels">
                        <span>不太满意</span>
                        <span>非常满意</span>
                      </div>
                    </>
                  ) : (
                    <div className="survey-options">
                      {q.options?.map((option) => (
                        <label key={option} className="checkbox">
                          <input
                            type={q.type === 'multiple' ? 'checkbox' : 'radio'}
                            name={q.id}
                            value={option}
                            required={q.type === 'single' && q.required}
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              ))}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Submit pending={pending}>
                提交反馈 <Check size={17} />
              </Submit>
            </form>
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
