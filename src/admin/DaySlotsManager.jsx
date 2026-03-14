function DaySlotsManager({
  selectedDate,
  daySlots,
  onOpenDay,
  onCloseDay,
  onToggleSlot,
  language,
}) {
  const labels =
    language === "he"
      ? {
          selectedDay: "יום נבחר",
          noDay: "יש לבחור יום מהחודש",
          noSlots: "אין עדיין שעות ליום זה",
          openDay: "פתח את כל היום",
          closeDay: "סגור את כל היום",
          openSlot: "פתח שעה",
          closeSlot: "סגור שעה",
          booked: "תפוס",
          available: "זמין",
          closed: "סגור",
        }
      : {
          selectedDay: "اليوم المختار",
          noDay: "يجب اختيار يوم من الشهر",
          noSlots: "لا توجد ساعات لهذا اليوم بعد",
          openDay: "افتح اليوم بالكامل",
          closeDay: "أغلق اليوم بالكامل",
          openSlot: "افتح الساعة",
          closeSlot: "أغلق الساعة",
          booked: "محجوز",
          available: "متاح",
          closed: "مغلق",
        };

  const getStatusLabel = (slot) => {
    if (slot.status === "booked") return labels.booked;
    if (slot.status === "closed") return labels.closed;
    return labels.available;
  };

  return (
    <div className="admin-collapse-content">
      {!selectedDate ? (
        <p className="booking-empty-state">{labels.noDay}</p>
      ) : (
        <>
          <div className="selected-date-label">
            {labels.selectedDay}: {selectedDate}
          </div>

          <div className="admin-actions-row" style={{ marginBottom: "16px" }}>
            <button className="btn btn-primary" onClick={onOpenDay}>
              {labels.openDay}
            </button>

            <button className="btn btn-secondary" onClick={onCloseDay}>
              {labels.closeDay}
            </button>
          </div>

          {daySlots.length === 0 ? (
            <p className="booking-empty-state">{labels.noSlots}</p>
          ) : (
            <div className="day-slots-admin-list">
              {daySlots.map((slot) => {
                const isBooked = slot.status === "booked";
                const isClosed = slot.status === "closed";

                return (
                  <div className="day-slot-admin-card" key={slot._id}>
                    <div>
                      <strong>
                        {slot.startTime} - {slot.endTime}
                      </strong>
                      <div className={`slot-status slot-status-${slot.status}`}>
                        {getStatusLabel(slot)}
                      </div>
                    </div>

                    <div>
                      {!isBooked && (
                        <button
                          className={`mini-btn ${
                            isClosed ? "mini-btn-confirm" : "mini-btn-cancel"
                          }`}
                          onClick={() => onToggleSlot(slot)}
                        >
                          {isClosed ? labels.openSlot : labels.closeSlot}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DaySlotsManager;