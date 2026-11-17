---
name: h3-prompt-writing
description: Plan script-to-action timelines and normalize approved video prompts for MiniMax H3 T2VA, I2VA, FL2VA, and L2VA generation. Use when separating creative planning from H3 prompt formatting, composing integrated_multimodal_description, overall_soundscape, and non_diegetic_music, or aligning keyframes.
---

# H3 Prompt Writing

## Visible performance versus deliberate stillness

Before accepting or reusing Layer 1, identify what a viewer can see change at the planned framing: a motivated gesture, attention shift, contact, reaction, or camera reveal of relevant information. Give that change a visible start and result. A fixed camera does not freeze the actors; quiet mood and stable identity/layout do not require a motionless performance. Background ambience, blinking alone, or an imperceptible drift is not a substitute for the shot's dramatic purpose.

An intentional tableau, still life, freeze frame or sustained pause is valid when its purpose and duration justify the hold. Do not require motion in every shot. Do not treat a legacy “nobody moves” instruction or the word “establishing” alone as that justification. If the canonical action explicitly forbids movement yet provides no coherent hold purpose, surface the planning conflict for upstream correction; do not quietly override it or invent new story events.

Keep any added connective behavior inside the established action and end state. Do not perform the next shot's event early. A preparatory reach can stop beside an object; it must not become the next shot's push, transfer or pickup. Camera movement should reveal relevant information, not conceal missing performance.

Layer 2 must carry the reviewed visible change into detailed action prose. Scope preservation to identity, costume and stable spatial relationships. Never replace a planned action with “remain still”, freeze mutable hands/gaze through retention language, or erase its visible result while shortening. For a deliberate hold, preserve the hold rather than adding compulsory gestures. This is prompt planning evidence, not proof of rendered video quality.

## Two-Layer Operation

This skill has two layers that form one default production pipeline. For a structured shot rewrite, run Layer 1 first and persist its action timeline before Layer 2 writes the H3 prompt. A caller may request only one layer for inspection, but a final H3 prompt must never be produced from an unplanned shot.

### Layer 1: Script-to-Action Planning

Use this layer when the input is a script, storyboard, scene description, or
creative brief and another model needs a concrete video-generation plan.

The goal is to expose creative decisions before prompt writing. Produce an
`action_timeline` that records the effective duration, subjects, objects,
spatial anchors, camera states, sound, and timed physical actions. Each action
must use:

`start_state -> actor/body part -> action/contact/path -> visible result -> exit_state`

The planning model may distribute a script's required actions across time and
may identify missing transitions, but it must not silently remove, simplify, or
replace a requested creative event. Treat a supplied duration as a reference
unless the caller explicitly makes it a hard limit. Derive time from complete
speech, pauses, reactions and necessary actions before deciding shot count.
If content exceeds the caller's single-clip budget, split at complete speech
turns or action results during planning; report the conflict in prompt-only work.

Layer 1 output is planning data, not an H3 prompt. Recommended shape:

```text
creative_intent: ...
duration: ...
subjects_and_objects: ...
world_and_spatial_anchors: ...
action_timeline:
  - time: ...
    start_state: ...
    primary_action: ...
    contact_or_path: ...
    visible_result: ...
    exit_state: ...
    camera_visibility: ...
    sound: ...
continuity_contract: ...
state_ledger: ...
warnings: ...
```

Layer 1 may use the source language. It should use concrete action terms and
explicit time values, but it does not need H3 field names or English section
prose. If another model will consume the result, pass the complete timeline,
continuity contract, and warnings to that model without converting warnings
into silent edits.

The planner should keep 3–5 meaningful primary beats for a normal action shot, fewer for a genuinely simple shot, and one primary physical action per interval where possible. Do not create equal time bins or artificial micro-beats. This is a planning aid, not permission to reduce the action count. Complexity, ambiguity, and competing requirements belong in `warnings`.

### Layer 2: Video-Prompt Normalization

Use this layer when the input is already a video-generation prompt or a Layer
1 `action_timeline`. The goal is to normalize expression for H3 while
preserving the approved creative content.

Layer 2 must:

1. Identify T2VA, I2VA, FL2VA, or L2VA.
2. Read the applicable guide under `references/`.
3. Preserve actions, ordering, camera decisions, effects,
   dialogue, subjects, and objects from the input.
