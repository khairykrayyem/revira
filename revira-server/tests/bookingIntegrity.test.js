import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import Appointment from "../models/Appointment.js";
import AdminUser from "../models/AdminUser.js";
import Slot from "../models/Slot.js";
import { jsonErrorHandler } from "../middleware/jsonErrorHandler.js";
import adminRoutes from "../routes/adminRoutes.js";
import publicRoutes from "../routes/publicRoutes.js";
import { createAppointmentAt, getOpenSlotsAt } from "../controllers/publicController.js";
import { LIMITS, MAX_RANGE_DAYS, MAX_TIMES_PER_DAY } from "../validation/schemas.js";
import { buildFutureSlotFilter, getClinicDateTime } from "../utils/clinicTime.js";
import { getAdminRangeBounds } from "../../src/utils/adminRange.js";
import { isSlotStartInFuture } from "../../src/utils/clinicTime.js";

const TEST_DATABASE_NAME = "revira_booking_integrity_test";
const CONCURRENT_REQUEST_COUNT = 8;
const CANONICAL_TIMES = ["08:00", "09:30", "11:00", "12:30", "14:00", "15:30"];

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(jsonErrorHandler);
app.use("/api", publicRoutes);
app.use("/api/admin", adminRoutes);

let replicaSet;
let adminToken;

const availableSlot = () => ({
  date: "2099-01-01",
  startTime: "08:00",
  endTime: "09:30",
  isOpen: true,
  status: "available",
  appointmentId: null
});

const bookingPayload = (slotId, overrides = {}) => ({
  slotId,
  clientName: "Integrity Test",
  clientPhone: "0000000000",
  treatment: "טיפול בכף רגל סוכרתית",
  notes: "",
  lang: "he",
  ...overrides
});

const bookSlot = (slotId, overrides) =>
  request(app).post("/api/appointments").send(bookingPayload(slotId, overrides));

const addCalendarDays = (dateString, days) => {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

const getOperatingDates = (startDate, endDate) => {
  const dates = [];
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) {
    const [year, month, day] = date.split("-").map(Number);
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 6) dates.push(date);
  }
  return dates;
};

const verifyCloseRange = async ({ mode, expectedBounds, fixedNow }) => {
  const bounds = getAdminRangeBounds({
    month: expectedBounds.startDate.slice(0, 7),
    selectedDate: expectedBounds.startDate,
    mode,
    now: fixedNow
  });
  assert.deepEqual(bounds, expectedBounds);

  const before = await Slot.create({
    ...availableSlot(),
    date: addCalendarDays(bounds.startDate, -1),
    startTime: "08:00"
  });
  const firstInside = await Slot.create({
    ...availableSlot(),
    date: bounds.startDate,
    startTime: "09:00",
    endTime: "10:00"
  });
  const lastInside = await Slot.create({
    ...availableSlot(),
    date: bounds.endDate,
    startTime: "10:00",
    endTime: "11:00"
  });
  const bookedInside = await Slot.create({
    ...availableSlot(),
    date: bounds.startDate,
    startTime: "11:00",
    endTime: "12:00"
  });
  const appointment = await Appointment.create(bookingPayload(bookedInside._id));
  await Slot.updateOne(
    { _id: bookedInside._id },
    { $set: { isOpen: false, status: "booked", appointmentId: appointment._id } }
  );
  const after = await Slot.create({
    ...availableSlot(),
    date: addCalendarDays(bounds.endDate, 1),
    startTime: "12:00",
    endTime: "13:00"
  });

  const authorization = { Authorization: `Bearer ${adminToken}` };
  const firstResponse = await request(app)
    .patch("/api/admin/slots/close-range")
    .set(authorization)
    .send(bounds);
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.body.matchedCount, 2);
  assert.equal(firstResponse.body.modifiedCount, 2);

  const retryResponse = await request(app)
    .patch("/api/admin/slots/close-range")
    .set(authorization)
    .send(bounds);
  assert.equal(retryResponse.status, 200);
  assert.equal(retryResponse.body.matchedCount, 0);
  assert.equal(retryResponse.body.modifiedCount, 0);

  for (const slotId of [firstInside._id, lastInside._id]) {
    const slot = await Slot.findById(slotId);
    assert.equal(slot.isOpen, false);
    assert.equal(slot.status, "closed");
    assert.equal(slot.appointmentId, null);
  }

  for (const slotId of [before._id, after._id]) {
    const slot = await Slot.findById(slotId);
    assert.equal(slot.isOpen, true);
    assert.equal(slot.status, "available");
    assert.equal(slot.appointmentId, null);
  }

  const preservedBookedSlot = await Slot.findById(bookedInside._id);
  assert.equal(preservedBookedSlot.isOpen, false);
  assert.equal(preservedBookedSlot.status, "booked");
  assert.equal(preservedBookedSlot.appointmentId.toString(), appointment._id.toString());
  assert.equal(await Appointment.countDocuments({}), 1);
  assert.equal((await Appointment.findById(appointment._id)).status, "pending");
};

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const testUri = replicaSet.getUri();

  assert.match(testUri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/);
  assert.notEqual(TEST_DATABASE_NAME, "reviraDB");

  await mongoose.connect(testUri, { dbName: TEST_DATABASE_NAME });
  assert.equal(mongoose.connection.db.databaseName, TEST_DATABASE_NAME);

  await Promise.all([Slot.syncIndexes(), Appointment.syncIndexes(), AdminUser.syncIndexes()]);

  process.env.JWT_SECRET = "booking-integrity-test-only";
  adminToken = jwt.sign({ id: "test-admin" }, process.env.JWT_SECRET);
});

beforeEach(async () => {
  assert.equal(mongoose.connection.db.databaseName, TEST_DATABASE_NAME);
  await Promise.all([Appointment.deleteMany({}), Slot.deleteMany({}), AdminUser.deleteMany({})]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.equal(mongoose.connection.db.databaseName, TEST_DATABASE_NAME);
    await mongoose.disconnect();
  }
  if (replicaSet) await replicaSet.stop();
});

test("normal booking commits matching Slot and Appointment ownership", async () => {
  const slot = await Slot.create(availableSlot());
  const response = await bookSlot(slot._id);

  assert.equal(response.status, 201);
  const appointments = await Appointment.find({ slotId: slot._id });
  const updatedSlot = await Slot.findById(slot._id);

  assert.equal(appointments.length, 1);
  assert.equal(updatedSlot.status, "booked");
  assert.equal(updatedSlot.isOpen, false);
  assert.equal(updatedSlot.appointmentId.toString(), appointments[0]._id.toString());
  assert.equal(appointments[0].slotId.toString(), slot._id.toString());
});

test("eight concurrent requests produce one winner and seven conflicts", async () => {
  const slot = await Slot.create(availableSlot());
  const responses = await Promise.all(
    Array.from({ length: CONCURRENT_REQUEST_COUNT }, () => bookSlot(slot._id))
  );

  const statusCounts = responses.reduce((counts, response) => {
    counts[response.status] = (counts[response.status] || 0) + 1;
    return counts;
  }, {});
  const appointments = await Appointment.find({ slotId: slot._id });
  const updatedSlot = await Slot.findById(slot._id);

  assert.equal(statusCounts[201], 1);
  assert.equal(statusCounts[409], CONCURRENT_REQUEST_COUNT - 1);
  assert.equal(appointments.length, 1);
  assert.equal(updatedSlot.appointmentId.toString(), appointments[0]._id.toString());
  assert.equal(await Appointment.countDocuments(), 1);
});

