import { z } from 'zod';

export const roles = ['Owner', 'Admin', 'Staff', 'Viewer'] as const;
export type Role = (typeof roles)[number];
export const activityStatuses = [
  'Draft',
  'Published',
  'RegistrationClosed',
  'InProgress',
  'Completed',
  'Archived',
  'Cancelled',
] as const;
export type ActivityStatus = (typeof activityStatuses)[number];
export const statusLabels: Record<ActivityStatus, string> = {
  Draft: '草稿',
  Published: '报名中',
  RegistrationClosed: '报名结束',
  InProgress: '进行中',
  Completed: '已结束',
  Archived: '已归档',
  Cancelled: '已取消',
};
export const transitions: Record<ActivityStatus, readonly ActivityStatus[]> = {
  Draft: ['Published', 'Cancelled'],
  Published: ['RegistrationClosed', 'InProgress', 'Cancelled'],
  RegistrationClosed: ['Published', 'InProgress', 'Cancelled'],
  InProgress: ['Completed', 'Cancelled'],
  Completed: ['Archived'],
  Cancelled: ['Archived'],
  Archived: [],
};
export const fieldSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(60)
      .refine(
        (id) => !['display_name', 'consent', 'token', 'idempotency_key'].includes(id),
        '字段标识与系统字段冲突',
      ),
    label: z.string().trim().min(1).max(80),
    type: z.enum(['text', 'select']),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  })
  .superRefine((field, context) => {
    if (
      field.type === 'select' &&
      (!field.options ||
        field.options.length < 2 ||
        new Set(field.options).size !== field.options.length)
    )
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '单选题至少需要两个不重复的选项',
      });
  });
export const activityInputSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(12000).default(''),
    category: z.string().trim().max(60).default('校园活动'),
    location: z.string().trim().max(200).default('待确认'),
    start_time: z.string().datetime({ offset: true }),
    end_time: z.string().datetime({ offset: true }),
    registration_start: z.string().datetime({ offset: true }),
    registration_deadline: z.string().datetime({ offset: true }),
    capacity: z.number().int().min(1).max(10000),
    cover_image: z.string().url().max(2000).or(z.literal('')).default(''),
    form_fields: z.array(fieldSchema).max(15).default([]),
  })
  .superRefine((v, c) => {
    if (Date.parse(v.end_time) <= Date.parse(v.start_time))
      c.addIssue({ code: 'custom', path: ['end_time'], message: '结束时间必须晚于开始时间' });
    if (Date.parse(v.registration_deadline) < Date.parse(v.registration_start))
      c.addIssue({
        code: 'custom',
        path: ['registration_deadline'],
        message: '报名截止时间不能早于开放时间',
      });
    if (Date.parse(v.registration_deadline) > Date.parse(v.end_time))
      c.addIssue({
        code: 'custom',
        path: ['registration_deadline'],
        message: '报名不能晚于活动结束',
      });
    if (new Set(v.form_fields.map((f) => f.id)).size !== v.form_fields.length)
      c.addIssue({ code: 'custom', path: ['form_fields'], message: '字段标识不可重复' });
  });
export type ActivityInput = z.infer<typeof activityInputSchema>;
export type FormField = z.infer<typeof fieldSchema>;
export interface Activity extends ActivityInput {
  id: string;
  organization_id: string;
  slug: string;
  status: ActivityStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  registration_count: number;
  checkin_count: number;
}
export interface User {
  id: string;
  email: string;
  display_name: string;
}
export interface Organization {
  id: string;
  name: string;
  role: Role;
}
export interface Session {
  user: User;
  organizations: Organization[];
  mode: 'local' | 'cloudbase';
}
export const authSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(128),
  display_name: z.string().trim().min(1).max(80).optional(),
  organization_name: z.string().trim().min(2).max(100).optional(),
});
export const registrationSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  answers: z.record(z.string(), z.string().max(1000)).default({}),
  consent: z.literal(true),
  idempotency_key: z.string().uuid(),
});
export interface Registration {
  id: string;
  activity_id: string;
  display_name: string;
  answers: Record<string, string>;
  created_at: string;
  checked_in_at: string | null;
}
export interface Ticket {
  registration_id: string;
  activity_id: string;
  token: string;
  display_name: string;
  title: string;
  start_time: string;
  location: string;
}
export const planSchema = z.object({
  event_title: z.string().min(1).max(120),
  event_summary: z.string().max(4000),
  target_audience: z.string().max(1000),
  objectives: z.array(z.string().max(1000)).max(20),
  agenda: z
    .array(
      z.object({
        time: z.string().max(60),
        title: z.string().max(200),
        description: z.string().max(1000),
      }),
    )
    .max(30),
  staff_roles: z
    .array(z.object({ role: z.string().max(100), responsibilities: z.string().max(1000) }))
    .max(20),
  materials: z.array(z.string().max(500)).max(40),
  promotion_copy: z.object({
    short: z.string().max(1000),
    long: z.string().max(5000),
    social: z.string().max(2000),
  }),
  risks: z.array(z.string().max(1000)).max(20),
  checklist: z.array(z.string().max(1000)).max(40),
  suggested_form_fields: z.array(fieldSchema).max(15),
  assumptions: z.array(z.string().max(1000)).max(20),
  missing_information: z.array(z.string().max(1000)).max(20),
});
export type Plan = z.infer<typeof planSchema>;
export interface PlanResult {
  id: string;
  mode: 'mock' | 'live';
  plan: Plan;
  warning?: string;
}
export interface Analytics {
  registration_count: number;
  checkin_count: number;
  absent_count: number;
  remaining: number;
  checkin_rate: number;
  registration_trend: { date: string; count: number }[];
  checkin_trend: { date: string; count: number }[];
}
export const surveyQuestionSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  type: z.enum(['single', 'multiple', 'rating', 'text']),
  required: z.boolean(),
  options: z.array(z.string().max(100)).max(20).optional(),
});
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;
export interface Survey {
  id: string;
  activity_id: string;
  title: string;
  questions: SurveyQuestion[];
  response_count?: number;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
export function formulaSafe(value: unknown): string {
  const s = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
}
