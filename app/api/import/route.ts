import { getUser } from "@/lib/auth";
import { runImport } from "@/lib/import/run";
import { getSettings } from "@/lib/settings";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const settings = await getSettings();
  const maxBytes = settings.maxUploadMb * 1024 * 1024;

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return Response.json(
      { error: `File is ${(file.size / 1e6).toFixed(1)}MB; the limit is ${settings.maxUploadMb}MB.` },
      { status: 413 },
    );
  }

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const outcomes = await runImport({
      userId: user.id,
      timezone: user.timezone,
      filename: file.name,
      data,
      allowInference: settings.allowInference,
    });
    return Response.json({ outcomes });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 400 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
