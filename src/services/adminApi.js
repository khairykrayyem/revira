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