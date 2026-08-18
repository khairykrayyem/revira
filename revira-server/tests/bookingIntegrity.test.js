import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import Appointment from "../models/Appointment.js";
import Slot from "../models/Slot.js";
import adminRoutes from "../routes/adminRoutes.js";
import publicRoutes from "../routes/publicRoutes.js";

const TEST_DATABASE_NAME = "revira_booking_integrity_test";
const CONCURRENT_REQUEST_COUNT = 8;

const app = express();
app.use(express.json());
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
  treatment: "Test treatment",
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

  process.env.JWT_SECRET = "booking-integrity-test-only";
  adminToken = jwt.sign({ id: "test-admin" }, process.env.JWT_SECRET);
});

beforeEach(async () => {
  assert.equal(mongoose.connection.db.databaseName, TEST_DATABASE_NAME);
  await Promise.all([Appointment.deleteMany({}), Slot.deleteMany({})]);
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

test("Appointment validation failure rolls back the Slot claim", async () => {
  const slot = await Slot.create(availableSlot());
  const response = await bookSlot(slot._id, { lang: "invalid-language" });

  assert.equal(response.status, 500);
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
  const currentAppointment = await Appointment.create(bookingPayload(slot._id));
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
  const currentAppointment = await Appointment.create(bookingPayload(slot._id));
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
