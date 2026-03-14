function AppointmentsTable({ appointments, onUpdateStatus, language }) {
  const labels =
    language === "he"
      ? {
          title: "רשימת תורים",
          client: "לקוח",
          phone: "טלפון",
          treatment: "טיפול",
          date: "תאריך",
          time: "שעה",
          status: "סטטוס",
          actions: "פעולות",
          confirm: "אשר",
          cancel: "בטל",
          empty: "אין תורים להצגה",
          pending: "ממתין",
          confirmed: "מאושר",
          cancelled: "בוטל",
        }
      : {
          title: "قائمة المواعيد",
          client: "العميل",
          phone: "الهاتف",
          treatment: "العلاج",
          date: "التاريخ",
          time: "الساعة",
          status: "الحالة",
          actions: "إجراءات",
          confirm: "تأكيد",
          cancel: "إلغاء",
          empty: "لا توجد مواعيد للعرض",
          pending: "قيد الانتظار",
          confirmed: "مؤكد",
          cancelled: "ملغي",
        };

  const getStatusLabel = (status) => {
    if (status === "confirmed") return labels.confirmed;
    if (status === "cancelled") return labels.cancelled;
    return labels.pending;
  };

  const getStatusClass = (status) => {
    if (status === "confirmed") return "status-badge status-badge-confirmed";
    if (status === "cancelled") return "status-badge status-badge-cancelled";
    return "status-badge status-badge-pending";
  };

  const getDayName = (dateString) => {
    const date = new Date(dateString);

    const daysHe = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    const daysAr = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

    return language === "he" ? daysHe[date.getDay()] : daysAr[date.getDay()];
  };

  const formatShortDate = (dateString) => {
    const date = new Date(dateString);
    return `${getDayName(dateString)} ${date.getDate()}.${date.getMonth() + 1}`;
  };

  const getTodayStart = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };

  const getAppointmentDateTime = (appointment) => {
    const date = appointment.slotId?.date;
    const startTime = appointment.slotId?.startTime;

    if (!date || !startTime) return null;

    const [year, month, day] = date.split("-").map(Number);
    const [hours, minutes] = startTime.split(":").map(Number);

    return new Date(year, month - 1, day, hours, minutes);
  };

  const visibleAppointments = [...appointments]
    .filter((appointment) => {
      const appointmentDateTime = getAppointmentDateTime(appointment);
      if (!appointmentDateTime) return false;

      return appointmentDateTime >= getTodayStart();
    })
    .sort((a, b) => {
      const dateA = getAppointmentDateTime(a);
      const dateB = getAppointmentDateTime(b);

      return dateA - dateB;
    });

  return (
    <div className="card admin-card">
      <h3 className="admin-card-title">{labels.title}</h3>

      {visibleAppointments.length === 0 ? (
        <p className="booking-empty-state">{labels.empty}</p>
      ) : (
        <div className="appointments-table-wrap">
          <table className="appointments-table">
            <thead>
              <tr>
                <th>{labels.client}</th>
                <th>{labels.phone}</th>
                <th>{labels.treatment}</th>
                <th>{labels.date}</th>
                <th>{labels.time}</th>
                <th>{labels.status}</th>
                <th>{labels.actions}</th>
              </tr>
            </thead>

            <tbody>
              {visibleAppointments.map((appointment) => (
                <tr key={appointment._id}>
                  <td>{appointment.clientName}</td>
                  <td>{appointment.clientPhone}</td>
                  <td>{appointment.treatment}</td>
                  <td>{appointment.slotId?.date ? formatShortDate(appointment.slotId.date) : "-"}</td>
                  <td>
                    {appointment.slotId
                      ? `${appointment.slotId.startTime} - ${appointment.slotId.endTime}`
                      : "-"}
                  </td>
                  <td>
                    <span className={getStatusClass(appointment.status)}>
                      {getStatusLabel(appointment.status)}
                    </span>
                  </td>
                  <td>
                    <div className="appointment-actions">
                      <button
                        className="mini-btn mini-btn-confirm"
                        onClick={() => onUpdateStatus(appointment, "confirmed")}
                      >
                        {labels.confirm}
                      </button>

                      <button
                        className="mini-btn mini-btn-cancel"
                        onClick={() => onUpdateStatus(appointment, "cancelled")}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AppointmentsTable;