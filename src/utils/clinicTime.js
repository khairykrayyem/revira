export const CLINIC_TIME_ZONE = "Asia/Jerusalem";

const clinicDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const getClinicDateTime = (now = new Date()) => {
  const parts = Object.fromEntries(
    clinicDateTimeFormatter
      .formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

export const isSlotStartInFuture = (slot, now = new Date()) => {
  const clinicNow = getClinicDateTime(now);
  return slot.date > clinicNow.date || (slot.date === clinicNow.date && slot.startTime > clinicNow.time);
};
