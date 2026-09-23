import { getUser } from "@/lib/auth";
import { evaluateExperiment } from "@/lib/experiments/evaluate";
import { getExperimentReport, saveEvaluation } from "@/lib/experiments/store";

// A single structured generation over an already-computed brief.
export const maxDuration = 60;

export async function POST(
  _request: Request,
  context: RouteContext<"/api/experiments/[id]/evaluate">,
) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const result = await getExperimentReport(user.id, id, user.timezone);
  if (!result) return Response.json({ error: "Experiment not found" }, { status: 404 });

  // Evaluating something still in progress would read a half-finished window
  // as the result, which is exactly the mistake the phases exist to prevent.
  if (result.phase === "scheduled") {
    return Response.json({ error: "This experiment has not started yet." }, { status: 400 });
  }
  if (result.phase === "running") {
    return Response.json(
      { error: "This experiment is still running. End it early if you want to read the result now." },
      { status: 400 },
    );
  }

  try {
    const evaluation = await evaluateExperiment(result);
    const row = await saveEvaluation(user.id, id, evaluation);
    if (!row) return Response.json({ error: "Experiment not found" }, { status: 404 });
    return Response.json({ evaluation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // No API key configured is a setup problem, not a bad request.
    const status = message.includes("NEBIUS_API_KEY") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