test("already booked Slot returns 409 without another Appointment", async () => {
  const slot = await Slot.create(availableSlot());
  assert.equal((await bookSlot(slot._id)).status, 201);
  assert.equal((await bookSlot(slot._id)).status, 409);
  assert.equal(await Appointment.countDocuments({ slotId: slot._id }), 1);
});

test("clinic-time filter excludes past and boundary slots while preserving future slots", async () => {
  const fixedNow = new Date("2026-09-22T19:38:00.000Z");
  assert.deepEqual(getClinicDateTime(fixedNow), { date: "2026-09-22", time: "22:38" });

  const slots = await Slot.create([
    { ...availableSlot(), date: "2026-09-21", startTime: "23:00", endTime: "23:30" },
    { ...availableSlot(), date: "2026-09-22", startTime: "08:00", endTime: "09:00" },
    { ...availableSlot(), date: "2026-09-22", startTime: "16:00", endTime: "17:00" },
    { ...availableSlot(), date: "2026-09-22", startTime: "22:38", endTime: "23:00" },
    { ...availableSlot(), date: "2026-09-22", startTime: "22:39", endTime: "23:00" },
    { ...availableSlot(), date: "2026-09-23", startTime: "00:00", endTime: "00:01" }
  ]);

  const bookable = await Slot.find(buildFutureSlotFilter(fixedNow)).sort({ date: 1, startTime: 1 });
  assert.deepEqual(
    bookable.map((slot) => slot._id.toString()),
    [slots[4]._id.toString(), slots[5]._id.toString()]
  );
  assert.equal(isSlotStartInFuture(slots[0], fixedNow), false);
  assert.equal(isSlotStartInFuture(slots[1], fixedNow), false);
  assert.equal(isSlotStartInFuture(slots[2], fixedNow), false);
  assert.equal(isSlotStartInFuture(slots[3], fixedNow), false);
  assert.equal(isSlotStartInFuture(slots[4], fixedNow), true);
  assert.equal(isSlotStartInFuture(slots[5], fixedNow), true);

  const inconsistentOwnedSlot = await Slot.create({
    ...availableSlot(),
    date: "2026-09-23",
    startTime: "01:00",
    endTime: "01:30"
  });
  const historicalOwner = await Appointment.create({
    ...bookingPayload(inconsistentOwnedSlot._id),
    status: "cancelled"
  });
  await Slot.updateOne(
    { _id: inconsistentOwnedSlot._id },
    { $set: { appointmentId: historicalOwner._id } }
  );

  const fixedTimeApp = express();
  fixedTimeApp.use(express.json());
  fixedTimeApp.get("/slots", (req, res) => getOpenSlotsAt(req, res, fixedNow));
  fixedTimeApp.post("/appointments", (req, res) => createAppointmentAt(req, res, fixedNow));

  const visibleResponse = await request(fixedTimeApp).get(
    "/slots?from=2026-09-22&to=2026-09-23"
  );
  assert.equal(visibleResponse.status, 200);
  assert.deepEqual(
    visibleResponse.body.map((slot) => slot._id),
    [slots[4]._id.toString(), slots[5]._id.toString()]
  );

  const bypassedPastBooking = await request(fixedTimeApp)
    .post("/appointments")
    .send(bookingPayload(slots[2]._id));
  assert.equal(bypassedPastBooking.status, 409);
  assert.equal(await Appointment.countDocuments({ slotId: slots[2]._id }), 0);

  const futureBooking = await request(fixedTimeApp)
    .post("/appointments")
    .send(bookingPayload(slots[4]._id));
  assert.equal(futureBooking.status, 201);
  assert.equal(await Appointment.countDocuments({ slotId: slots[4]._id }), 1);
});

test("booking endpoint atomically rejects an unquestionably past Slot", async () => {
  const slot = await Slot.create({ ...availableSlot(), date: "2000-01-01" });
  const response = await bookSlot(slot._id);

  assert.equal(response.status, 409);
  assert.equal(await Appointment.countDocuments({ slotId: slot._id }), 0);
  const unchangedSlot = await Slot.findById(slot._id);
  assert.equal(unchangedSlot.isOpen, true);
  assert.equal(unchangedSlot.status, "available");
  assert.equal(unchangedSlot.appointmentId, null);
});

test("admin range bounds are inclusive, selected-date aware, and timezone safe", () => {
  const fixedNow = new Date("2026-09-22T19:41:00.000Z");

  assert.deepEqual(
    getAdminRangeBounds({ month: "2026-10", selectedDate: "", mode: "7", now: fixedNow }),
    { startDate: "2026-10-01", endDate: "2026-10-07" }
  );
  assert.deepEqual(
    getAdminRangeBounds({ month: "2026-10", selectedDate: "", mode: "14", now: fixedNow }),
    { startDate: "2026-10-01", endDate: "2026-10-14" }
  );
  assert.deepEqual(
    getAdminRangeBounds({ month: "2026-10", selectedDate: "", mode: "month", now: fixedNow }),
    { startDate: "2026-10-01", endDate: "2026-10-31" }
  );
  assert.deepEqual(
    getAdminRangeBounds({ month: "2026-10", selectedDate: "2026-10-10", mode: "7", now: fixedNow }),
    { startDate: "2026-10-10", endDate: "2026-10-16" }
  );
  assert.deepEqual(
    getAdminRangeBounds({ month: "2026-09", selectedDate: "", mode: "7", now: fixedNow }),
    { startDate: "2026-09-22", endDate: "2026-09-28" }
  );
});

test("close 7 days uses the frontend bounds and preserves range boundaries and ownership", async () => {
  await verifyCloseRange({
    mode: "7",
    expectedBounds: { startDate: "2099-10-05", endDate: "2099-10-11" },
    fixedNow: new Date("2099-09-01T12:00:00.000Z")
  });
});

test("close 14 days uses the frontend bounds and preserves range boundaries and ownership", async () => {
  await verifyCloseRange({
    mode: "14",
    expectedBounds: { startDate: "2099-10-05", endDate: "2099-10-18" },
    fixedNow: new Date("2099-09-01T12:00:00.000Z")
  });
});

test("close month uses the frontend bounds and preserves range boundaries and ownership", async () => {
  await verifyCloseRange({
    mode: "month",
    expectedBounds: { startDate: "2099-10-01", endDate: "2099-10-31" },
    fixedNow: new Date("2099-09-01T12:00:00.000Z")
  });
});

