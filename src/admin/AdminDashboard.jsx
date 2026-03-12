import { useEffect, useState } from "react";
import AppointmentsTable from "./AppointmentsTable";
import MonthCalendar from "./MonthCalendar";
import {
  getAppointmentsRequest,
  getMonthOverviewRequest,
  openRangeSlotsRequest,
  updateAppointmentRequest,
} from "../services/adminApi";

function AdminDashboard({ token, language, onLogout }) {
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });

  const [monthData, setMonthData] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [error, setError] = useState("");

  const labels =
    language === "he"
      ? {
          title: "דשבורד ניהול תורים",
          subtitle: "כאן ניתן לפתוח ימים ושעות, לצפות בתורים ולאשר או לבטל הזמנות.",
          logout: "התנתק",
          open7: "פתח 7 ימים",
          open14: "פתח 14 ימים",
          open30: "פתח חודש",
          loading: "טוען נתונים...",
        }
      : {
          title: "لوحة إدارة المواعيد",
          subtitle: "من هنا يمكن فتح الأيام والساعات، عرض المواعيد، وتأكيد أو إلغاء الحجوزات.",
          logout: "تسجيل خروج",
          open7: "افتح 7 أيام",
          open14: "افتح 14 يومًا",
          open30: "افتح شهرًا",
          loading: "جارٍ تحميل البيانات...",
        };

  const formatDate = (dateObj) => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const [monthRes, appointmentsRes] = await Promise.all([
        getMonthOverviewRequest(token, month),
        getAppointmentsRequest(token),
      ]);

      setMonthData(monthRes);
      setAppointments(appointmentsRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [month]);

  const handleOpenRange = async (daysToAdd) => {
    try {
      setError("");
      setActionMessage("");

      const today = new Date();
      const future = new Date();
      future.setDate(today.getDate() + daysToAdd);

      await openRangeSlotsRequest(token, {
        startDate: formatDate(today),
        endDate: formatDate(future),
      });

      setActionMessage(
        language === "he"
          ? "התורים נפתחו בהצלחה"
          : "تم فتح المواعيد بنجاح"
      );

      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdateAppointment = async (appointmentId, status) => {
    try {
      setError("");
      setActionMessage("");

      await updateAppointmentRequest(token, appointmentId, status);

      setActionMessage(
        language === "he"
          ? "התור עודכן בהצלחה"
          : "تم تحديث الموعد بنجاح"
      );

      await loadData();
    } catch (err) {
      setError(err.message);
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

          <button className="btn btn-secondary" onClick={onLogout}>
            {labels.logout}
          </button>
        </div>

        <div className="card admin-actions-card">
          <div className="admin-actions-row">
            <button className="btn btn-primary" onClick={() => handleOpenRange(7)}>
              {labels.open7}
            </button>

            <button className="btn btn-secondary" onClick={() => handleOpenRange(14)}>
              {labels.open14}
            </button>

            <button className="btn btn-secondary" onClick={() => handleOpenRange(30)}>
              {labels.open30}
            </button>

            <input
              type="month"
              className="admin-month-input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
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
            <MonthCalendar monthData={monthData} language={language} />
            <AppointmentsTable
              appointments={appointments}
              onUpdateStatus={handleUpdateAppointment}
              language={language}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default AdminDashboard;