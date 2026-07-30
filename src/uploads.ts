import { API_BASE_URL } from "./apiConfig";

// A file uploaded straight to Supabase Storage. The signature proves the
// backend issued this path, so the submit endpoint will accept it — see
// server/src/storage.js.
export interface UploadedFile {
  path: string;
  signature: string;
}

interface SignedUpload extends UploadedFile {
  uploadUrl: string;
}

// Uploads bypass our own backend entirely: we ask it for a short-lived signed
// URL, then PUT the file directly to Supabase Storage. This is what keeps large
// license photos working — a request through the backend would hit the hosting
// platform's request body limit (4.5 MB on Vercel).
export async function uploadFile(file: File): Promise<UploadedFile> {
  const response = await fetch(`${API_BASE_URL}/api/onboarding/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Could not prepare the upload for ${file.name}.`);
  }

  const { path, signature, uploadUrl }: SignedUpload = await response.json();

  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });

  if (!upload.ok) {
    throw new Error(
      `Uploading ${file.name} failed (${upload.status}). Please check your connection and try again.`,
    );
  }

  return { path, signature };
}