test("close month then open 7, 14, or month reopens existing canonical documents publicly", async () => {
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const cases = [
    { mode: "7", bounds: { startDate: "2098-03-02", endDate: "2098-03-08" } },
    { mode: "14", bounds: { startDate: "2098-04-01", endDate: "2098-04-14" } },
    { mode: "month", bounds: { startDate: "2098-05-01", endDate: "2098-05-31" } }
  ];

  for (const { bounds } of cases) {
    await Promise.all([Appointment.deleteMany({}), Slot.deleteMany({})]);
    const monthEnd = `${bounds.startDate.slice(0, 7)}-${new Date(
      Date.UTC(Number(bounds.startDate.slice(0, 4)), Number(bounds.startDate.slice(5, 7)), 0)
    ).getUTCDate()}`;
    const monthBounds = { startDate: `${bounds.startDate.slice(0, 7)}-01`, endDate: monthEnd };

    const initialOpen = await request(app)
      .post("/api/admin/slots/open-range")
      .set(authorization)
      .send(monthBounds);
    assert.equal(initialOpen.status, 200);

    const identitySlot = await Slot.findOne({ date: bounds.startDate, startTime: CANONICAL_TIMES[0] });
    assert.ok(identitySlot);
    const bookedSlot = await Slot.findOne({ date: bounds.startDate, startTime: CANONICAL_TIMES[1] });
    const appointment = await Appointment.create(bookingPayload(bookedSlot._id));
    await Slot.updateOne(
      { _id: bookedSlot._id },
      { $set: { isOpen: false, status: "booked", appointmentId: appointment._id } }
    );

    const close = await request(app)
      .patch("/api/admin/slots/close-range")
      .set(authorization)
      .send(monthBounds);
    assert.equal(close.status, 200);
    assert.equal((await request(app).get(`/api/slots?from=${monthBounds.startDate}&to=${monthBounds.endDate}`)).body.length, 0);

    const reopen = await request(app)
      .post("/api/admin/slots/open-range")
      .set(authorization)
      .send(bounds);
    assert.equal(reopen.status, 200);
    assert.equal(reopen.body.upsertedCount, 0);

    const expectedOperatingDates = getOperatingDates(bounds.startDate, bounds.endDate);
    const expectedPublicCount = expectedOperatingDates.length * CANONICAL_TIMES.length - 1;
    const publicResponse = await request(app).get(`/api/slots?from=${bounds.startDate}&to=${bounds.endDate}`);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.body.length, expectedPublicCount);
    assert.deepEqual(
      [...new Set(publicResponse.body.map((slot) => slot.date))],
      expectedOperatingDates
    );

    const reopenedIdentity = await Slot.findOne({ date: bounds.startDate, startTime: CANONICAL_TIMES[0] });
    assert.equal(reopenedIdentity._id.toString(), identitySlot._id.toString());
    assert.equal(reopenedIdentity.isOpen, true);
    assert.equal(reopenedIdentity.status, "available");
    assert.equal(reopenedIdentity.appointmentId, null);

    const preservedBooked = await Slot.findById(bookedSlot._id);
    assert.equal(preservedBooked.status, "booked");
    assert.equal(preservedBooked.isOpen, false);
    assert.equal(preservedBooked.appointmentId.toString(), appointment._id.toString());
    assert.equal(await Appointment.countDocuments({ _id: appointment._id }), 1);

    const overview = await request(app)
      .get(`/api/admin/month?month=${bounds.startDate.slice(0, 7)}`)
      .set(authorization);
    assert.equal(overview.status, 200);
    const firstDayOverview = overview.body.find(({ date }) => date === bounds.startDate);
    assert.equal(firstDayOverview.openCount, CANONICAL_TIMES.length - 1);
    assert.equal(firstDayOverview.bookedCount, 1);
    assert.equal(firstDayOverview.closedCount, 0);

    if (bounds.endDate < monthBounds.endDate) {
      const outsideDate = addCalendarDays(bounds.endDate, 1);
      assert.equal(await Slot.countDocuments({ date: outsideDate, status: "available" }), 0);
      assert.ok(await Slot.countDocuments({ date: outsideDate, status: "closed" }));
    }

    const reclose = await request(app)
      .patch("/api/admin/slots/close-range")
      .set(authorization)
      .send(bounds);
    const secondReopen = await request(app)
      .post("/api/admin/slots/open-range")
      .set(authorization)
      .send(bounds);
    assert.equal(reclose.status, 200);
    assert.equal(secondReopen.status, 200);
    assert.equal(
      (await request(app).get(`/api/slots?from=${bounds.startDate}&to=${bounds.endDate}`)).body.length,
      expectedPublicCount
    );
  }
});

test("open range creates missing slots and retries without duplicate canonical identities", async () => {
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const payload = { startDate: "2098-06-01", endDate: "2098-06-01" };
  const first = await request(app).post("/api/admin/slots/open-range").set(authorization).send(payload);
  const originalIds = (await Slot.find({ date: payload.startDate }).sort({ startTime: 1 })).map(({ _id }) => _id.toString());
  const retry = await request(app).post("/api/admin/slots/open-range").set(authorization).send(payload);

  assert.equal(first.status, 200);
  assert.equal(first.body.createdCount, CANONICAL_TIMES.length);
  assert.equal(first.body.upsertedCount, CANONICAL_TIMES.length);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.upsertedCount, 0);
  assert.equal(await Slot.countDocuments({ date: payload.startDate }), CANONICAL_TIMES.length);
  assert.deepEqual(
    (await Slot.find({ date: payload.startDate }).sort({ startTime: 1 })).map(({ _id }) => _id.toString()),
    originalIds
  );
});

test("public booking that wins during open range remains canonical and owned", async () => {
  const slot = await Slot.create({ ...availableSlot(), date: "2098-07-01" });
  const originalUpdateOne = Slot.updateOne;
  let bookingResponse;
  let injected = false;

  Slot.updateOne = async function (filter, ...args) {
    if (!injected && filter?.date === slot.date && filter?.startTime === slot.startTime) {
      injected = true;
      Slot.updateOne = originalUpdateOne;
      bookingResponse = await bookSlot(slot._id);
    }
    return originalUpdateOne.call(this, filter, ...args);
  };

  try {
    const response = await request(app)
      .post("/api/admin/slots/open-range")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        startDate: slot.date,
        endDate: slot.date,
        times: [{ startTime: slot.startTime, endTime: slot.endTime }]
      });
    assert.equal(bookingResponse.status, 201);
    assert.equal(response.status, 200);
    const bookedSlot = await Slot.findById(slot._id);
    assert.equal(bookedSlot.status, "booked");
    assert.equal(bookedSlot.isOpen, false);
    assert.equal(bookedSlot.appointmentId.toString(), bookingResponse.body.appointment._id);
  } finally {
    Slot.updateOne = originalUpdateOne;
  }
});

test("concurrent open range requests preserve one canonical document per identity", async () => {
  const payload = { startDate: "2098-08-01", endDate: "2098-08-01" };
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const responses = await Promise.all([
    request(app).post("/api/admin/slots/open-range").set(authorization).send(payload),
    request(app).post("/api/admin/slots/open-range").set(authorization).send(payload)
  ]);
  assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
  assert.equal(await Slot.countDocuments({ date: payload.startDate }), CANONICAL_TIMES.length);
  const identities = await Slot.aggregate([
    { $match: { date: payload.startDate } },
    { $group: { _id: { date: "$date", startTime: "$startTime" }, count: { $sum: 1 } } }
  ]);
  assert.ok(identities.every(({ count }) => count === 1));
});

