import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

const AR: Record<string, string> = {
  INSUFFICIENT_STOCK: 'الكمية المتاحة لا تكفي',
  CREDIT_LIMIT_EXCEEDED: 'تجاوز سقف الائتمان للعميل، يلزم موافقة المدير',
  PERMISSION_DENIED: 'لا تملك الصلاحية لهذا الإجراء',
  NOT_FOUND: 'العنصر غير موجود',
  SHIFT_CLOSED: 'الوردية مغلقة',
  SHIFT_INVALID: 'بيانات الوردية غير صحيحة',
  SHIFT_HAS_PENDING_INVOICES: 'توجد إيصالات معلّقة (تعارض مزامنة) تمنع إغلاق الوردية',
  SHIFT_HAS_DRAFT_VOUCHERS: 'توجد سندات غير مرحّلة تمنع إغلاق الوردية',
  PAYMENT_INVALID: 'طريقة الدفع غير صالحة',
  OFFLINE_INVALID: 'بيانات الإيصال غير صالحة',
  OFFLINE_UUID_REUSED: 'معرّف الإيصال استُخدم سابقًا بمحتوى مختلف',
  CONFLICT_INVALID: 'إجراء معالجة التعارض غير صالح',
  OVERRIDE_INVALID: 'لا يمكن منح الاستثناء لهذه الفاتورة',
  ACCOUNTING_VIOLATION: 'مخالفة محاسبية',
  RETURN_INVALID: 'المرتجع غير صالح',
  RETURN_EXCEEDS_SOLD: 'كمية المرتجع تتجاوز المباع',
  RECONCILIATION_MISMATCH: 'عدم تطابق بين تقرير الوردية والدفتر',
  SETTINGS_INCOMPLETE: 'إعدادات المحاسبة غير مكتملة',
  COST_CONFLICT: 'تعارض في تكلفة المخزون',
};
const STATUS: Record<string, number> = { PERMISSION_DENIED: 403, NOT_FOUND: 404, TENANT_CONTEXT_MISMATCH: 403 };

/** The database raises 'CODE: details'. Anything else (driver errors, bugs) is a 500 that does not leak internals. */
export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ code: err.code, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ code: 'BAD_REQUEST', message: 'بيانات الطلب غير صحيحة', issues: err.issues });
    if (err?.validation || err?.statusCode === 400) return reply.status(400).send({ code: 'BAD_REQUEST', message: 'بيانات الطلب غير صحيحة' });
    if (err?.statusCode === 429) return reply.status(429).send({ code: 'RATE_LIMITED', message: 'طلبات كثيرة من هذا الجهاز، حاول بعد قليل.' });
    if (err?.statusCode === 401) return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'يلزم تسجيل الدخول' });
    const m = typeof err?.message === 'string' ? /^([A-Z_]+):\s*(.*)$/s.exec(err.message) : null;
    if (m && err?.severity === 'ERROR') {
      const code = m[1];
      return reply.status(STATUS[code] ?? 409).send({ code, message: AR[code] ?? code, detail: m[2] });
    }
    if (err?.code === '23505' && /open|shift/i.test(String(err.constraint ?? err.message)))
      return reply.status(409).send({ code: 'SHIFT_ALREADY_OPEN', message: 'توجد وردية مفتوحة على هذا الصندوق' });
    req.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL', message: 'خطأ داخلي في الخادم' });
  });
}