4. Add only the state, continuity, framing, or physical-link details needed to
   make the approved actions unambiguous.
5. Follow the canonical output contract below. Keep the official outer fields
   and their order; inside the visual description, use chronological shot
   blocks and natural timed paragraphs, not a fixed eight-block checklist.

Layer 2 must not invent plot events, delete actions, turn a
requested effect into a different effect, or replace a difficult action with a
safer one. Any unresolved issue is reported separately as a warning.

The normalized H3 prompt is normally written in English, while dialogue,
lyrics, and visible scene text remain in their original language. For structured generation, Layer 2 consumes the approved Layer 1 timeline; it may consume the source prompt directly only when the caller explicitly requests a Layer 2-only rewrite and supplies an already-authoritative action plan. The timeline and state_ledger are the source of truth for creative content. Preserve each resulting state and its duration of validity; normalization
must not turn a mutable state into a permanent identity trait.

### Shared Scope Boundary

This skill is not a scriptwriter, director, video generator, or H3 capability
predictor. It can structure and audit a plan, but it cannot decide the user's
creative tradeoffs. Physical continuity language may clarify a requested
action, but must not become an unrequested creative decision.

When a conflict is found, use:

`[WARNING] requirement A and requirement B may conflict because ...`

Do not use a warning to silently reduce action count, override a hard duration,
remove a camera cut, or replace a requested effect.

## Prompt Priority Order

When requirements compete, use this order: (1) approved facts, exact dialogue and cross-shot continuity; (2) action and interaction that make those facts visible; (3) camera and sound choices that improve readability; (4) reference appearance and product detail; (5) style adjectives, which have the lowest priority. Preserve higher-priority content and simplify or remove lower-priority prose. Never add length to protect a style adjective.

## Declarative Continuity Contract

Continuity in the final prompt must be declarative. When an approved opening state exists or a preceding tail is explicitly selected as the first frame, state exactly what the shot must begin with and what each consequential object, person and spatial relation must do next. Do not use uncertainty or optional language such as “may”, “can reference”, “if available”, “try to”, “keep similar”, “尽量”, or “可能” for a required handoff. If the required reference or state is missing, stop before formatting and report the missing input outside the prompt; never weaken a required continuity constraint inside the prompt. A Ref2VA tail supplied only as optional continuity context does not become a mandatory first frame.

The opening state must be definite, the transition must be visible, and the ending state must be definite. Camera movement after the opening is allowed only when its path and purpose are stated; it must not replace the required opening composition.

## Creative Core and Interface Wrapper

Write the action prose first as the creative core: a subject performs a physical action, the action affects another subject or object, the camera follows the information, and the visible result settles on screen. Only after that prose is coherent should it be placed into the required H3 fields. The six fields are an interface wrapper, not a reason to expose planning language.

Do not put analysis, evaluation or author commentary in the final prompt. Avoid phrases such as “the main visible change is”, “this shows that”, “the relationship is”, “so the viewer understands”, or “the handoff remains unfinished” when the same result can be shown through visible action. Show the result through visible action. Replace interpretation with the image: a hand stops above a card, a gaze returns to the speaker, a shoulder settles, a prop stops under a palm.

## Director Process Layer

Before formatting any H3 fields, describe the shot as a director-readable audiovisual process. This layer is mandatory for complex actions, product demonstrations, dialogue exchanges, and any shot that inherits a prior state; it is intentionally lightweight for a simple shot. The process is not another output schema and must not leak into the final prompt as a checklist.

For each consequential action, resolve this chain privately:

`cause -> physical action -> contact or path -> visible consequence -> resulting state`

The resulting state is the handoff to the next action or the next shot. Carry forward the latest state of each important subject, prop, screen, garment, body posture, hand ownership, and spatial anchor. A new reference image supplies identity or an explicitly bound opening frame; it does not reset a changed state. If the previous shot ends with an object closed, held, removed, or moved, the next shot must open from that state unless an approved visible action changes it.

Use detail where it prevents a likely visual mistake: weight transfer, hand contact, object path, eye-line, listener reaction, spatial crossing, product interaction, and the settle after the final action. Do not inflate simple actions into artificial micro-beats or bind prompt length to duration.