test("range opening cannot expose or book past Jerusalem slot starts", async () => {
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const fixedNow = new Date("2026-09-22T19:38:00.000Z");
  const payload = {
    startDate: "2026-09-22",
    endDate: "2026-09-22",
    times: [
      { startTime: "08:00", endTime: "09:00" },
      { startTime: "22:38", endTime: "22:39" },
      { startTime: "22:39", endTime: "23:00" }
    ]
  };
  assert.equal(
    (await request(app).post("/api/admin/slots/open-range").set(authorization).send(payload)).status,
    200
  );

  const fixedTimeApp = express();
  fixedTimeApp.use(express.json());
  fixedTimeApp.get("/slots", (req, res) => getOpenSlotsAt(req, res, fixedNow));
  fixedTimeApp.post("/appointments", (req, res) => createAppointmentAt(req, res, fixedNow));
  const slots = await Slot.find({ date: payload.startDate }).sort({ startTime: 1 });
  const visible = await request(fixedTimeApp).get("/slots?from=2026-09-22&to=2026-09-22");
  assert.deepEqual(visible.body.map(({ startTime }) => startTime), ["22:39"]);
  assert.equal(
    (await request(fixedTimeApp).post("/appointments").send(bookingPayload(slots[0]._id))).status,
    409
  );
});

test("request validation failure leaves the Slot unclaimed", async () => {
  const slot = await Slot.create(availableSlot());
  const response = await bookSlot(slot._id, { lang: "invalid-language" });

  assert.equal(response.status, 400);
  assert.equal(await Appointment.countDocuments({ slotId: slot._id }), 0);
  const unchangedSlot = await Slot.findById(slot._id);
  assert.equal(unchangedSlot.status, "available");
  assert.equal(unchangedSlot.isOpen, true);
  assert.equal(unchangedSlot.appointmentId, null);
});

test("cancelling the owning Appointment atomically reopens its Slot", async () => {
  const slot = await Slot.create(availableSlot());
  const bookingResponse = await bookSlot(slot._id);
  const appointmentId = bookingResponse.body.appointment._id;

  const response = await request(app)
    .patch(`/api/admin/appointments/${appointmentId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "cancelled" });

  assert.equal(response.status, 200);
  assert.equal((await Appointment.findById(appointmentId)).status, "cancelled");
  const reopenedSlot = await Slot.findById(slot._id);
  assert.equal(reopenedSlot.status, "available");
  assert.equal(reopenedSlot.isOpen, true);
  assert.equal(reopenedSlot.appointmentId, null);
});

test("stale cancellation cannot reopen a Slot owned by another Appointment", async () => {
  const slot = await Slot.create(availableSlot());
  const staleAppointment = await Appointment.create(bookingPayload(slot._id));
  const currentAppointment = await Appointment.create({
    ...bookingPayload(slot._id),
    status: "cancelled"
  });
  await Slot.findByIdAndUpdate(slot._id, {
    isOpen: false,
    status: "booked",
    appointmentId: currentAppointment._id
  });

  const response = await request(app)
    .patch(`/api/admin/appointments/${staleAppointment._id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "cancelled" });

  assert.equal(response.status, 409);
  assert.equal((await Appointment.findById(staleAppointment._id)).status, "pending");
  const unchangedSlot = await Slot.findById(slot._id);
  assert.equal(unchangedSlot.status, "booked");
  assert.equal(unchangedSlot.isOpen, false);
  assert.equal(unchangedSlot.appointmentId.toString(), currentAppointment._id.toString());
});

