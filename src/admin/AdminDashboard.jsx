import { useCallback, useEffect, useRef, useState } from "react";
import AppointmentsTable from "./AppointmentsTable";
import MonthCalendar from "./MonthCalendar";
import DaySlotsManager from "./DaySlotsManager";
import {
  closeRangeSlotsRequest,
  getAppointmentsRequest,
  getDaySlotsRequest,
  getMonthOverviewRequest,
  openRangeSlotsRequest,
  updateAppointmentRequest,
  updateDaySlotsRequest,
  updateSlotRequest,
} from "../services/adminApi";
import { getAdminRangeBounds } from "../utils/adminRange";
import { getClinicDateTime } from "../utils/clinicTime";

function AdminDashboard({ token, language, onLogout }) {
  const [month, setMonth] = useState(() => {
    return getClinicDateTime().date.slice(0, 7);
  });

  const [selectedDate, setSelectedDate] = useState("");
  const [monthData, setMonthData] = useState([]);
  const [daySlots, setDaySlots] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [error, setError] = useState("");
  const [isRangePending, setIsRangePending] = useState(false);
  const [pendingDayAction, setPendingDayAction] = useState("");
  const [pendingSlotIds, setPendingSlotIds] = useState(() => new Set());
  const [pendingAppointmentIds, setPendingAppointmentIds] = useState(() => new Set());
  const rangePendingRef = useRef(false);
  const dayPendingRef = useRef(false);
  const pendingSlotIdsRef = useRef(new Set());
  const pendingAppointmentIdsRef = useRef(new Set());
  const [isMonthCalendarOpen, setIsMonthCalendarOpen] = useState(true);
const [isDayManagerOpen, setIsDayManagerOpen] = useState(true); 

  const labels =
    language === "he"
      ? {
          title: "דשבורד ניהול תורים",
          subtitle: "כאן ניתן לפתוח ימים ושעות, לצפות בתורים ולאשר או לבטל הזמנות.",
          logout: "התנתק",
          open7: "פתח 7 ימים",
          open14: "פתח 14 ימים",
          open30: "פתח חודש",
          close7: "סגור 7 ימים",
          close14: "סגור 14 ימים",
          close30: "סגור חודש",
          loading: "טוען נתונים...",
        }
      : {
          title: "لوحة إدارة المواعيد",
          subtitle: "من هنا يمكن فتح الأيام والساعات، عرض المواعيد، وتأكيد أو إلغاء الحجوزات.",
          logout: "تسجيل خروج",
          open7: "افتح 7 أيام",
          open14: "افتح 14 يومًا",
          open30: "افتح شهرًا",
          close7: "أغلق 7 أيام",
          close14: "أغلق 14 يومًا",
          close30: "أغلق شهرًا",
          loading: "جارٍ تحميل البيانات...",
        };

  const loadMonthData = useCallback(async () => {
    const result = await getMonthOverviewRequest(token, month);
    setMonthData(result);
  }, [month, token]);

  const loadAppointments = useCallback(async () => {
    const result = await getAppointmentsRequest(token);
    setAppointments(result);
  }, [token]);

  const loadData = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
        setError("");
      }

      await Promise.all([loadMonthData(), loadAppointments()]);
    } catch (err) {
      setError(err.message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [loadAppointments, loadMonthData]);

  const loadSelectedDaySlots = useCallback(async (date) => {
    if (!date) {
      setDaySlots([]);
      return;
    }

    try {
      const slots = await getDaySlotsRequest(token, date);
      setDaySlots(slots);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  useEffect(() => {
    loadSelectedDaySlots(selectedDate);
  }, [loadSelectedDaySlots, selectedDate]);

  useEffect(() => {
  const interval = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    loadData();
    if (selectedDate) {
      loadSelectedDaySlots(selectedDate);
    }
  }, 15000);

  return () => clearInterval(interval);
}, [loadData, loadSelectedDaySlots, selectedDate]);

  const handleRangeAction = async (mode, action) => {
    if (rangePendingRef.current) return;

    let bounds;
    try {
      bounds = getAdminRangeBounds({ month, selectedDate, mode });
    } catch {
      setError(
        language === "he"
          ? "לא ניתן לעדכן טווח בחודש שעבר"
          : "لا يمكن تحديث نطاق في شهر سابق"
      );
      return;
    }

    if (action === "close") {
      const confirmed = window.confirm(
        language === "he"
          ? `לסגור את כל השעות הפנויות בין ${bounds.startDate} ל-${bounds.endDate}?`
          : `هل تريد إغلاق جميع الساعات المتاحة من ${bounds.startDate} حتى ${bounds.endDate}؟`
      );
      if (!confirmed) return;
    }

    try {
      rangePendingRef.current = true;
      setIsRangePending(true);
      setError("");
      setActionMessage("");

      if (action === "open") {
        await openRangeSlotsRequest(token, bounds);
      } else {
        await closeRangeSlotsRequest(token, bounds);
      }

      setActionMessage(
        language === "he"
          ? action === "open" ? "התורים נפתחו בהצלחה" : "התורים הפנויים נסגרו בהצלחה"
          : action === "open" ? "تم فتح المواعيد بنجاح" : "تم إغلاق المواعيد المتاحة بنجاح"
      );

      await Promise.all([
        loadMonthData(),
        selectedDate ? loadSelectedDaySlots(selectedDate) : Promise.resolve(),
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      rangePendingRef.current = false;
      setIsRangePending(false);
    }
  };

  const handleSelectDay = async (date) => {
    setSelectedDate(date);
    setActionMessage("");
    setError("");
  };

  const handleOpenDay = async () => {
    if (!selectedDate || dayPendingRef.current) return;

    try {
      dayPendingRef.current = true;
      setPendingDayAction("open");
      setError("");
      setActionMessage("");

      await updateDaySlotsRequest(token, selectedDate, "open");

      setActionMessage(
        language === "he"
          ? "היום נפתח בהצלחה"
          : "تم فتح اليوم بنجاح"
      );

      await Promise.all([loadMonthData(), loadSelectedDaySlots(selectedDate)]);
    } catch (err) {
      setError(err.message);
    } finally {
      dayPendingRef.current = false;
      setPendingDayAction("");
    }
  };

  const handleCloseDay = async () => {
    if (!selectedDate || dayPendingRef.current) return;

    const confirmed = window.confirm(
      language === "he"
        ? "לסגור את כל השעות הפנויות ביום שנבחר?"
        : "هل تريد إغلاق جميع الساعات المتاحة في اليوم المحدد؟"
    );
    if (!confirmed) return;

    try {
      dayPendingRef.current = true;
      setPendingDayAction("close");
      setError("");
      setActionMessage("");

      await updateDaySlotsRequest(token, selectedDate, "close");

      setActionMessage(
        language === "he"
          ? "היום נסגר בהצלחה"
          : "تم إغلاق اليوم بنجاح"
      );

      await Promise.all([loadMonthData(), loadSelectedDaySlots(selectedDate)]);
    } catch (err) {
      setError(err.message);
    } finally {
      dayPendingRef.current = false;
      setPendingDayAction("");
    }
  };

  const handleToggleSlot = async (slot) => {
    if (pendingSlotIdsRef.current.has(slot._id)) return;

    try {
      pendingSlotIdsRef.current.add(slot._id);
      setPendingSlotIds((current) => new Set(current).add(slot._id));
      setError("");
      setActionMessage("");

      const isClosing = slot.status === "available";

      await updateSlotRequest(token, slot._id, {
        isOpen: !isClosing,
        status: isClosing ? "closed" : "available",
      });

      setActionMessage(
        language === "he"
          ? "השעה עודכנה בהצלחה"
          : "تم تحديث الساعة بنجاح"
      );

      await Promise.all([loadMonthData(), loadSelectedDaySlots(selectedDate)]);
    } catch (err) {
      setError(err.message);
    } finally {
      pendingSlotIdsRef.current.delete(slot._id);
      setPendingSlotIds((current) => {
        const next = new Set(current);
        next.delete(slot._id);
        return next;
      });
    }
  };

  const normalizePhoneForWhatsApp = (phone) => {
  if (!phone) return "";

  let cleaned = phone.replace(/\D/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = `972${cleaned.slice(1)}`;
  }

  if (cleaned.startsWith("972")) {
    return cleaned;
  }

  return cleaned;
};

const buildWhatsAppMessage = (appointment, status) => {
  const clientName = appointment.clientName || "";
  const date = appointment.slotId?.date || "";
  const startTime = appointment.slotId?.startTime || "";
  const treatment = appointment.treatment || "";

  if (language === "he") {
    if (status === "confirmed") {
      return `שלום ${clientName}, מנהל המרפאה אישר את התור שלך לתאריך ${date} בשעה ${startTime}${treatment ? ` עבור ${treatment}` : ""}. נשמח לראותך.`;
    }

    return `שלום ${clientName}, לצערנו התור שביקשת לתאריך ${date} בשעה ${startTime}${treatment ? ` עבור ${treatment}` : ""} לא אושר. נא לקבוע יום או שעה אחרת. תודה.`;
  }

  if (status === "confirmed") {
    return `مرحبًا ${clientName}، لقد تم تأكيد موعدك بتاريخ ${date} الساعة ${startTime}${treatment ? ` من أجل ${treatment}` : ""}. يسعدنا استقبالكم.`;
  }

  return `مرحبًا ${clientName}، نعتذر، لم تتم الموافقة على موعدك بتاريخ ${date} الساعة ${startTime}${treatment ? ` من أجل ${treatment}` : ""}. يرجى حجز يوم أو ساعة أخرى. شكرًا.`;
};

const openAppointmentWhatsApp = (appointment, status) => {
  const phone = normalizePhoneForWhatsApp(appointment.clientPhone);
  if (!phone) return;

  const message = buildWhatsAppMessage(appointment, status);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  window.open(url, "_blank");
};

const handleUpdateAppointment = async (appointment, status) => {
  if (pendingAppointmentIdsRef.current.has(appointment._id)) return;

  if (status === "cancelled") {
    const confirmed = window.confirm(
      language === "he"
        ? "לבטל את התור שנבחר?"
        : "هل تريد إلغاء الموعد المحدد؟"
    );
    if (!confirmed) return;
  }

  try {
    pendingAppointmentIdsRef.current.add(appointment._id);
    setPendingAppointmentIds((current) => new Set(current).add(appointment._id));
    setError("");
    setActionMessage("");

    await updateAppointmentRequest(token, appointment._id, status);

    setActionMessage(
      language === "he"
        ? "התור עודכן בהצלחה"
        : "تم تحديث الموعد بنجاح"
    );

    await Promise.all([
      loadMonthData(),
      loadAppointments(),
      selectedDate ? loadSelectedDaySlots(selectedDate) : Promise.resolve(),
    ]);

    openAppointmentWhatsApp(appointment, status);
  } catch (err) {
    setError(err.message);
  } finally {
    pendingAppointmentIdsRef.current.delete(appointment._id);
    setPendingAppointmentIds((current) => {
      const next = new Set(current);
      next.delete(appointment._id);
      return next;
    });
  }
};
  return (
    <section className="section admin-page">
      <div className="container">
        <div className="admin-topbar">
          <div>
            <h2 className="section-title admin-main-title">{labels.title}</h2>
            <p className="section-subtitle admin-main-subtitle">{labels.subtitle}</p>
          </div>

          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            {labels.logout}
          </button>
        </div>

        <div className="card admin-actions-card">
          <div className="admin-actions-row">
            <button type="button" className="btn btn-primary" onClick={() => handleRangeAction("7", "open")} disabled={isRangePending}>
              {labels.open7}
            </button>

            <button type="button" className="btn btn-secondary" onClick={() => handleRangeAction("14", "open")} disabled={isRangePending}>
              {labels.open14}
            </button>

            <button type="button" className="btn btn-secondary" onClick={() => handleRangeAction("month", "open")} disabled={isRangePending}>
              {labels.open30}
            </button>

            <button type="button" className="btn btn-secondary" onClick={() => handleRangeAction("7", "close")} disabled={isRangePending}>
              {labels.close7}
            </button>

            <button type="button" className="btn btn-secondary" onClick={() => handleRangeAction("14", "close")} disabled={isRangePending}>
              {labels.close14}
            </button>

            <button type="button" className="btn btn-secondary" onClick={() => handleRangeAction("month", "close")} disabled={isRangePending}>
              {labels.close30}
            </button>

            <input
              type="month"
              className="admin-month-input"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSelectedDate("");
              }}
            />
          </div>

          {error && <div className="booking-message error-message">{error}</div>}
          {actionMessage && (
            <div className="booking-message success-message">{actionMessage}</div>
          )}
        </div>

        {loading ? (
          <p className="booking-empty-state">{labels.loading}</p>
        ) : (
          <>
<div className="card admin-card">
  <button
    type="button"
    className="admin-collapse-toggle"
    onClick={() => setIsMonthCalendarOpen((prev) => !prev)}
  >
    <span>{language === "he" ? "סקירת חודש" : "نظرة عامة على الشهر"}</span>
    <span>{isMonthCalendarOpen ? "−" : "+"}</span>
  </button>

  {isMonthCalendarOpen && (
    <MonthCalendar
      month={month}
      monthData={monthData}
      language={language}
      selectedDate={selectedDate}
      onDaySelect={handleSelectDay}
    />
  )}
</div>

<div className="card admin-card">
  <button
    type="button"
    className="admin-collapse-toggle"
    onClick={() => setIsDayManagerOpen((prev) => !prev)}
  >
    <span>{language === "he" ? "ניהול שעות היום" : "إدارة ساعات اليوم"}</span>
    <span>{isDayManagerOpen ? "−" : "+"}</span>
  </button>

  {isDayManagerOpen && (
    <DaySlotsManager
      selectedDate={selectedDate}
      daySlots={daySlots}
      onOpenDay={handleOpenDay}
      onCloseDay={handleCloseDay}
      onToggleSlot={handleToggleSlot}
      pendingDayAction={pendingDayAction}
      pendingSlotIds={pendingSlotIds}
      language={language}
    />
  )}
</div>
            <AppointmentsTable
              appointments={appointments}
              onUpdateStatus={handleUpdateAppointment}
              pendingAppointmentIds={pendingAppointmentIds}
              language={language}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default AdminDashboard;
