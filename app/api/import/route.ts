import { getUser } from "@/lib/auth";
import { runImport, type ImportOutcome } from "@/lib/import/run";

export const maxDuration = 300;

/** 20MB per upload — beyond this it should go to blob storage first. */
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  // A Samsung Health export is a folder of forty CSVs rather than one archive,
  // so accept a whole selection, not just the first file.
  const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_BYTES) {
    return Response.json(
      {
        error: `That is ${(total / 1e6).toFixed(1)}MB across ${files.length} file${
          files.length === 1 ? "" : "s"
        }; the limit is ${MAX_BYTES / 1e6}MB. Zip the export, or upload it in batches.`,
      },
      { status: 413 },
    );
  }

  const outcomes: ImportOutcome[] = [];
  const failures: { filename: string; error: string }[] = [];

  for (const file of files) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      outcomes.push(
        ...(await runImport({
          userId: user.id,
          timezone: user.timezone,
          filename: file.name,
          data,
        })),
      );
    } catch (error) {
      // One bad file in a forty-file export should not discard the other
      // thirty-nine; report it alongside what did work.
      failures.push({ filename: file.name, error: messageOf(error) });
    }
  }

  if (outcomes.length === 0) {
    return Response.json(
      { error: failures[0]?.error ?? "Nothing in this upload could be converted." },
      { status: 400 },
    );
  }

  return Response.json({ outcomes, failures });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
