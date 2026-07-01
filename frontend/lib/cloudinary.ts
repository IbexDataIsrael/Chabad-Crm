// Cloudinary *signed* image upload. The browser asks our backend to sign the
// upload params (the API secret never leaves the server — see
// backend/app/routers/uploads.py), then POSTs the file straight to Cloudinary
// with that signature. When the cloud name isn't configured, the app degrades
// to pasting an image URL (see LogoUpload).

import { apiFetch } from "@/lib/api";

// cloud_name is public (it appears in every Cloudinary image URL); it only
// gates whether the upload UI is shown. The signing key/secret live server-side.
export const cloudinaryCloudName =
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "";

export const cloudinaryConfigured = Boolean(cloudinaryCloudName);

interface CloudinarySignature {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  folder: string;
  signature: string;
}

/** Upload an image to Cloudinary using a backend-signed request; returns the secure URL. */
export async function uploadToCloudinary(file: File): Promise<string> {
  // 1. Get a one-time signature from our backend (it holds the API secret).
  const sig = await apiFetch<CloudinarySignature>(
    "/api/uploads/cloudinary-signature",
  );

  // 2. POST the file directly to Cloudinary. Every signed param must be echoed
  //    back verbatim or the signature won't validate.
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sig.api_key);
  form.append("timestamp", String(sig.timestamp));
  form.append("folder", sig.folder);
  form.append("signature", sig.signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error?.message || "Cloudinary upload failed");
  }
  const data = await res.json();
  return data.secure_url as string;
}