### Interaction-first staging

For interpersonal action, resolve `initiative -> target cue -> response -> consequence` before writing the final prose. Show who initiates, what the other subject can perceive, how that subject visibly responds, and what state or action follows. For dialogue, keep the speaker, listener and visible response together; a line without an affected listener is incomplete when the scene depends on the exchange. Do not describe relationship with adjectives alone. Replace words such as cooperative, tense, hesitant or intimate with gaze, distance, hand movement, interruption, pause, turn-taking and the resulting change.

### Coverage and sound decisions

Choose camera placement and movement from the information the viewer must see. State what a pan, track, tilt, push, pull, or close-up reveals or preserves; do not add movement as decoration, and do not make a push-in the default. Keep the camera stable when stability best communicates a product state or physical action.

Dialogue is an exchange, not a line count. Preserve approved words and order, then show how the speaker delivers them, what the listener visibly does, and what action follows. Sound supports the event: use dialogue, room tone, handling sounds, impacts, or silence as appropriate. Music is optional; do not default to music or use it to cover an underspecified action.

### Product and advertising staging

For a product shot, establish the product's identity and physical state, then show one readable interaction or transformation at a time. Connect the product benefit to a visible user action or consequence. Keep branding, controls, surfaces, screens, and scale consistent with the approved evidence; never invent a feature, interface state, or logo treatment to make the demonstration more persuasive.

After planning, run two separate checks: (1) content and continuity — the action can be watched from cause to resulting state; (2) interface format — the required H3 fields, labels, timing syntax, and reference bindings are valid. Passing the second check does not imply the first.

### Compact final-output rule

Keep the director process internal. The final H3 prompt is a compact production brief, not the state ledger or a transcript of the planning pass. Include only facts that change what H3 must render. Do not repeat stable identity or global style in every beat. Keep the summary to one or two sentences; keep each subject definition to its identity, reference role and only the hard visual facts; keep retention analysis to consequential states and transitions; write the detailed action as a few causal beats rather than a full checklist. Put each sound layer in one concise sentence, and use `N/A` when music is not required. Remove redundant prohibitions after the positive staging is clear.

The compactness target for a normal shot is roughly 300–700 words across all six H3 sections; use fewer when the shot is simple and exceed it only when a real action or reference conflict requires the space. Use one canonical mention for each stable subject, reference role, global look, and continuity fact in its appropriate section. Do not copy the state ledger into the final prompt. In `detailed_description`, spend words on the action path and the changed state, not on re-listing identities already defined above.

## Identity and mutable-state contract

**Identity is not state.** Separate stable identity properties (face, hair, costume design, object geometry) from action-dependent properties (worn/removed, open/closed, held/placed, seated/standing). An accessory can define a character's usual appearance without staying worn throughout the clip. Reference images establish only the properties assigned to their roles; they do not reset an action's result.

For consequential changes, keep a compact `state_ledger`: entity, property, opening evidence/state, changing action and interval, resulting state, holder/location, and final visible state. Record only states that matter to the action; do not enumerate every background object. Carry each result forward until a visible, motivated action changes it. Occlusion, a cut or a new shot paragraph does not itself cause a transfer, duplication or return to the reference pose. Unknown states remain unknown, not guessed from a character sheet.

For object handling, retain the same object through contact, release and any transfer. Name the responsible hand and keep its object ownership consistent while the other hand performs another action. Sequentially stage actions that need the same contact area; overlap compatible actions normally. Fit mechanics inside flexible action windows, preserving the approved events, duration and hard timestamps. Do not solve overload by silently deleting an event or compressing several transitions into an unreadable instant.

Example only: glasses begin on the face; the right hand grips and removes them; after removal the face is bare and the same pair remains in the right hand while the left hand rubs the nose and closes the laptop; the final view retains that state. A glasses reference preserves frame design, not permanent wear. Do not add a return-to-face action unless the story requires one. Apply the same reasoning to a released tool, a closed lid or a changed body posture, rather than inserting glasses rules into unrelated scenes.