test("confirmation cannot mutate a Slot owned by another Appointment", async () => {
  const slot = await Slot.create(availableSlot());
  const staleAppointment = await Appointment.create(bookingPayload(slot._id));
  const currentAppointment = await Appointment.create({
    ...bookingPayload(slot._id),
    status: "cancelled"
  });
  await Slot.findByIdAndUpdate(slot._id, {
    isOpen: false,
    status: "booked",
    appointmentId: currentAppointment._id
  });

  const response = await request(app)
    .patch(`/api/admin/appointments/${staleAppointment._id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "confirmed" });

  assert.equal(response.status, 409);
  assert.equal((await Appointment.findById(staleAppointment._id)).status, "pending");
  const unchangedSlot = await Slot.findById(slot._id);
  assert.equal(unchangedSlot.appointmentId.toString(), currentAppointment._id.toString());
});

test("direct Slot management rejects impossible or owned state changes", async () => {
  const slot = await Slot.create(availableSlot());

  const impossible = await request(app)
    .patch(`/api/admin/slots/${slot._id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "booked" });
  assert.equal(impossible.status, 400);

  const bookingResponse = await bookSlot(slot._id);
  assert.equal(bookingResponse.status, 201);
  const ownedChange = await request(app)
    .patch(`/api/admin/slots/${slot._id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ isOpen: true, status: "available" });
  assert.equal(ownedChange.status, 409);
});

test("public booking that wins before direct Slot mutation cannot be overwritten", async () => {
  const slot = await Slot.create(availableSlot());
  const originalFindOneAndUpdate = Slot.findOneAndUpdate;
  let bookingResponse;
  let injected = false;

  Slot.findOneAndUpdate = async function (filter, ...args) {
    if (!injected && filter?._id?.toString() === slot._id.toString() && filter.appointmentId === null) {
      injected = true;
      Slot.findOneAndUpdate = originalFindOneAndUpdate;
      bookingResponse = await bookSlot(slot._id);
    }
    return originalFindOneAndUpdate.call(this, filter, ...args);
  };

  try {
    const adminResponse = await request(app)
      .patch(`/api/admin/slots/${slot._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isOpen: false, status: "closed" });

    assert.equal(bookingResponse.status, 201);
    assert.equal(adminResponse.status, 409);
    assert.deepEqual(adminResponse.body, {
      message: "Slot ownership changed; refresh and try again"
    });

    const bookedSlot = await Slot.findById(slot._id);
    assert.equal(bookedSlot.isOpen, false);
    assert.equal(bookedSlot.status, "booked");
    assert.equal(bookedSlot.appointmentId.toString(), bookingResponse.body.appointment._id);
    assert.equal(await Appointment.countDocuments({ slotId: slot._id }), 1);
  } finally {
    Slot.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("startSession failure returns a safe 500 without database mutation", async () => {
  const slot = await Slot.create(availableSlot());
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => {
    throw new Error("sensitive simulated database detail");
  };

  try {
    const response = await bookSlot(slot._id);

    assert.equal(response.status, 500);
    assert.equal(response.body.message, "Failed to create appointment");
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive simulated database detail/);
    assert.equal(await Appointment.countDocuments(), 0);
    assert.deepEqual((await Slot.findById(slot._id)).toObject(), slot.toObject());
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("endSession failure does not replace a successful booking response", async () => {
  const slot = await Slot.create(availableSlot());
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async (...args) => {
    const session = await originalStartSession.call(mongoose, ...args);
    const originalEndSession = session.endSession.bind(session);
    session.endSession = async () => {
      await originalEndSession();
      throw new Error("simulated cleanup failure");
    };
    return session;
  };

  try {
    const response = await bookSlot(slot._id);

    assert.equal(response.status, 201);
    assert.equal(await Appointment.countDocuments({ slotId: slot._id }), 1);
    const bookedSlot = await Slot.findById(slot._id);
    assert.equal(bookedSlot.status, "booked");
    assert.equal(bookedSlot.isOpen, false);
    assert.equal(bookedSlot.appointmentId.toString(), response.body.appointment._id);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("cancellation preserves history and allows a new Appointment to rebook the Slot", async () => {
  const slot = await Slot.create(availableSlot());
  const firstBooking = await bookSlot(slot._id);
  const firstAppointmentId = firstBooking.body.appointment._id;

  const cancellation = await request(app)
    .patch(`/api/admin/appointments/${firstAppointmentId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "cancelled" });
  assert.equal(cancellation.status, 200);

  const releasedSlot = await Slot.findById(slot._id);
  assert.equal(releasedSlot.isOpen, true);
  assert.equal(releasedSlot.status, "available");
  assert.equal(releasedSlot.appointmentId, null);

  const secondBooking = await bookSlot(slot._id, { clientName: "Second booking" });
  assert.equal(secondBooking.status, 201);
  assert.notEqual(secondBooking.body.appointment._id, firstAppointmentId);

  const firstAppointment = await Appointment.findById(firstAppointmentId);
  const secondAppointment = await Appointment.findById(secondBooking.body.appointment._id);
  const rebookedSlot = await Slot.findById(slot._id);
  assert.equal(firstAppointment.status, "cancelled");
  assert.equal(firstAppointment.slotId.toString(), slot._id.toString());
  assert.equal(secondAppointment.status, "pending");
  assert.equal(rebookedSlot.appointmentId.toString(), secondAppointment._id.toString());
});

test("partial unique index rejects every pair of active Appointments for one Slot", async () => {
  const indexes = await Appointment.collection.indexes();
  const activeSlotIndex = indexes.find((index) => index.key?.slotId === 1);
  assert.equal(activeSlotIndex.unique, true);
  assert.deepEqual(activeSlotIndex.partialFilterExpression, {
    status: { $in: ["pending", "confirmed"] }
  });

  const pairs = [
    ["pending", "pending"],
    ["pending", "confirmed"],
    ["confirmed", "confirmed"]
  ];

  for (let index = 0; index < pairs.length; index += 1) {
    const slot = await Slot.create({
      ...availableSlot(),
      date: `2099-02-0${index + 1}`
    });
    const [firstStatus, secondStatus] = pairs[index];
    await Appointment.create({ ...bookingPayload(slot._id), status: firstStatus });

    await assert.rejects(
      Appointment.create({ ...bookingPayload(slot._id), status: secondStatus }),
      (error) => error?.code === 11000
    );
    assert.equal(await Appointment.countDocuments({ slotId: slot._id }), 1);
  }
});

test("partial unique index permits cancelled history with one active Appointment", async () => {
  const pendingSlot = await Slot.create({ ...availableSlot(), date: "2099-03-01" });
  await Appointment.create({ ...bookingPayload(pendingSlot._id), status: "cancelled" });
  await Appointment.create({ ...bookingPayload(pendingSlot._id), status: "pending" });
  assert.equal(await Appointment.countDocuments({ slotId: pendingSlot._id }), 2);

  const confirmedSlot = await Slot.create({ ...availableSlot(), date: "2099-03-02" });
  await Appointment.create({ ...bookingPayload(confirmedSlot._id), status: "cancelled" });
  await Appointment.create({ ...bookingPayload(confirmedSlot._id), status: "confirmed" });
  assert.equal(await Appointment.countDocuments({ slotId: confirmedSlot._id }), 2);

  const historySlot = await Slot.create({ ...availableSlot(), date: "2099-03-03" });
  await Appointment.create({ ...bookingPayload(historySlot._id), status: "cancelled" });
  await Appointment.create({ ...bookingPayload(historySlot._id), status: "cancelled" });
  assert.equal(await Appointment.countDocuments({ slotId: historySlot._id }), 2);
});

test("day opening does not reopen a Slot with an Appointment owner", async () => {
  const slot = await Slot.create({ ...availableSlot(), isOpen: false, status: "closed" });
  const owner = await Appointment.create({
    ...bookingPayload(slot._id),
    status: "cancelled"
  });
  await Slot.findByIdAndUpdate(slot._id, { appointmentId: owner._id });

  const response = await request(app)
    .patch(`/api/admin/slots/day/${slot.date}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ action: "open" });

  assert.equal(response.status, 200);
  const unchangedSlot = await Slot.findById(slot._id);
  assert.equal(unchangedSlot.isOpen, false);
  assert.equal(unchangedSlot.status, "closed");
  assert.equal(unchangedSlot.appointmentId.toString(), owner._id.toString());
});

test("public booking that wins during day opening remains canonical and owned", async () => {
  const slot = await Slot.create(availableSlot());
  const originalUpdateOne = Slot.updateOne;
  let bookingResponse;
  let injected = false;

  Slot.updateOne = async function (filter, ...args) {
    if (
      !injected &&
      filter?.date === slot.date &&
      filter?.startTime === slot.startTime &&
      filter.appointmentId === null
    ) {
      injected = true;
      Slot.updateOne = originalUpdateOne;
      bookingResponse = await bookSlot(slot._id);
    }
    return originalUpdateOne.call(this, filter, ...args);
  };

  try {
    const response = await request(app)
      .patch(`/api/admin/slots/day/${slot.date}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "open", times: [{ startTime: slot.startTime, endTime: slot.endTime }] });

    assert.equal(bookingResponse.status, 201);
    assert.equal(response.status, 200);

    const bookedSlot = await Slot.findById(slot._id);
    assert.equal(bookedSlot.isOpen, false);
    assert.equal(bookedSlot.status, "booked");
    assert.equal(bookedSlot.appointmentId.toString(), bookingResponse.body.appointment._id);
    assert.equal(await Slot.countDocuments({ date: slot.date, startTime: slot.startTime }), 1);
    assert.equal(await Appointment.countDocuments({ slotId: slot._id }), 1);
  } finally {
    Slot.updateOne = originalUpdateOne;
  }
});

test("day opening does not swallow an unrelated duplicate-key error", async () => {
  const slot = await Slot.create(availableSlot());
  const originalUpdateOne = Slot.updateOne;
  Slot.updateOne = async () => {
    const error = new Error("sensitive unrelated unique-index detail");
    error.code = 11000;
    error.keyPattern = { unrelatedField: 1 };
    error.keyValue = { unrelatedField: "collision" };
    throw error;
  };

  try {
    const response = await request(app)
      .patch(`/api/admin/slots/day/${slot.date}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "open", times: [{ startTime: slot.startTime, endTime: slot.endTime }] });

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { message: "Failed to update day slots" });
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive|unique-index|collision/);
    assert.deepEqual((await Slot.findById(slot._id)).toObject(), slot.toObject());
  } finally {
    Slot.updateOne = originalUpdateOne;
  }
});

test("day opening fails closed for an ambiguous duplicate-key error", async () => {
  const slot = await Slot.create(availableSlot());
  const originalUpdateOne = Slot.updateOne;
  Slot.updateOne = async () => {
    const error = new Error("sensitive ambiguous duplicate detail");
    error.code = 11000;
    throw error;
  };

  try {
    const response = await request(app)
      .patch(`/api/admin/slots/day/${slot.date}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "open", times: [{ startTime: slot.startTime, endTime: slot.endTime }] });

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { message: "Failed to update day slots" });
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive|ambiguous|duplicate/);
    assert.deepEqual((await Slot.findById(slot._id)).toObject(), slot.toObject());
  } finally {
    Slot.updateOne = originalUpdateOne;
  }
});

test("day opening fails closed when canonical duplicate keyValue is missing", async () => {
  const slot = await Slot.create({
    ...availableSlot(),
    isOpen: false,
    status: "closed"
  });
  const historicalAppointment = await Appointment.create({
    ...bookingPayload(slot._id),
    status: "cancelled"
  });
  const originalSlot = slot.toObject();
  const originalAppointment = historicalAppointment.toObject();
  const originalUpdateOne = Slot.updateOne;
  Slot.updateOne = async () => {
    const error = new Error("sensitive missing keyValue database detail");
    error.code = 11000;
    error.keyPattern = { date: 1, startTime: 1 };
    throw error;
  };

  try {
    const response = await request(app)
      .patch(`/api/admin/slots/day/${slot.date}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "open", times: [{ startTime: slot.startTime, endTime: slot.endTime }] });

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { message: "Failed to update day slots" });
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive|keyValue|database|11000/);
    assert.deepEqual((await Slot.findById(slot._id)).toObject(), originalSlot);
    assert.deepEqual((await Appointment.findById(historicalAppointment._id)).toObject(), originalAppointment);
  } finally {
    Slot.updateOne = originalUpdateOne;
  }
});

