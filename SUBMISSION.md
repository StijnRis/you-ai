# YouAI: hackathon submission

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

YouAI is for data-driven people who already track their life in many apps: commits on GitHub, meetings in a calendar, sleep and steps on a watch. Each app only shows its own data. None of them can tell you whether meeting-heavy days hurt your focus the next day, because the answer sits between two sources. Today these people guess, or export CSVs into a spreadsheet and give up after a weekend.

YouAI puts everything on one timeline. It connects to GitHub, calendars, Spotify, weather, Apple Health, Google Fit and Samsung Health, and it imports any other export too. Under the GDPR every service has to let you download your data, so an LLM reads the CSV files in the export and maps each column to our database. Your gym's check-in history or a full Google Takeout works without us writing an integration for it.

Most of your life is already tracked, so you rarely need to log anything by hand. You might think you have to record what you eat, but Albert Heijn already knows from your loyalty card, and you can export that and import it into YouAI. Your swimming sessions are in your calendar. Your gym logs every visit when you scan your card, and that can be exported too.

YouAI then computes correlations across sources, with time lags and a correction for testing many pairs at once. You can open any correlation and see every data point behind it in a graph, so you can check it yourself. You can also ask questions in chat, and the answers use your own numbers.

Experiments turn a finding into a change. Say you're tired every evening. The AI looks at your data, searches the web, finds that a cold shower in the morning may help, and sets up an experiment for the next few weeks. Afterwards the dashboard compares your mood, steps and other metrics with the weeks before. Mood comes from your smartwatch, or you enter it by hand; manual entries have their own overview.

The code is open source and anyone can host it, so people pay us for convenience. There is a free plan with limited AI usage, since AI calls cost us money, and paid tiers above it with a free trial of Pro. Our users can do the maths themselves: if one insight gets them an extra focused hour and their time is worth €40 an hour, that insight has paid for the subscription. Later, coaches, therapists and team-wellbeing programmes could use YouAI with clients who share their data.

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

All AI runs on Nebius Token Factory. Users can pick which open model the agent uses. The default is Qwen3-235B-A22B-Instruct-2507, chosen from the comparison below. It does three jobs:

1. Chat agent. It calls tools on our backend to read your data, find correlations, compare groups, search the web (Nebius's Tavily search API), and create and analyse experiments, with up to 10 tool calls per answer.
2. Reading new file formats. For an export we haven't seen before, it writes a JSON conversion that maps the file onto our metrics, using Token Factory's JSON-schema output. The conversion is saved and reused for later files with the same shape.
3. Experiment verdicts. When an experiment ends, it explains the before/during/after statistics in plain language.

Qwen3-235B-A22B activates about 22B of its 235B parameters per token, so it is cheap enough to run on every chat turn, and it handles tool calls and strict JSON output well. The product uses no closed models, and the statistics are computed in code, not by the model. Outside the product, we used Claude to help write the code and ElevenLabs for the visuals.

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

We measure three things when the same data question is sent to each model:
- **Token usage.** We record input, output and total tokens because this shows how much context each model needs and provides a concrete proxy for usage cost.
- **Execution time.** We record the time from sending the question to receiving the answer because a personal analytics assistant must be fast enough to use interactively.
- **Subjective answer quality.** Two people rate each answer independently on a 1–5 Likert scale. This quantifies the most subjective, but also most important, metric: whether users are actually satisfied with the answer.

These measurements keep the comparison fair: the provider, tools, system prompt, data context and user question stay the same; only the model changes.

**Compared against:** the three open-weight models available in our Nebius Token Factory chat interface:

- **Qwen3-235B-A22B-Instruct-2507** (our primary model)
- **Qwen3-30B-A3B-Instruct-2507** (smaller open-weight baseline)
- **DeepSeek-V4-Flash-0731** (alternative open-weight model)

For the prompt **“What patterns are hiding in my data?”**, the exported chat record contains one run for each model:

| Metric | Qwen3-235B-A22B | Qwen3-30B-A3B | DeepSeek-V4-Flash |
|---|---:|---:|---:|
| Responses evaluated | 1 | 1 | 1 |
| Input tokens | 46,225 | 85,597 | 32,440 |
| Output tokens | 622 | 671 | 874 |
| Total tokens | 46,847 | 86,268 | 33,314 |
| Execution time | 23.230 s | 47.554 s | 33.129 s |
| Person 1 rating | 3/5 | 4/5 | 4/5 |
| Person 2 rating | 3/5 | 3/5 | 5/5 |
| Mean subjective rating | 3.0/5 | 3.5/5 | 4.5/5 |

**Conclusion:** DeepSeek-V4-Flash delivered the highest user-perceived quality (4.5/5), while Qwen3-235B was fastest (23.230 s). The early result shows a clear quality–latency trade-off, so more runs are needed before choosing one overall winner.



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

The hackathon version is a web app because that is what we know best. The product will be local-first: your data stays on your phone, with optional sync to your other devices.

The code is open source and we ship exactly that code, so anyone can check what it does or host it themselves.

In the current app every AI tool is scoped to the signed-in user in server code. The model never sees or passes a user ID, so a prompt can't reach someone else's data. It is told to keep correlation and causation apart and to say when a result isn't significant. Experiment results are labelled as before/after comparisons without a control group. You can disconnect any source, and sample data is marked as such and removed in one click.
