const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const getOpenSlots = async (from, to) => {
  const response = await fetch(`${API_BASE_URL}/slots?from=${from}&to=${to}`);

  if (!response.ok) {
    throw new Error("Failed to fetch slots");
  }

  return response.json();
};

export const createAppointment = async (appointmentData) => {
  const response = await fetch(`${API_BASE_URL}/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(appointmentData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to create appointment");
  }

  return data;
};