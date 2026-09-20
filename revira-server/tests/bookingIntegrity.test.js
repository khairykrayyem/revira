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
import { LIMITS, MAX_RANGE_DAYS, MAX_TIMES_PER_DAY } from "../validation/schemas.js";

const TEST_DATABASE_NAME = "revira_booking_integrity_test";
const CONCURRENT_REQUEST_COUNT = 8;

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

test("openRangeSlots skips duplicate keys but exposes unrelated failures safely", async () => {
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

  const originalCreate = Slot.create;
  Slot.create = async () => {
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
    Slot.create = originalCreate;
  }
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
