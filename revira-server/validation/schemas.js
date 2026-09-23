import { z } from "zod";

export const MAX_RANGE_DAYS = 31;
export const MAX_TIMES_PER_DAY = 12;

export const LIMITS = Object.freeze({
  clientName: 100,
  clientPhone: 32,
  treatment: 120,
  notes: 1000,
  username: 100,
  password: 128
});

const TREATMENTS = [
  "טיפול בכף רגל סוכרתית",
  "טיפול בציפורן חודרנית",
  "טיפול בפטרת בציפורניים",
  "טיפול ביובש וסדקים",
  "טיפול ביבלות ויראליות",
  "פדיקור פרא-רפואי",
  "علاج القدم السكريّة",
  "علاج الظفر المنغرز",
  "علاج فطريات الأظافر",
  "علاج الجفاف والتشققات",
  "علاج الثآليل الفيروسية",
  "بديكير طبي"
];

const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const isRealIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
};

export const isoDateSchema = z.string().refine(isRealIsoDate, "Invalid date");
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Invalid time");
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid identifier");

const trimmedString = (max) => z.string().trim().min(1).max(max);
const scalarDateQuery = isoDateSchema;

const dateToDayNumber = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / 86400000);
};

const timeToMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const timeEntrySchema = z
  .strictObject({
    startTime: timeSchema,
    endTime: timeSchema
  })
  .refine((value) => timeToMinutes(value.startTime) < timeToMinutes(value.endTime), {
    message: "startTime must be before endTime"
  });

const timesSchema = z
  .array(timeEntrySchema)
  .min(1)
  .max(MAX_TIMES_PER_DAY)
  .refine(
    (times) => new Set(times.map(({ startTime, endTime }) => `${startTime}-${endTime}`)).size === times.length,
    "Duplicate time entries are not allowed"
  );

export const bookingBodySchema = z.strictObject({
  slotId: objectIdSchema,
  clientName: trimmedString(LIMITS.clientName),
  clientPhone: trimmedString(LIMITS.clientPhone)
    .regex(/^[0-9+()\-\s]+$/, "Invalid phone number")
    .refine((value) => /\d/.test(value), "Invalid phone number"),
  treatment: trimmedString(LIMITS.treatment).refine(
    (value) => TREATMENTS.includes(value),
    "Invalid treatment"
  ),
  notes: z.string().trim().max(LIMITS.notes).optional().default(""),
  lang: z.enum(["he", "ar"]).optional().default("he")
});

export const loginBodySchema = z.strictObject({
  username: trimmedString(LIMITS.username),
  password: z.string().min(1).max(LIMITS.password)
});

export const openRangeBodySchema = z
  .strictObject({
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    times: timesSchema.optional()
  })
  .superRefine(({ startDate, endDate }, context) => {
    const rangeLength = dateToDayNumber(endDate) - dateToDayNumber(startDate) + 1;
    if (rangeLength < 1) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "Date range is inverted" });
    } else if (rangeLength > MAX_RANGE_DAYS) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "Date range is too large" });
    }
  });

export const closeRangeBodySchema = z
  .strictObject({
    startDate: isoDateSchema,
    endDate: isoDateSchema
  })
  .superRefine(({ startDate, endDate }, context) => {
    const rangeLength = dateToDayNumber(endDate) - dateToDayNumber(startDate) + 1;
    if (rangeLength < 1) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "Date range is inverted" });
    } else if (rangeLength > MAX_RANGE_DAYS) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "Date range is too large" });
    }
  });

export const dayParamsSchema = z.strictObject({ date: isoDateSchema });
export const idParamsSchema = z.strictObject({ id: objectIdSchema });

export const updateDayBodySchema = z.strictObject({
  action: z.enum(["open", "close"]),
  times: timesSchema.optional()
});

export const publicSlotsQuerySchema = z
  .strictObject({
    from: scalarDateQuery.optional(),
    to: scalarDateQuery.optional()
  })
  .superRefine(({ from, to }, context) => {
    if ((from && !to) || (!from && to)) {
      context.addIssue({ code: "custom", message: "from and to must be provided together" });
    } else if (from && to && dateToDayNumber(from) > dateToDayNumber(to)) {
      context.addIssue({ code: "custom", path: ["to"], message: "Date range is inverted" });
    }
  });

export const monthQuerySchema = z.strictObject({
  month: z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "Invalid month")
    .refine((value) => Number(value.slice(0, 4)) >= 1, "Invalid month")
});

export const dayQuerySchema = z.strictObject({ date: scalarDateQuery });

export const updateSlotBodySchema = z
  .strictObject({
    isOpen: z.boolean().optional(),
    status: z.enum(["available", "closed"]).optional()
  })
  .refine((value) => value.isOpen !== undefined || value.status !== undefined, "Update is required");

export const updateAppointmentBodySchema = z.strictObject({
  status: z.enum(["pending", "confirmed", "cancelled"])
});
