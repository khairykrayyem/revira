import { useEffect, useMemo, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { createAppointment, getOpenSlots } from "../services/api";

function BookingCalendar({ data, language }) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [slots, setSlots] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [formData, setFormData] = useState({
    clientName: "",
    clientPhone: "",
    treatment: "",
    notes: "",
  });

  const treatments = useMemo(() => data.treatmentsList || [], [data]);

  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const fetchDaySlots = async (dateObj) => {
    try {
      setLoadingSlots(true);
      setError("");

      const date = formatDate(dateObj);
      const result = await getOpenSlots(date, date);
      setSlots(result);
    } catch (err) {
      setError(
        language === "he"
          ? "שגיאה בטעינת תורים"
          : "حدث خطأ أثناء تحميل المواعيد"
      );
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchDaySlots(selectedDate);
  }, [selectedDate, language]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedSlotId) {
      setError(language === "he" ? "יש לבחור שעה" : "يجب اختيار ساعة");
      return;
    }

    if (!formData.clientName || !formData.clientPhone || !formData.treatment) {
      setError(
        language === "he"
          ? "יש למלא שם, טלפון וסוג טיפול"
          : "يرجى تعبئة الاسم والهاتف ونوع العلاج"
      );
      return;
    }

    try {
      setLoadingSubmit(true);
      setError("");
      setSuccessMessage("");

      const result = await createAppointment({
        slotId: selectedSlotId,
        clientName: formData.clientName,
        clientPhone: formData.clientPhone,
        treatment: formData.treatment,
        notes: formData.notes,
        lang: language,
      });

      setSuccessMessage(
        language === "he"
          ? "התור נקבע בהצלחה"
          : "تم حجز الموعد بنجاح"
      );

      setFormData({
        clientName: "",
        clientPhone: "",
        treatment: "",
        notes: "",
      });

      setSelectedSlotId("");
      await fetchDaySlots(selectedDate);

      if (result.whatsappUrl) {
        window.open(result.whatsappUrl, "_blank");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSubmit(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <section className="section booking-section" id="booking">
      <div className="container">
        <h2 className="section-title">{data.title}</h2>
        <p className="section-subtitle">{data.subtitle}</p>

        <div className="booking-calendar-layout">
          <div className="card booking-calendar-card">
            <h3 className="booking-card-title">
              {language === "he" ? "בחר יום" : "اختر يومًا"}
            </h3>

            <Calendar
              onChange={setSelectedDate}
              value={selectedDate}
              locale={language === "he" ? "he-IL" : "ar"}
              className="revira-calendar"
            />

            <div className="selected-date-label">
              {language === "he" ? "תאריך נבחר:" : "التاريخ المختار:"}{" "}
              {formatDate(selectedDate)}
            </div>

            <div className="day-slots-box">
              <h4 className="day-slots-title">
                {language === "he" ? "שעות זמינות" : "الساعات المتاحة"}
              </h4>

              {loadingSlots ? (
                <p className="booking-empty-state">
                  {language === "he" ? "טוען שעות..." : "جارٍ تحميل الساعات..."}
                </p>
              ) : slots.length === 0 ? (
                <p className="booking-empty-state">
                  {language === "he"
                    ? "אין שעות זמינות ביום זה"
                    : "لا توجد ساعات متاحة في هذا اليوم"}
                </p>
              ) : (
                <div className="calendar-slots-grid">
                  {slots.map((slot) => (
                    <button
                      type="button"
                      key={slot._id}
                      className={`slot-btn ${
                        selectedSlotId === slot._id ? "slot-btn-active" : ""
                      }`}
                      onClick={() => setSelectedSlotId(slot._id)}
                    >
                      {slot.startTime} - {slot.endTime}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card booking-form-card">
            <h3 className="booking-card-title">
              {language === "he" ? "פרטי המטופל" : "تفاصيل المراجع"}
            </h3>

            <form className="booking-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label>{language === "he" ? "שם מלא" : "الاسم الكامل"}</label>
                <input
                  type="text"
                  name="clientName"
                  value={formData.clientName}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label>{language === "he" ? "מספר טלפון" : "رقم الهاتف"}</label>
                <input
                  type="tel"
                  name="clientPhone"
                  value={formData.clientPhone}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label>{language === "he" ? "בחר טיפול" : "اختر العلاج"}</label>
                <select
                  name="treatment"
                  value={formData.treatment}
                  onChange={handleChange}
                >
                  <option value="">
                    {language === "he" ? "בחר טיפול" : "اختر العلاج"}
                  </option>

                  {treatments.map((treatment, index) => (
                    <option key={index} value={treatment}>
                      {treatment}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>
                  {language === "he" ? "הערות" : "ملاحظات"}
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows="4"
                />
              </div>

              {error && <div className="booking-message error-message">{error}</div>}
              {successMessage && (
                <div className="booking-message success-message">
                  {successMessage}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary booking-submit-btn"
                disabled={loadingSubmit}
              >
                {loadingSubmit
                  ? language === "he"
                    ? "שולח..."
                    : "جارٍ الإرسال..."
                  : language === "he"
                  ? "אשר הזמנה"
                  : "تأكيد الحجز"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

export default BookingCalendar;