Before returning the normalized prompt, compare identity definitions, preservation claims, action intervals and the ending against the ledger. Scope phrases such as “unchanged throughout”, “fully preserved” and “match the reference” to the specific stable properties they preserve. Repair the conflicting preservation sentence instead of appending more prohibitions beneath it. The ending reflects the last completed transition, not the initial reference pose. If approved facts themselves conflict, report the specific decision needed outside the executable prompt; do not choose a new story under the guise of formatting.

This is a writing check, not proof that the generated video is correct. Do not claim a tool enforces the ledger or that video review passed merely because this check passed.

## Viewpoint and visibility contract

Story facts are not automatically visible frame content. For each planned view, check camera position -> subject orientation -> visible surfaces -> occlusion -> readable detail. Separate what exists in the story, what a character can see, what the camera can see and what the viewer can actually read at this framing. Apply this distinction across definitions, summary, preservation claims and action prose, not only at a subject's first appearance.

Describe only supported visible details as on-screen content. A rear-facing display may illuminate a face without exposing its interface to the camera; a hidden inscription may motivate an action without becoming readable. Keep necessary unseen facts as explicitly off-camera context, or omit them from visual prose when they add no staging information. Do not turn such facts into a screen insert, overlay or full-frame graphic. These are general visibility examples, not a ban on screens, text or close-ups.

Do not invent a cut, reverse angle, transparent surface or object rotation merely to reveal hidden information. Layer 1 may plan a motivated reveal when the creative brief permits coverage choices; Layer 2 must preserve the approved camera plan and opening reference. If an explicitly required visible detail cannot be shown from that plan, report the specific visibility conflict outside the executable prompt instead of silently changing the shot. Uncertain or unseen image details remain unspecified; a file path or reference label is not visual evidence.

Separate the reference subject from the presentation of its reference image. Identity/design references contribute the assigned person's or object's properties, not contact-sheet panels, white backing, captions, browser chrome or multi-view layout. Multiple views resolve to one physical subject, not a collage inside the scene. If a reference is explicitly assigned a layout or composition role, preserve that role rather than globally stripping its layout. An accepted scene tail supplies the opening view; an identity sheet must not replace that view.

Before delivery, compare each claimed visible surface and readable detail with the approved camera plan and inspected references. Rewrite the source claim wherever it conflicts; do not append a prohibition while retaining incompatible visual prose. Keep this check internal and retain the existing output schema. Textual consistency does not certify reference delivery or generated-frame correctness.

## Cross-section ambiguity resolution

Before formatting, resolve consequential claims by entity, property, time interval, reference role and evidence. Distinguish a real contradiction (incompatible values for the same property at the same time) from a motivated change over time or two references assigned different roles. Unknown evidence is not permission to invent a state. Preserve explicit approved events and inspected opening evidence; if they materially conflict, expose the specific conflict outside the executable prompt rather than silently choosing either.

Do not mix stable properties and mutable states in one blanket preservation claim. Describe identity/design separately from location, ownership, posture, contact and on/off or open/closed state. Qualify an initial state as initial; scope a continuing claim to its actual interval. A preservation marker alone does not resolve a contradiction: changing fully_preserved to partially_preserved while retaining an overbroad sentence is insufficient.

Audit all applicable output sections together, including subject_definitions, summary, retention_analysis, detailed_description and sound sections, against the same approved timeline. Check reference labels and pronoun referents, object count and hand ownership, support and position, key light versus sole light source, camera translation versus pan/tilt, and on-screen speech versus post-production narration. For example, a stationary camera position can allow a specified tilt, but a completely locked orientation cannot; a key light can coexist with screen fill, but a sole light source cannot. These are interpretation examples, not mandatory scene content or bans on movement.

Rewrite or remove the conflicting source sentence in every affected section; do not leave it intact and append an exception, negative prompt or repeated prohibition. Use the smallest positive description that makes the intended state and transition unambiguous. Recheck the ending against the last completed action and make sure the repair has not changed approved dialogue, duration, hard timestamps, reference roles or input mode. If action capacity or timing truly cannot satisfy the approved plan, report that conflict rather than inventing an extra action or silently dropping an event.

Layer 1 owns the action/state plan; Layer 2 preserves that plan while resolving wording and normalizing format, not recreating the story or resetting states to reference appearances. Keep this audit internal: emit only the required output schema, not extra ledger/checklist sections or a claim of visual validation. This is a writing check, not proof that the generated video is correct.