test("range opening fails closed when canonical duplicate keyValue conflicts", async () => {
  const slot = await Slot.create({
    ...availableSlot(),
    date: "2099-01-05",
    isOpen: false,
    status: "closed"
  });
  const historicalAppointment = await Appointment.create({
    ...bookingPayload(slot._id),
    status: "cancelled"
  });
  const originalSlot = slot.toObject();
  const originalAppointment = historicalAppointment.toObject();
  const originalUpdateOne = Slot.updateOne;
  Slot.updateOne = async () => {
    const error = new Error("sensitive conflicting keyValue database detail");
    error.code = 11000;
    error.keyPattern = { date: 1, startTime: 1 };
    error.keyValue = { date: "2099-01-04", startTime: "15:30" };
    throw error;
  };

  try {
    const response = await request(app)
      .post("/api/admin/slots/open-range")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        startDate: slot.date,
        endDate: slot.date,
        times: [{ startTime: slot.startTime, endTime: slot.endTime }]
      });

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { message: "Failed to open slots" });
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive|keyValue|database|11000/);
    assert.deepEqual((await Slot.findById(slot._id)).toObject(), originalSlot);
    assert.deepEqual((await Appointment.findById(historicalAppointment._id)).toObject(), originalAppointment);
  } finally {
    Slot.updateOne = originalUpdateOne;
  }
});

test("repeated direct and day Slot mutations are safe, scoped, and preserve history", async () => {
  const target = await Slot.create(availableSlot());
  const other = await Slot.create({ ...availableSlot(), date: "2099-01-02" });
  const historicalAppointment = await Appointment.create({
    ...bookingPayload(target._id),
    status: "cancelled"
  });
  const authorization = { Authorization: `Bearer ${adminToken}` };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const direct = await request(app)
      .patch(`/api/admin/slots/${target._id}`)
      .set(authorization)
      .send({ isOpen: false, status: "closed" });
    assert.equal(direct.status, 200);
  }

  for (const action of ["close", "close", "open", "open"]) {
    const day = await request(app)
      .patch(`/api/admin/slots/day/${target.date}`)
      .set(authorization)
      .send({
        action,
        times: [{ startTime: target.startTime, endTime: target.endTime }]
      });
    assert.equal(day.status, 200);
  }

  const finalTarget = await Slot.findById(target._id);
  const unchangedOther = await Slot.findById(other._id);
  assert.equal(finalTarget.isOpen, true);
  assert.equal(finalTarget.status, "available");
  assert.equal(finalTarget.appointmentId, null);
  assert.equal(unchangedOther.isOpen, true);
  assert.equal(unchangedOther.status, "available");
  assert.equal(await Slot.countDocuments({ date: target.date, startTime: target.startTime }), 1);
  assert.equal(await Appointment.countDocuments({ _id: historicalAppointment._id, status: "cancelled" }), 1);
});

test("day closing does not close a Slot with an Appointment owner", async () => {
  const slot = await Slot.create(availableSlot());
  const owner = await Appointment.create({
    ...bookingPayload(slot._id),
    status: "cancelled"
  });
  await Slot.findByIdAndUpdate(slot._id, { appointmentId: owner._id });

  const response = await request(app)
    .patch(`/api/admin/slots/day/${slot.date}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ action: "close" });

  assert.equal(response.status, 200);
  const unchangedSlot = await Slot.findById(slot._id);
  assert.equal(unchangedSlot.isOpen, true);
  assert.equal(unchangedSlot.status, "available");
  assert.equal(unchangedSlot.appointmentId.toString(), owner._id.toString());
});

test("Appointment status transition matrix permits only the established lifecycle", async () => {
  const allowed = [
    ["pending", "confirmed"],
    ["pending", "cancelled"],
    ["confirmed", "cancelled"]
  ];

  for (let index = 0; index < allowed.length; index += 1) {
    const [from, to] = allowed[index];
    const slot = await Slot.create({ ...availableSlot(), date: `2099-04-0${index + 1}` });
    const appointment = await Appointment.create({ ...bookingPayload(slot._id), status: from });
    await Slot.findByIdAndUpdate(slot._id, {
      isOpen: false,
      status: "booked",
      appointmentId: appointment._id
    });

    const response = await request(app)
      .patch(`/api/admin/appointments/${appointment._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: to });
    assert.equal(response.status, 200);
    assert.equal((await Appointment.findById(appointment._id)).status, to);
  }

  const rejected = [
    ["confirmed", "pending"],
    ["cancelled", "pending"],
    ["cancelled", "confirmed"]
  ];

  for (let index = 0; index < rejected.length; index += 1) {
    const [from, to] = rejected[index];
    const slot = await Slot.create({ ...availableSlot(), date: `2099-05-0${index + 1}` });
    const appointment = await Appointment.create({ ...bookingPayload(slot._id), status: from });
    if (from !== "cancelled") {
      await Slot.findByIdAndUpdate(slot._id, {
        isOpen: false,
        status: "booked",
        appointmentId: appointment._id
      });
    }

    const response = await request(app)
      .patch(`/api/admin/appointments/${appointment._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: to });
    assert.equal(response.status, 409);
    assert.equal((await Appointment.findById(appointment._id)).status, from);
  }

  for (let index = 0; index < ["pending", "confirmed", "cancelled"].length; index += 1) {
    const status = ["pending", "confirmed", "cancelled"][index];
    const slot = await Slot.create({ ...availableSlot(), date: `2099-05-1${index}` });
    const appointment = await Appointment.create({ ...bookingPayload(slot._id), status });
    if (status !== "cancelled") {
      await Slot.findByIdAndUpdate(slot._id, {
        isOpen: false,
        status: "booked",
        appointmentId: appointment._id
      });
    }

    const response = await request(app)
      .patch(`/api/admin/appointments/${appointment._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status });
    assert.equal(response.status, 200);
    assert.equal((await Appointment.findById(appointment._id)).status, status);
  }
});

