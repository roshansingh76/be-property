import { config } from "../config.js";

type Msg91Response = {
  type?: string;
  message?: string;
};

function otpUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(path, config.MSG91_API_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function requestMsg91(url: URL): Promise<Msg91Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("OTP provider request failed");
  }

  let payload: Msg91Response;
  try {
    payload = await response.json() as Msg91Response;
  } catch {
    throw new Error("OTP provider returned an invalid response");
  }

  if (!response.ok) throw new Error(`OTP provider returned HTTP ${response.status}`);
  return payload;
}

export async function sendOtp(phone: string): Promise<void> {
  const url = otpUrl("/api/v5/otp", {
    authkey: config.MSG91_AUTH_KEY!,
    template_id: config.MSG91_OTP_TEMPLATE_ID!,
    mobile: `91${phone}`,
    otp_length: "6",
    otp_expiry: "5",
  });
  const response = await requestMsg91(url);
  if (response.type?.toLowerCase() !== "success") {
    throw new Error("OTP provider rejected the send request");
  }
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const url = otpUrl("/api/v5/otp/verify", {
    authkey: config.MSG91_AUTH_KEY!,
    mobile: `91${phone}`,
    otp: code,
  });
  const response = await requestMsg91(url);
  if (response.type?.toLowerCase() === "success") return true;
  if (response.type?.toLowerCase() === "error") return false;
  throw new Error("OTP provider returned an unexpected verification response");
}
