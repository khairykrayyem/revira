const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const adminLoginRequest = async (username, password) => {
  const response = await fetch(`${API_BASE_URL}/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Login failed");
  }

  return data;
};

export const openRangeSlotsRequest = async (token, payload) => {
  const response = await fetch(`${API_BASE_URL}/admin/slots/open-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to open slots");
  }

  return data;
};

export const updateDaySlotsRequest = async (token, date, action) => {
  const response = await fetch(`${API_BASE_URL}/admin/slots/day/${date}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to update day slots");
  }

  return data;
};

export const getMonthOverviewRequest = async (token, month) => {
  const response = await fetch(`${API_BASE_URL}/admin/month?month=${month}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch month overview");
  }

  return data;
};

export const getDaySlotsRequest = async (token, date) => {
  const response = await fetch(`${API_BASE_URL}/admin/slots?date=${date}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch day slots");
  }

  return data;
};

export const updateSlotRequest = async (token, slotId, payload) => {
  const response = await fetch(`${API_BASE_URL}/admin/slots/${slotId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to update slot");
  }

  return data;
};

export const getAppointmentsRequest = async (token) => {
  const response = await fetch(`${API_BASE_URL}/admin/appointments`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch appointments");
  }

  return data;
};

export const updateAppointmentRequest = async (token, appointmentId, status) => {
  const response = await fetch(`${API_BASE_URL}/admin/appointments/${appointmentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to update appointment");
  }

  return data;
};