## Workflow

### Natural Timing

A reference duration is adjustable, including during prompt revision. Estimate
complete dialogue at a natural pace for its language, delivery and emotion;
include breaths, punctuation pauses, turn handoffs and relevant listener
reactions. Word/character counts are rough planning estimates, not universal
speech-rate targets. Prefer measured speech duration when available.

Recompute in both directions: shorten an oversized reference as readily as
extending an insufficient one. First-frame composition, appearance and actions
already completed at the opening are states, not additional timed beats;
description length is not playback time. A long silent hold needs a supported
dramatic or visual purpose. A reference or text estimate above the clip budget
is not itself proof that the complete events cannot fit.

Listening, gestures, camera movement and ambience may overlap speech where
plausible. Add only actions and pauses that need separate time. Reflow flexible
windows without altering exact words, event order or opening/ending states.
Never accelerate, truncate or paraphrase speech to satisfy a reference target,
and never invent events merely to fill an extended clip. Update effective
duration, all time windows and last-keyframe alignment together. If the caller
requires exact timing, surface an infeasible plan rather than rushing it.

1. Default to the pipeline `Layer 1 -> persist action_timeline -> Layer 2`; expose the intermediate plan in the execution record, not inside the final H3 prompt.
2. For Layer 1, extract the creative requirements and construct the
   `action_timeline`; keep it compact and causal, then validate duration, coverage and final state before saving.
3. For Layer 2, require the saved timeline, identify the input mode and read the applicable H3 guide.
4. Preserve the exact field names, section order, labels, and timing notation
   from the selected guide.
5. Separate creative requirements from execution constraints before editing.
6. Validate continuity and report unresolved warnings outside the prompt.

### Dialogue Placement

Dialogue is event data, not a detached list that the model must redistribute.
Keep the output layout flexible, but place each complete spoken turn inside the
chronological action passage where it occurs. The passage should identify the
speaker, stable voice ID, approximate time or ordering cue, delivery, exact
line, and the relevant silent response before moving to the next turn. A shot
without explicit time windows must still make the order and handoff unambiguous.

Use one stable voice ID for one physical speaker across the prompt and across
shots. Do not assign a voice ID to a silent person, a background crowd, or a
visual group unless the group actually speaks together; a visual group and an
individual member who speaks are separate mappings. Resolve titles, names and
forms of address to the existing physical subject rather than creating another
speaker. Keep a separate dialogue catalogue only when the transport contract
requires it; it must not contradict the event-led dialogue.
An individually mapped group member remains the same already-present person,
not an extra body beside the group. For collective speech, use the participating
speakers' compound IDs rather than inventing a second identity for the group.
Keep action narration consistent with the actual turns: speaker names, question
counts and handoffs must agree with the supplied lines, without implying extra
intelligible speech.

### Deterministic Artifact Validation

For machine-produced artifacts, validate before sending the prompt to H3:

```bash
python3 scripts/validate.py \
  --timeline path/to/action-timeline.json \
  --prompt path/to/h3-prompt.json \
  --mode FL2VA
```

The validator checks the Layer 1 contract, interval coverage, gaps, overlaps,
duration, required physical-action fields, H3 core-field order, and keyframe
alignment markers. It does not judge creative quality or claim that H3 will
execute the prompt correctly. The contracts are documented in
`schemas/action-timeline.schema.json` and `schemas/h3-prompt.schema.json`.
Run the validator from the skill directory, or use an absolute path to the
script. A failed validation is a blocking artifact error; a `[WARNING]` in the
timeline is a creative review item and must not be silently removed.
Older timeline artifacts created before this contract may fail because they
lack `camera_visibility` or `sound`; migrate those fields explicitly before
passing the artifact to Layer 2.

## H3 Input Modes (Layer 2)

- T2VA: build the full audiovisual timeline from text.
- I2VA: start from the first frame and develop forward from it.
- FL2VA: describe the continuous path between the first and last frames.
- L2VA: infer a plausible opening and converge to the supplied last frame.

Use `integrated_multimodal_description`, `overall_soundscape`, and `non_diegetic_music` in the order shown in `references/base-en.txt`.

## Output Rules