test("cancelled Appointment cannot reactivate after its Slot is rebooked", async () => {
  const slot = await Slot.create(availableSlot());
  const firstBooking = await bookSlot(slot._id);
  const oldAppointmentId = firstBooking.body.appointment._id;
  await request(app)
    .patch(`/api/admin/appointments/${oldAppointmentId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "cancelled" });
  const secondBooking = await bookSlot(slot._id, { clientName: "Current owner" });

  for (const status of ["pending", "confirmed"]) {
    const response = await request(app)
      .patch(`/api/admin/appointments/${oldAppointmentId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status });
    assert.equal(response.status, 409);
  }

  const currentSlot = await Slot.findById(slot._id);
  assert.equal(currentSlot.appointmentId.toString(), secondBooking.body.appointment._id);
  assert.equal((await Appointment.findById(oldAppointmentId)).status, "cancelled");
});

test("openRangeSlots handles canonical retries but exposes unrelated failures safely", async () => {
  const payload = {
    startDate: "2099-06-01",
    endDate: "2099-06-01",
    times: [{ startTime: "08:00", endTime: "09:30" }]
  };
  const first = await request(app)
    .post("/api/admin/slots/open-range")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(payload);
  const duplicate = await request(app)
    .post("/api/admin/slots/open-range")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(payload);
  assert.equal(first.status, 200);
  assert.equal(first.body.createdCount, 1);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.createdCount, 0);

  const originalUpdateOne = Slot.updateOne;
  Slot.updateOne = async () => {
    throw new Error("sensitive simulated database failure");
  };
  try {
    const failure = await request(app)
      .post("/api/admin/slots/open-range")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...payload, startDate: "2099-06-02", endDate: "2099-06-02" });
    assert.equal(failure.status, 500);
    assert.equal(failure.body.message, "Failed to open slots");
    assert.doesNotMatch(JSON.stringify(failure.body), /sensitive simulated database failure/);
  } finally {
    Slot.updateOne = originalUpdateOne;
  }
});

test("bulk range close is retry-safe and preserves booked ownership and appointment history", async () => {
  const available = await Slot.create({ ...availableSlot(), date: "2099-07-01" });
  const closed = await Slot.create({
    ...availableSlot(),
    date: "2099-07-02",
    isOpen: false,
    status: "closed"
  });
  const booked = await Slot.create({
    ...availableSlot(),
    date: "2099-07-03",
    isOpen: false,
    status: "booked"
  });
  const outside = await Slot.create({ ...availableSlot(), date: "2099-07-04" });
  const appointment = await Appointment.create({
    ...bookingPayload(booked._id),
    status: "confirmed"
  });
  await Slot.findByIdAndUpdate(booked._id, { appointmentId: appointment._id });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(app)
      .patch("/api/admin/slots/close-range")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ startDate: "2099-07-01", endDate: "2099-07-03" });
    assert.equal(response.status, 200);
  }

  const [updatedAvailable, updatedClosed, updatedBooked, unchangedOutside] = await Promise.all([
    Slot.findById(available._id),
    Slot.findById(closed._id),
    Slot.findById(booked._id),
    Slot.findById(outside._id)
  ]);

  assert.equal(updatedAvailable.isOpen, false);
  assert.equal(updatedAvailable.status, "closed");
  assert.equal(updatedClosed.isOpen, false);
  assert.equal(updatedClosed.status, "closed");
  assert.equal(updatedBooked.isOpen, false);
  assert.equal(updatedBooked.status, "booked");
  assert.equal(updatedBooked.appointmentId.toString(), appointment._id.toString());
  assert.equal(unchangedOutside.isOpen, true);
  assert.equal(unchangedOutside.status, "available");
  assert.equal((await Appointment.findById(appointment._id)).status, "confirmed");
});

test("public booking rejects missing, whitespace, wrong-type, and unknown input before mutation", async () => {
  const slot = await Slot.create(availableSlot());
  const missingBody = await request(app).post("/api/appointments");
  const arrayBody = await request(app).post("/api/appointments").send([]);
  const nullBody = await request(app)
    .post("/api/appointments")
    .set("Content-Type", "application/json")
    .send("null");
  assert.equal(missingBody.status, 400);
  assert.equal(arrayBody.status, 400);
  assert.equal(nullBody.status, 400);

  const invalidPayloads = [
    {},
    bookingPayload(slot._id.toString(), { clientName: "   " }),
    bookingPayload(slot._id.toString(), { clientName: 123 }),
    bookingPayload(slot._id.toString(), { clientPhone: true }),
    bookingPayload(slot._id.toString(), { treatment: ["invalid"] }),
    bookingPayload(slot._id.toString(), { notes: { nested: true } }),
    { ...bookingPayload(slot._id.toString()), unexpected: true }
  ];

  for (const payload of invalidPayloads) {
    const response = await request(app).post("/api/appointments").send(payload);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { message: "Invalid request" });
  }

  assert.equal(await Appointment.countDocuments(), 0);
  assert.deepEqual((await Slot.findById(slot._id)).toObject(), slot.toObject());
});

test("public booking validates identifiers, enums, lengths, and phone characters", async () => {
  const slot = await Slot.create(availableSlot());
  const cases = [
    bookingPayload("not-an-object-id"),
    bookingPayload(slot._id.toString(), { lang: "en" }),
    bookingPayload(slot._id.toString(), { clientName: "x".repeat(LIMITS.clientName + 1) }),
    bookingPayload(slot._id.toString(), { notes: "x".repeat(LIMITS.notes + 1) }),
    bookingPayload(slot._id.toString(), { clientPhone: "555<script>" })
  ];

  for (const payload of cases) {
    const response = await request(app).post("/api/appointments").send(payload);
    assert.equal(response.status, 400);
  }

  const nonexistent = new mongoose.Types.ObjectId().toString();
  assert.equal((await bookSlot(nonexistent)).status, 409);
  assert.equal(await Appointment.countDocuments(), 0);
  assert.equal((await Slot.findById(slot._id)).status, "available");
});

test("public booking preserves trimming, optional defaults, and current frontend treatments", async () => {
  const slot = await Slot.create(availableSlot());
  const response = await request(app).post("/api/appointments").send({
    slotId: slot._id.toString(),
    clientName: "  Valid Client  ",
    clientPhone: " +972 (50) 123-4567 ",
    treatment: "بديكير طبي"
  });

  assert.equal(response.status, 201);
  const appointment = await Appointment.findById(response.body.appointment._id);
  assert.equal(appointment.clientName, "Valid Client");
  assert.equal(appointment.clientPhone, "+972 (50) 123-4567");
  assert.equal(appointment.treatment, "بديكير طبي");
  assert.equal(appointment.notes, "");
  assert.equal(appointment.lang, "he");
});

