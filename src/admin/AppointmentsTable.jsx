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
          pending: "ממתין",
          confirmed: "מאושר",
          cancelled: "בוטל",
          empty: "אין תורים כרגע",
        }
      : {
          title: "قائمة المواعيد",
          client: "الاسم",
          phone: "الهاتف",
          treatment: "العلاج",
          date: "التاريخ",
          time: "الوقت",
          status: "الحالة",
          actions: "الإجراءات",
          confirm: "تأكيد",
          cancel: "إلغاء",
          pending: "قيد الانتظار",
          confirmed: "مؤكد",
          cancelled: "ملغي",
          empty: "لا توجد مواعيد حاليًا",
        };

  const statusLabel = (status) => {
    if (status === "pending") return labels.pending;
    if (status === "confirmed") return labels.confirmed;
    if (status === "cancelled") return labels.cancelled;
    return status;
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
                  <td>{statusLabel(appointment.status)}</td>
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