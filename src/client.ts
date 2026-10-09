const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export async function fetchProperties(search = "") {
  const response = await fetch(`${API_URL}/properties${search ? `?q=${encodeURIComponent(search)}` : ""}`);
  if (!response.ok) throw new Error("Unable to load properties");
  return response.json();
}

export async function createLead(payload: { propertyId: string; buyerName: string; buyerPhone: string; buyerWhatsapp?: string; message?: string }) {
  const response = await fetch(`${API_URL}/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error("Unable to create enquiry");
  return response.json();
}