- The final Layer 2 artifact must use the canonical format below; free-form or
  partial envelopes are not valid new outputs. Legacy prompts remain source
  material, not alternative output formats.
- Write rewrite sections in English; preserve dialogue, lyrics, and visible scene text in their original language.
- Describe each shot by composition, subjects, environment, actions, camera, sound, and the exact point where referenced content appears.
- Avoid plot summaries, unresolved reference labels, and timing that does not match the effective duration.

## Canonical Output Contract

The field definitions live in `references/output-format.json`, shared by the
workshop runtime and `scripts/validate.py`. Official mode-specific envelopes
are preserved; all modes share the same chronological body conventions.

- T2VA / I2VA / FL2VA / L2VA: exactly `integrated_multimodal_description`,
  `overall_soundscape`, `non_diegetic_music`, in that order. Add only the
  selected guide's official keyframe instruction before the fields; T2VA has none.
- Ref2VA: route to `../h3-ref2va-prompt-writing/SKILL.md`. Its exact fields are
  `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`,
  `overall_soundscape`, `non_diegetic_music`, in that order. This is the same
  reference contract documented in `references/ref-en.txt`.
- Write each lowercase field once at the start of a line. Give every field
  content; use `N/A` for absent ambience or score. No Markdown fences or
  diagnostics in the usable prompt. A caller's internal duration metadata is
  removed before saving and submission.
- Start the visual body with `[Shot 1]`, including a single continuous take.
  Introduce `[Shot 2]`, `[Shot 3]`, etc. only for actual cuts, without gaps or
  duplicates; put each later cut time at the beginning of its block.
- Within a shot, use meaningful `MM:SS.mmm-MM:SS.mmm` event windows. The
  opening paragraph establishes the starting composition; the last action
  paragraph reaches the approved end state. Multiple timed beats are not cuts.
  Do not replay the event in an extra summary, state ledger or dialogue list.
- Emit each scripted speech turn beside its sole speaker and stable `(Sx)`
  inside the chronological body, with original words in `<d>[language] ...</d>`.
  Intentional repeated turns stay repeated. Whole-clip sound and music fields
  do not repeat speech. Detail remains proportional to event complexity.

## Generic Block Labels

The labels below are planning vocabulary, not a second final-output template.
Use them when organizing Layer 1 facts; translate their relevant information
into the canonical Layer 2 shot paragraphs. Do not append eight separate
ledgers after the visual body. Natural paragraphs and timed passages remain
valid inside the required outer envelope.

Preferred labels are:

- `[REFERENCE_ALIGNMENT]`
- `[SUBJECTS]`
- `[WORLD_CONTINUITY]`
- `[OBJECT_CONTINUITY]`
- `[ACTION_ENGINE]`
- `[SHOT_1]`, `[SHOT_2]`, `[SHOT_3]` or the required shot sequence
- `[STATE_TRANSITION]`
- `[CAMERA_LOGIC]`
- `[AUDIO_LOGIC]`
- `[RESTRICTIONS]`

Do not use scene-specific labels such as `[SPELL]`, `[TAKEOFF]`, `[WUXIA_COMBAT]`, `[ELDER_VIEW]`, or `[LANDING]` as reusable template sections. Put those details inside `[ACTION_ENGINE]`, `[STATE_TRANSITION]`, or the relevant `[SHOT_N]` paragraph. For example, describe a jump, spell, vehicle movement, transformation, or impact as a concrete action within the timeline rather than naming the whole block after that action.

Keep the reusable template generic even when the current example is genre-specific. H3 should receive the scene-specific visual semantics in the prose, while the section structure remains stable across live action, animation, combat, dialogue, movement, and ordinary environment shots.

## Event-Led Shot Writing

### Reference Economy

Plan separate reference images only when recognizable appearance must persist
across shots or the viewer needs to inspect or identify the object. Repetition,
mention in the script, or ordinary handling alone is not sufficient. Keep
generic incidental objects in text and preserve their actions and states.
Reuse appearance already covered by a scene anchor, character sheet or product
image rather than splitting furnishings, clothing and accessories into more
assets. A one-off focal clue or product detail may still justify a reference.
Do not use object-name blacklists or a fixed image quota. Preserve explicit
user references and existing approved assets; prompt-only rewriting uses the
actual supplied list and does not silently remove assets or request new images.

