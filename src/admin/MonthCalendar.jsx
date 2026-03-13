function MonthCalendar({ monthData, language, selectedDate, onDaySelect }) {
  const labels =
    language === "he"
      ? {
          title: "סקירת חודש",
          open: "פנויים",
          booked: "תפוסים",
          closed: "סגורים",
          empty: "אין נתונים לחודש זה",
        }
      : {
          title: "نظرة عامة على الشهر",
          open: "متاح",
          booked: "محجوز",
          closed: "مغلق",
          empty: "لا توجد بيانات لهذا الشهر",
        };

  return (
    <div className="card admin-card">
      <h3 className="admin-card-title">{labels.title}</h3>

      {monthData.length === 0 ? (
        <p className="booking-empty-state">{labels.empty}</p>
      ) : (
        <div className="month-grid">
          {monthData.map((day) => (
            <button
              type="button"
              className={`month-day-card ${
                selectedDate === day.date ? "month-day-card-active" : ""
              }`}
              key={day.date}
              onClick={() => onDaySelect(day.date)}
            >
              <div className="month-day-date">{day.date}</div>

              <div className="month-day-stats">
                <div className="month-stat month-stat-open">
                  {labels.open}: {day.openCount}
                </div>

                <div className="month-stat month-stat-booked">
                  {labels.booked}: {day.bookedCount}
                </div>

                <div className="month-stat month-stat-closed">
                  {labels.closed}: {day.closedCount}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MonthCalendar;