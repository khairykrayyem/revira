import { useEffect, useMemo, useState } from "react";
import { createAppointment, getOpenSlots } from "../services/api";

function BookingSection({ data, language }) {
  const [slots, setSlots] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [formData, setFormData] = useState({
    clientName: "",
    clientPhone: "",
    treatment: "",
    notes: "",
  });

  const treatments = useMemo(() => {
    return data.treatmentsList || [];
  }, [data]);

  const getTodayAndNext30Days = () => {
    const today = new Date();
    const future = new Date();
    future.setDate(today.getDate() + 30);

    const format = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    return {
      from: format(today),
      to: format(future),
    };
  };

  const fetchSlots = async () => {
    try {
      setLoadingSlots(true);
      setError("");

      const { from, to } = getTodayAndNext30Days();
      const data = await getOpenSlots(from, to);
      setSlots(data);
    } catch (err) {
      setError(
        language === "he"
          ? "שגיאה בטעינת התורים"
          : "حدث خطأ أثناء تحميل المواعيد"
      );
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchSlots();
  }, [language]);

  const groupedSlots = useMemo(() => {
    const grouped = {};

    slots.forEach((slot) => {
      if (!grouped[slot.date]) {
        grouped[slot.date] = [];
      }
      grouped[slot.date].push(slot);
    });

    return grouped;
  }, [slots]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedSlotId) {
      setError(language === "he" ? "יש לבחור תור" : "يجب اختيار موعد");
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
      setLoading(true);
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

      await fetchSlots();

      if (result.whatsappUrl) {
        window.open(result.whatsappUrl, "_blank");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section booking-section" id="booking">
      <div className="container">
        <h2 className="section-title">{data.title}</h2>
        <p className="section-subtitle">{data.subtitle}</p>

        <div className="booking-layout">
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
                  placeholder={
                    language === "he" ? "הכנס שם מלא" : "أدخل الاسم الكامل"
                  }
                />
              </div>

              <div className="form-group">
                <label>{language === "he" ? "מספר טלפון" : "رقم الهاتف"}</label>
                <input
                  type="tel"
                  name="clientPhone"
                  value={formData.clientPhone}
                  onChange={handleChange}
                  placeholder={
                    language === "he" ? "הכנס מספר טלפון" : "أدخل رقم الهاتف"
                  }
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
                  {language === "he" ? "הערות (אופציונלי)" : "ملاحظات (اختياري)"}
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows="4"
                  placeholder={
                    language === "he"
                      ? "כתוב הערות נוספות..."
                      : "اكتب ملاحظات إضافية..."
                  }
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
                disabled={loading}
              >
                {loading
                  ? language === "he"
                    ? "שולח..."
                    : "جارٍ الإرسال..."
                  : language === "he"
                  ? "אשר הזמנה"
                  : "تأكيد الحجز"}
              </button>
            </form>
          </div>

          <div className="card booking-slots-card">
            <h3 className="booking-card-title">
              {language === "he" ? "תורים זמינים" : "المواعيد المتاحة"}
            </h3>

            {loadingSlots ? (
              <p className="booking-empty-state">
                {language === "he" ? "טוען תורים..." : "جارٍ تحميل المواعيد..."}
              </p>
            ) : Object.keys(groupedSlots).length === 0 ? (
              <p className="booking-empty-state">
                {language === "he"
                  ? "אין תורים זמינים כרגע"
                  : "لا توجد مواعيد متاحة حاليًا"}
              </p>
            ) : (
              <div className="booking-days-list">
                {Object.entries(groupedSlots).map(([date, daySlots]) => (
                  <div className="booking-day-block" key={date}>
                    <div className="booking-day-header">{date}</div>

                    <div className="booking-slots-grid">
                      {daySlots.map((slot) => (
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default BookingSection;