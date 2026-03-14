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

  return (
    <div className="card admin-card">
      <h3 className="admin-card-title">{labels.title}</h3>

      {appointments.length === 0 ? (
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
              {appointments.map((appointment) => (
                <tr key={appointment._id}>
                  <td>{appointment.clientName}</td>
                  <td>{appointment.clientPhone}</td>
                  <td>{appointment.treatment}</td>
                  <td>{appointment.slotId?.date || "-"}</td>
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