test("admin login rejects malformed shapes before MongoDB and bcrypt", async () => {
  const passwordHash = await bcrypt.hash("valid-password", 4);
  await AdminUser.create({ username: "admin", passwordHash });
  const invalidBodies = [
    {},
    { username: "   ", password: "valid-password" },
    { username: { $ne: null }, password: "valid-password" },
    { username: "admin", password: { $ne: null } },
    { username: "admin", password: ["valid-password"] },
    { username: "admin", password: 123 },
    { username: "x".repeat(LIMITS.username + 1), password: "valid-password" },
    { username: "admin", password: "x".repeat(LIMITS.password + 1) }
  ];

  for (const body of invalidBodies) {
    const response = await request(app).post("/api/admin/login").send(body);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { message: "Invalid request" });
  }

  const unknown = await request(app)
    .post("/api/admin/login")
    .send({ username: "unknown", password: "wrong" });
  const wrongPassword = await request(app)
    .post("/api/admin/login")
    .send({ username: "admin", password: "wrong" });
  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(unknown.body, wrongPassword.body);
});

test("date validators accept real and leap-year dates and reject impossible formats", async () => {
  assert.equal((await request(app).get("/api/slots?from=2028-02-29&to=2028-02-29")).status, 200);

  for (const date of ["2026-02-30", "2026-13-01", "20/09/2026", "2027-02-29"] ) {
    const response = await request(app).get(`/api/slots?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`);
    assert.equal(response.status, 400);
  }
});

test("public and admin queries reject one-sided, duplicate, and malformed scalar values", async () => {
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const requests = [
    request(app).get("/api/slots?from=2026-01-01"),
    request(app).get("/api/slots?from=2026-01-01&from=2026-01-02&to=2026-01-03"),
    request(app).get("/api/slots?from=2026-01-01&to=2026-01-02&to=2026-01-03"),
    request(app).get("/api/admin/month?month=2026-01&month=2026-02").set(authorization),
    request(app).get("/api/admin/month?month=2026-13").set(authorization),
    request(app).get("/api/admin/slots?date=2026-01-01&date=2026-01-02").set(authorization)
  ];

  for (const pendingRequest of requests) {
    const response = await pendingRequest;
    assert.equal(response.status, 400);
  }
});

test("range validation accepts the UI maximum and rejects unsafe ranges and time arrays", async () => {
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const maximum = await request(app)
    .post("/api/admin/slots/open-range")
    .set(authorization)
    .send({ startDate: "2099-07-01", endDate: "2099-07-31" });
  assert.equal(MAX_RANGE_DAYS, 31);
  assert.equal(maximum.status, 200);

  const tooManyTimes = Array.from({ length: MAX_TIMES_PER_DAY + 1 }, (_, index) => ({
    startTime: `${String(index).padStart(2, "0")}:00`,
    endTime: `${String(index).padStart(2, "0")}:30`
  }));
  const invalidBodies = [
    { startDate: "2099-08-02", endDate: "2099-08-01" },
    { startDate: "2099-08-01", endDate: "2099-08-31" + "x" },
    { startDate: "2099-08-01", endDate: "2099-09-01" },
    { startDate: "2099-08-01", endDate: "2099-08-01", times: [] },
    { startDate: "2099-08-01", endDate: "2099-08-01", times: tooManyTimes },
    { startDate: "2099-08-01", endDate: "2099-08-01", times: [{ startTime: "24:00", endTime: "25:99" }] },
    { startDate: "2099-08-01", endDate: "2099-08-01", times: [{ startTime: "09:30", endTime: "09:30" }] },
    { startDate: "2099-08-01", endDate: "2099-08-01", times: [{ startTime: "10:00", endTime: "09:30" }] },
    {
      startDate: "2099-08-01",
      endDate: "2099-08-01",
      times: [
        { startTime: "08:00", endTime: "09:00" },
        { startTime: "08:00", endTime: "09:00" }
      ]
    },
    { startDate: "2099-08-01", endDate: "2099-08-01", times: [{ startTime: "08:00" }] }
  ];

  for (const body of invalidBodies) {
    const response = await request(app).post("/api/admin/slots/open-range").set(authorization).send(body);
    assert.equal(response.status, 400);
  }
});

test("day slot validation enforces dates and semantic time intervals", async () => {
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const valid = await request(app)
    .patch("/api/admin/slots/day/2099-09-01")
    .set(authorization)
    .send({ action: "open", times: [{ startTime: "00:00", endTime: "23:59" }] });
  assert.equal(valid.status, 200);

  const invalidDate = await request(app)
    .patch("/api/admin/slots/day/2099-02-30")
    .set(authorization)
    .send({ action: "open" });
  const malformedTime = await request(app)
    .patch("/api/admin/slots/day/2099-09-02")
    .set(authorization)
    .send({ action: "open", times: [{ startTime: "9:5", endTime: "10:00" }] });
  assert.equal(invalidDate.status, 400);
  assert.equal(malformedTime.status, 400);
});

test("ObjectId routes reject malformed IDs and preserve 404 for valid nonexistent IDs", async () => {
  const authorization = { Authorization: `Bearer ${adminToken}` };
  assert.equal(
    (await request(app).patch("/api/admin/slots/not-an-id").set(authorization).send({ status: "closed" })).status,
    400
  );
  assert.equal(
    (await request(app).patch("/api/admin/appointments/not-an-id").set(authorization).send({ status: "cancelled" })).status,
    400
  );

  const nonexistent = new mongoose.Types.ObjectId();
  assert.equal(
    (await request(app).patch(`/api/admin/slots/${nonexistent}`).set(authorization).send({ status: "closed" })).status,
    404
  );
  assert.equal(
    (await request(app).patch(`/api/admin/appointments/${nonexistent}`).set(authorization).send({ status: "cancelled" })).status,
    404
  );
});

test("PATCH contracts reject empty bodies, wrong types, invalid states, and unknown fields", async () => {
  const slot = await Slot.create(availableSlot());
  const appointment = await Appointment.create(bookingPayload(slot._id));
  const authorization = { Authorization: `Bearer ${adminToken}` };
  const requests = [
    request(app).patch(`/api/admin/slots/${slot._id}`).set(authorization).send({}),
    request(app).patch(`/api/admin/slots/${slot._id}`).set(authorization).send({ isOpen: "false" }),
    request(app).patch(`/api/admin/slots/${slot._id}`).set(authorization).send({ status: "booked" }),
    request(app).patch(`/api/admin/slots/${slot._id}`).set(authorization).send({ status: "closed", appointmentId: appointment._id }),
    request(app).patch(`/api/admin/appointments/${appointment._id}`).set(authorization).send({}),
    request(app).patch(`/api/admin/appointments/${appointment._id}`).set(authorization).send({ status: "invalid" }),
    request(app).patch(`/api/admin/appointments/${appointment._id}`).set(authorization).send({ status: "confirmed", slotId: slot._id })
  ];

  for (const pendingRequest of requests) {
    const response = await pendingRequest;
    assert.equal(response.status, 400);
  }
});

test("JSON parser returns sanitized JSON for malformed and oversized payloads", async () => {
  const malformed = await request(app)
    .post("/api/appointments")
    .set("Content-Type", "application/json")
    .send('{"slotId":');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers["content-type"].startsWith("application/json"), true);
  assert.deepEqual(malformed.body, { message: "Malformed JSON" });

  const oversized = await request(app)
    .post("/api/appointments")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ value: "x".repeat(33 * 1024) }));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers["content-type"].startsWith("application/json"), true);
  assert.deepEqual(oversized.body, { message: "Request body is too large" });
  assert.doesNotMatch(JSON.stringify([malformed.body, oversized.body]), /SyntaxError|stack|Mongoose|MongoDB/);
});
