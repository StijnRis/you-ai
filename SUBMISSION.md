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

**It imports data from any source.** Under the GDPR, every service that holds your data has to let you export it. YouAI turns that into its data pipeline: drop in any export and an LLM reads every CSV file in it, works out what each column means, and routes it to the right place in our database. No per-app integration is needed. Your local gym's check-in history, your entire Google Takeout, or data from any app that has ever been built can go in, because under the GDPR all of them have to hand it over.

**Experiments turn insights into action.** Want to try something new? Ask the AI what to try. It looks at your data and searches the web for ways to improve. For example, it might see that you're always exhausted in the evening and find evidence that a cold shower in the morning helps. It then creates an experiment ("shower cold every morning for the coming weeks"). You follow it, and afterwards the dashboard shows how it affected everything, from your mood to your step count to whatever else you want to track.

**Mood, synced or manual.** Mood can come from your smartwatch, which measures signals related to it, or you can log it directly in the dashboard. Manual entries have their own overview.

**Every finding is verifiable.** For each correlation it finds, you can see every data point it's based on, with clear graphs, so you can check for yourself what a result rests on instead of taking the AI's word for it.

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

All AI in YouAI runs on **Nebius Token Factory**. You can pick which open model the agent uses, so you can go with the one you prefer. We ran a comparison between models (see below) and configured the winner, **Qwen3-235B-A22B-Instruct-2507**, as the default. It fills three roles:

1. **Agent with tools (chat and experiment design).** The agent works directly against our application backend through tools. It fetches your actual data, creates experiments and can manage everything for you. It answers questions by calling those tools rather than guessing: list metrics, summarise a series, find correlations, compare groups, search the web (Tavily), and create and analyse experiments. It plans multi-step tool sequences, up to 10 steps per answer.
2. **Structured extraction (reading unknown file formats).** When someone uploads an export we've never seen, the model writes a *conversion* (a JSON description of how that file maps onto our metrics), using Token Factory's JSON-schema-constrained output. The conversion is stored and reused for every later file with the same shape, so each new format reaches the model once.
3. **Writing the experiment verdict.** When an experiment ends, the model turns the computed before/during/after statistics into a plain-language verdict.

We chose one large open model with an efficient design (it only runs about 22B of its 235B parameters for each response) because it handles tool-calling and strict JSON output reliably, and it's cheap enough to run on every chat turn. The model can be switched in the settings, so it can be swapped without code changes. **No closed models are used anywhere.** The statistics themselves are computed in code, not by the model.

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

**Your data stays on your device.** We built the hackathon version as a web app because that's what we have the most experience with. The product we're building is local-first: your data lives primarily on your own phone and never leaves it. You can optionally turn on sync between devices to see the same data on your laptop or other phones. Because this is so much personal data, keeping it on your device is the safest default.

**Fully open source.** The repo is public, and we ship exactly that code, so anyone can inspect what we do. If you don't trust us, you can host it yourself, and we have no problem with that.

**Monetisation: pay for convenience.** Since anyone can run it for free, people pay us for convenience, because hardly anyone wants to host it themselves when we can do it for them. We plan several pricing tiers: a fully free plan so people can try it out, with limited AI usage because AI calls cost money, and paid plans with more, including a free trial of Pro.

Every AI tool is scoped to the signed-in user in server code. The model never sees or supplies a user ID, so no prompt can reach another person's data. The model gets aggregated statistics rather than raw records, and it's instructed to separate correlation from causation and to say when a result isn't significant. Experiment results are labelled as before/after comparisons with no control group. Users can disconnect any source, and made-up sample data is clearly marked and deleted with one click.
