import { getClinicDateTime } from "./clinicTime.js";

const addDays = (dateString, days) => {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const getMonthEnd = (monthString) => {
  const [year, month] = monthString.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

export const getAdminRangeBounds = ({ month, selectedDate, mode, now = new Date() }) => {
  const today = getClinicDateTime(now).date;
  const monthStart = `${month}-01`;
  const monthEnd = getMonthEnd(month);

  if (monthEnd < today) {
    throw new Error("Selected month is in the past");
  }

  const selectedDateInMonth = selectedDate?.startsWith(`${month}-`) ? selectedDate : "";
  const startDate = selectedDateInMonth || (monthStart < today ? today : monthStart);

  if (mode === "7") return { startDate, endDate: addDays(startDate, 6) };
  if (mode === "14") return { startDate, endDate: addDays(startDate, 13) };
  if (mode === "month") return { startDate, endDate: monthEnd };

  throw new Error("Unknown range mode");
};