Write what the audience sees and hears as the event unfolds, not a compliance
checklist. Establish only the starting composition needed to read the event,
then develop it toward the approved visible result or intentional hold.

Detail follows complexity, not character quotas or duration-based minimums.
For meaningful physical changes, connect cause, action, contact or path,
consequence, and the changed state. For dialogue, preserve exact words and
ownership, convey delivery, and show relevant listening or response. A short
line can carry a full beat; a silent shot does not need invented speech.

Camera work serves the event or information reveal. Honor explicit choices;
where unspecified, choose coherent framing, movement, focus, or cuts rather
than defaulting to a push-in. Timing follows actions, pauses, speech, and
reactions; these may overlap, and timed paragraphs do not imply cuts.

Express style through medium, materials, light, movement, recording texture,
and sound, not adjective stacks. State identity and continuity anchors once,
then describe changes. Do not add duplicate summaries, exhaustive body-part
inventories, or prevention lists to pad a simple shot. Preserve explicit user
constraints concisely; keep authoring diagnostics outside the usable prompt.

## Physical-Action-First Planning

When a prompt contains manipulation, contact, impact, locomotion, or a state change, prioritize executable physical action over mood adjectives or plot summary. Resolve requirements in this order:

1. Physical action and contact visibility
2. Subject, object, and spatial continuity
3. Camera placement and framing needed to show the action
4. Narrative information and emotional reaction
5. Style and mood language

Each timed action block must state four things: the starting state, the visible action, the physical connection or motion path, and the ending state. The ending state of one block must be the starting state of the next block. Do not compress a multi-step manipulation into a result phrase such as `removes and cleans the glasses` when the intermediate states matter.

For each hand-operated object, define the total number of arms and hands, the responsibility of each hand, the object-to-hand attachment, the action area, and the camera framing. Keep the object and the responsible hand visibly connected until a transfer is complete. For contact actions, state what touches what and what does not touch. Do not solve a structural ambiguity with a longer negative list.

Allocate time according to physical complexity, not only story importance. A single tap may take a short interval; removal, wiping, collision, release, transfer, landing, or other multi-step actions require separate intervals and readable intermediate states. The next action may overlap in momentum, but it must not erase the previous action's exit state.

## Timeline Validation

Before finalizing a prompt, validate the timeline:

- The intervals cover the effective duration without unexplained gaps.
- Every interval has an explicit start state and exit state.
- Adjacent intervals agree on subject position, object state, hand ownership, contact, and camera visibility.
- Each interval has one primary physical action; secondary reactions must not compete with it.
- Key contact points remain inside the frame and are not hidden by a crop, close-up, hand, clothing, or foreground object.
- A prop that is not required by the current request is excluded from both the positive description and the scene setup.
- Negative constraints are short and only reinforce a positively specified action.

The deterministic validator enforces the structural subset of these checks.
Semantic continuity (for example, whether a hand description really matches
the intended prop) still requires human or model review.

Timeline validation checks internal consistency; it is not a quality prediction
or a reason to rewrite the user's action plan. If the source contains several
actions in one interval, preserve them and report the density separately. If
two requirements conflict, preserve both in the prompt only when they can be
represented without contradiction; otherwise report the exact conflict and
ask for a creative decision rather than choosing one silently.

When reporting a concern, use this form outside the prompt:

`[WARNING] requirement A and requirement B may conflict because ...`

Do not use warnings to justify silently reducing action count, overriding a
hard duration, removing a camera cut, or replacing a requested effect.

For a high-risk action, perform a final audit using this compact schema:

`start_state -> actor/body part -> contact or path -> visible result -> exit_state`

Use this schema for combat contact, object handling, screen interaction, wearing or removing items, and any action where H3 could skip an intermediate state.
## Tips for Better Results
- Match the description to the effective video length and the caller's supported single-clip budget; a reference target is not a hard cap.
- Keep reference labels consistent (e.g. `<Picture 1>`, `<Video 1>`, `<Audio 1>`) across every section.
- Prefer concrete visual and audio details over abstract words like "cinematic" or "beautiful".
- When using keyframes (I2VA / FL2VA / L2VA), clearly state how the first and/or last frame connects to the timeline.
