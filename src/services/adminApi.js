const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const ADMIN_TOKEN_STORAGE_KEY = "revira_admin_token";
export const ADMIN_SESSION_INVALIDATED_EVENT = "revira:admin-session-invalidated";

const invalidateAdminSession = (token) => {
  if (localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) !== token) return;

  localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(ADMIN_SESSION_INVALIDATED_EVENT));
};

const authenticatedAdminRequest = async (path, token, options = {}, fallbackMessage) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (response.status === 401) {
    invalidateAdminSession(token);
  }

  if (!response.ok) {
    throw new Error(data.message || fallbackMessage);
  }

  return data;
};

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
  return authenticatedAdminRequest("/admin/slots/open-range", token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "Failed to open slots");
};

export const updateDaySlotsRequest = async (token, date, action) => {
  return authenticatedAdminRequest(`/admin/slots/day/${date}`, token, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  }, "Failed to update day slots");
};

export const getMonthOverviewRequest = async (token, month) => {
  return authenticatedAdminRequest(
    `/admin/month?month=${month}`,
    token,
    {},
    "Failed to fetch month overview"
  );
};

export const getDaySlotsRequest = async (token, date) => {
  return authenticatedAdminRequest(
    `/admin/slots?date=${date}`,
    token,
    {},
    "Failed to fetch day slots"
  );
};

export const updateSlotRequest = async (token, slotId, payload) => {
  return authenticatedAdminRequest(`/admin/slots/${slotId}`, token, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "Failed to update slot");
};

export const getAppointmentsRequest = async (token) => {
  return authenticatedAdminRequest(
    "/admin/appointments",
    token,
    {},
    "Failed to fetch appointments"
  );
};

export const updateAppointmentRequest = async (token, appointmentId, status) => {
  return authenticatedAdminRequest(`/admin/appointments/${appointmentId}`, token, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  }, "Failed to update appointment");
};
