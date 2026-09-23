# YouAI — Hackathon submission

<!--
What did you build, and what problem does it solve? (Required)

Describe the product, the user and the pain. Who is the user, how often do they
hit this problem, what are they doing about it today, and would they pay? Close
with one or two sentences on why this could credibly become a company. Judges
read this before opening your link, so lead with the problem, not the tech.
Criteria: Product and user value, Problem and company potential.

Users: data-driven people who want to optimise their life
-->

## What did you build, and what problem does it solve?

YouAI is for data-driven people: the ones who already track their life in a dozen places: commits on GitHub, meetings in their calendar, music on Spotify, sleep and steps on a watch. Each app shows one slice, and none can answer the questions that matter: *"Why was last week so unproductive?"*, *"Do meeting-heavy days kill my focus the next day?"*, *"Does a late night of coding wreck my mood?"* The answer is almost always in how two sources relate, and no single app sees both.

Today people cope by guessing, or by exporting CSVs into a spreadsheet they abandon after a weekend. The problem isn't occasional. It comes back every week someone feels off and can't say why.

**YouAI** connects those sources (GitHub, any calendar, Spotify, weather, Apple Health, Google Fit, Samsung Health or any file export) into one timeline. It runs proper statistics across them: correlations with time lags and a correction for testing many pairs at once, so random coincidences don't show up as findings. You can ask questions in plain language and get answers grounded in your own numbers. Then it closes the loop with **experiments**: say *"I want to exercise more"*, and the AI researches evidence-backed approaches on the web and proposes a concrete trial ("no meetings before 11 for two weeks"). It tracks your daily check-ins and measures whether your metrics actually moved compared with the weeks before.

Data-driven users already pay for tools that promise a better day (Oura, RescueTime, Notion) and are used to connecting accounts. YouAI is the layer on top that turns all that data into answers and decisions. Personal-data users become the entry point to a B2B product for coaches, therapists and team-wellbeing programmes, where clients share their data with a professional.

<!--
Models and Token Factory use (Required)

Which open models did you run on Nebius Token Factory, and what does each one do
in your product? Name the models (for example Llama 3.3 70B, Qwen, DeepSeek) and
the role each plays: generation, extraction, classification, embeddings, agent
planning. If you used more than one, say why. If you also used a closed model
anywhere, say so and say what for.
Criterion: Technical execution and Token Factory use.
-->

## Models and Token Factory use

All AI in YouAI runs on **Nebius Token Factory** with one open model: **Qwen3-235B-A22B-Instruct-2507**. It fills three roles:

1. **Agent with tools (chat and experiment design).** The model answers questions by calling our tools rather than guessing: list metrics, summarise a series, find correlations, compare groups, search the web (Tavily), and create and analyse experiments. It plans multi-step tool sequences, up to 10 steps per answer.
2. **Structured extraction (reading unknown file formats).** When someone uploads an export we've never seen, the model writes a *conversion* (a JSON description of how that file maps onto our metrics), using Token Factory's JSON-schema-constrained output. The conversion is stored and reused for every later file with the same shape, so each new format reaches the model once.
3. **Writing the experiment verdict.** When an experiment ends, the model turns the computed before/during/after statistics into a plain-language verdict.

We chose one large open model with an efficient design (it only runs about 22B of its 235B parameters for each response) because it handles tool-calling and strict JSON output reliably, and it's cheap enough to run on every chat turn. The model is configurable per deployment from the admin settings, so it can be swapped without code changes. **No closed models are used anywhere.** The statistics themselves are computed in code, not by the model.

<!--
Measurable model advantage (Required)

What did you compare your open-model choice against, and what did you measure?
State the baseline: a closed model such as GPT or Claude, a smaller model, no
model at all, or a previous approach. Then give the numbers on whichever
dimensions apply: output quality, cost per request, latency, control over
behaviour, or how easily you adapted the model to your use case. Paste a link to
proof if you have one, such as an eval sheet, a comparison table or screenshots.
A rough measurement with real numbers scores higher than a polished claim with
none. Criterion: Measurable model advantage.

TODO: fill in the table with real measurements before submitting.
-->

## Measurable model advantage

Two parts of the design are measurable without new testing:
- **Repeat imports are free.** Imports of a format we already know are matched by a fingerprint of the file's shape and cost **0 model tokens**. Only a never-seen format calls the model.
- **The model gets computed statistics, not raw data.** We give it results such as a correlation coefficient, sample size and corrected significance, instead of hundreds of raw daily numbers. That keeps prompts small, and the model doesn't have to spot trends by eye, which is where it would make things up.

**Compared against:** [Llama 3.3 70B on Token Factory / GPT-4o / no model (manual conversion)]

| | Qwen3-235B-A22B (ours) | [baseline] |
|---|---|---|
| Unknown files converted correctly (N test files) | [x/N] | [x/N] |
| Chat questions answered with correct numbers (N questions) | [x/N] | [x/N] |
| Median latency per chat answer | [s] | [s] |
| Cost per 1k chat turns | [$] | [$] |

Proof: [link to sheet/screenshots]

<!--
Responsible design (Required)

How does your product handle safety, privacy or misuse in its context? One or
two sentences is enough. Examples: what personal data you store and why, how you
handle harmful prompts, what a user can do if the model gets it wrong.
Criterion: Responsible design.

Note: connection tokens are currently stored in plain text in the database, so
don't claim encryption unless it's added.
-->

## Responsible design

Every AI tool is scoped to the signed-in user in server code. The model never sees or supplies a user ID, so no prompt can reach another person's data. The model gets aggregated statistics rather than raw records, and it's instructed to separate correlation from causation and to say when a result isn't significant. Experiment results are labelled as before/after comparisons with no control group. Users can disconnect any source, and made-up sample data is clearly marked and deleted with one click.

<!--
Pitch Slides (Required)

Public link to the slides you pitch from if you reach the top 8. We open this
link on the stage computer, no own laptops. Test it in an incognito window.
Cover all six judging criteria, a criterion you skip scores zero. 5 minutes
including live demo.

TODO: paste the public slides link.
-->

## Pitch Slides

Link: [public slides link]

Outline (5 minutes, all criteria covered):

1. **Problem** (≈30 s): "Your data knows why you had a bad week. No app can tell you." Show the scattered apps.
2. **Product and user** (≈30 s): YouAI in one sentence, the target user (data-driven people optimising energy and output), how often they hit the problem.
3. **Live demo** (≈2 min): connect sample data and GitHub, then ask "why are my Mondays unproductive?" → the chat finds a pattern → "design an experiment to fix it" → it researches and creates one.
4. **Tech and Token Factory** (≈40 s): Qwen3-235B in three roles (agent, structured extraction, verdicts); formats recognised once and reused; statistics computed in code, not by the model.
5. **Measured advantage and responsible design** (≈40 s): the comparison table, per-user scoping, correlation-vs-causation guardrails.
6. **Company potential** (≈20 s): consumer entry point → coaches, therapists and team wellbeing as B2B.
