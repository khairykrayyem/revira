function MonthCalendar({
  month,
  monthData,
  language,
  selectedDate,
  onDaySelect,
}) {
  const labels =
    language === "he"
      ? {
          open: "פנויים",
          booked: "תפוסים",
          closed: "סגורים",
          noSlotsYet: "אין שעות עדיין",
          pastDay: "יום שעבר",
        }
      : {
          open: "متاح",
          booked: "محجوز",
          closed: "مغلق",
          noSlotsYet: "لا توجد ساعات بعد",
          pastDay: "يوم سابق",
        };

  const getDayName = (dateString) => {
    const date = new Date(dateString);

    const daysHe = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    const daysAr = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

    return language === "he" ? daysHe[date.getDay()] : daysAr[date.getDay()];
  };

  const formatShortDate = (dateString) => {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, "0");
    const monthValue = String(date.getMonth() + 1).padStart(2, "0");

    return `${day}/${monthValue}`;
  };

  const getTodayString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const monthValue = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    return `${year}-${monthValue}-${day}`;
  };

  const buildMonthDays = () => {
    if (!month) return [];

    const [year, monthNumber] = month.split("-").map(Number);
    const totalDays = new Date(year, monthNumber, 0).getDate();

    const monthMap = new Map(monthData.map((day) => [day.date, day]));
    const fullMonthDays = [];

    for (let day = 1; day <= totalDays; day += 1) {
      const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const existingDay = monthMap.get(date);

      fullMonthDays.push(
        existingDay || {
          date,
          openCount: 0,
          bookedCount: 0,
          closedCount: 0,
        }
      );
    }

    return fullMonthDays;
  };

  const todayString = getTodayString();
  const fullMonthDays = buildMonthDays();

  return (
    <div className="admin-collapse-content">
      <div className="month-grid">
        {fullMonthDays.map((day) => {
          const totalSlots = day.openCount + day.bookedCount + day.closedCount;
          const isEmptyDay = totalSlots === 0;
          const isPastDay = day.date < todayString;

          return (
            <button
              type="button"
              className={`month-day-card ${
                selectedDate === day.date ? "month-day-card-active" : ""
              } ${isEmptyDay ? "month-day-card-empty" : ""} ${
                isPastDay ? "month-day-card-past" : ""
              }`}
              key={day.date}
              onClick={() => {
                if (!isPastDay) onDaySelect(day.date);
              }}
              disabled={isPastDay}
            >
              <div className="month-day-date">
                <div className="month-day-name">{getDayName(day.date)}</div>
                <div className="month-day-number">{formatShortDate(day.date)}</div>
              </div>

              {isPastDay ? (
                <div className="month-day-empty-label">{labels.pastDay}</div>
              ) : isEmptyDay ? (
                <div className="month-day-empty-label">{labels.noSlotsYet}</div>
              ) : (
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
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MonthCalendar;