---
name: h3-ref2va-prompt-writing
description: Write reference-aware MiniMax H3 shot prompts from approved scripts, shot facts, and actual reference assets. Use for Ref2VA video prompt generation and revision, not screenplay writing or media generation.
---

# H3 Prompt Writing

## Workflow

Read the current shot's facts, exact dialogue, duration, camera intent, and actual
references. Resolve reference roles before writing. Read `references/ref-en.txt`
for binding, timing, and dialogue conventions.

## Visible performance versus deliberate stillness

Before accepting or reusing Layer 1, identify what a viewer can see change at the planned framing: a motivated gesture, attention shift, contact, reaction, or camera reveal of relevant information. Give that change a visible start and result. A fixed camera does not freeze the actors; quiet mood and stable identity/layout do not require a motionless performance. Background ambience, blinking alone, or an imperceptible drift is not a substitute for the shot's dramatic purpose.

An intentional tableau, still life, freeze frame or sustained pause is valid when its purpose and duration justify the hold. Do not require motion in every shot. Do not treat a legacy “nobody moves” instruction or the word “establishing” alone as that justification. If the canonical action explicitly forbids movement yet provides no coherent hold purpose, surface the planning conflict for upstream correction; do not quietly override it or invent new story events.

Keep any added connective behavior inside the established action and end state. Do not perform the next shot's event early. A preparatory reach can stop beside an object; it must not become the next shot's push, transfer or pickup. Camera movement should reveal relevant information, not conceal missing performance.

Layer 2 must carry the reviewed visible change into detailed action prose. Scope preservation to identity, costume and stable spatial relationships. Never replace a planned action with “remain still”, freeze mutable hands/gaze through retention language, or erase its visible result while shortening. For a deliberate hold, preserve the hold rather than adding compulsory gestures. This is prompt planning evidence, not proof of rendered video quality.


## Two-stage execution

For a normal Ref2VA rewrite, first resolve a compact Layer 1 action timeline and persist it with the shot facts. Then run Layer 2 to express that approved timeline in the six Ref2VA sections. Use 3–5 meaningful beats for a normal action shot and fewer for a simple shot; do not create equal time bins or artificial micro-beats. A direct Layer 2 call is allowed only when an authoritative timeline is already present. The timeline is planning data and never appears as an extra output section.


## Reconstruct and Compile Once

When canonical shot records are supplied, reconstruct the prompt from those records, the persisted action timeline and the actual reference images. Previous generated prose is not a source of new facts or a style template. With only a user-authored free-form description, preserve its explicit instructions; do not discard them as a legacy draft.

Give each section one job. `subject_definitions` uses one short identity-to-reference binding per subject, with only distinguishing details or a real ambiguity resolved. `summary` is one sentence about the event. `retention_analysis` names preservation categories (identity, costume, layout, product design) or actual changes; it does not repeat the visual inventory. `detailed_description` spends words on opening composition, executable action, reactions, camera purpose and the resulting state. Sound fields describe audible content only. Picture labels belong in identity bindings unless a later reference-specific operation, such as matching a real opening frame, requires one.

A quiet establishing shot can use one compact visual paragraph. It does not need a costume catalogue, furniture inventory, a recap of every unchanged object, or multiple clauses about what must not happen. A complex exchange gets the detail its mechanics require. Preserve exact dialogue and causal transitions when shortening; never meet an editorial length suggestion by cutting either. A final editorial pass removes duplication across the six sections without inventing action to make a static shot look different.


## Prompt Priority Order

When requirements compete, use this order: (1) approved facts, exact dialogue and cross-shot continuity; (2) action and interaction that make those facts visible; (3) camera and sound choices that improve readability; (4) reference appearance and product detail; (5) style adjectives, which have the lowest priority. Preserve higher-priority content and simplify or remove lower-priority prose. Never add length to protect a style adjective.


## Declarative Continuity Contract

Continuity in the final prompt must be declarative. When an approved opening state exists or a preceding tail is explicitly selected as the first frame, state exactly what the shot must begin with and what each consequential object, person and spatial relation must do next. Do not use uncertainty or optional language such as “may”, “can reference”, “if available”, “try to”, “keep similar”, “尽量”, or “可能” for a required handoff. If the required reference or state is missing, stop before formatting and report the missing input outside the prompt; never weaken a required continuity constraint inside the prompt.

The opening state must be definite, the transition must be visible, and the ending state must be definite. Camera movement after the opening is allowed only when its path and purpose are stated; it must not replace the required opening composition.


## Creative Core and Interface Wrapper

Write the action prose first as the creative core: a subject performs a physical action, the action affects another subject or object, the camera follows the information, and the visible result settles on screen. Only after that prose is coherent should it be placed into the required H3 fields. The six fields are an interface wrapper, not a reason to expose planning language.

Do not put analysis, evaluation or author commentary in the final prompt. Avoid phrases such as “the main visible change is”, “this shows that”, “the relationship is”, “so the viewer understands”, or “the handoff remains unfinished” when the same result can be shown through visible action. Show the result through visible action. Replace interpretation with the image: a hand stops above a card, a gaze returns to the speaker, a shoulder settles, a prop stops under a palm.


## Director Process Layer

Before writing the six sections, consume the persisted Layer 1 action timeline as the director-readable process for the shot. If it is missing, incomplete or only a whole-shot fallback, stop formatting and run Layer 1 first. The six-section format is an interface contract; it is not a reason to make every shot use the same prose shape or length. A simple shot may use concise natural paragraphs. A complex action, product demonstration, or dialogue exchange may use time-marked beats inside `detailed_description`.

For every consequential change, resolve:

`cause -> physical action -> contact or path -> visible consequence -> resulting state`

The resulting state must agree with the accepted opening reference, the current shot facts, and the next shot's opening contract. The previous shot's ending state is continuity input, not dialogue or action to replay. Reference images identify people, objects, and environments; they do not reset a prop to an old pose, reopen a closed device, restore removed accessories, or create a new person.

Use detail for failure-prone mechanics: hand ownership, weight shift, grip release, object trajectory, eye-line, listener reaction, spatial crossing, product interaction, and the visible settle after the final action. Do not pad a simple action to satisfy a word quota, fixed number of beats, or fixed dialogue count.

### Interaction-first staging

For interpersonal action, resolve `initiative -> target cue -> response -> consequence` before writing the six sections. Show who initiates, what the other subject can perceive, how that subject visibly responds, and what state or action follows. Keep the speaker, listener and visible response together when the shot depends on their exchange. Do not describe relationship with adjectives alone; express tension, trust, hesitation or cooperation through gaze, distance, hand movement, interruption, pause, turn-taking and the resulting state.

### Viewer-directed coverage, exchange, and sound

Every camera move must answer what the viewer needs to see. A pan, track, tilt, push, pull, or close-up is justified by the subject, object, spatial relationship, or reaction it reveals or preserves. Do not default to a push-in, a cut, a master shot, or a cinematic adjective when the action does not need it.

Preserve approved dialogue exactly and keep each turn attached to its speaker. Add delivery, listener reaction, and the following action where the shot requires them. Treat sound as a scene decision: dialogue, room tone, handling sounds, impacts, silence, or optional music. Do not default to music.

### Product and advertising continuity

When the shot demonstrates a product, establish the product identity and opening physical state from the approved references, then stage one readable interaction or state change at a time. Show the user action, product response, and resulting benefit as a visible chain. Keep logo, controls, screen content, material, scale, and interface states within the approved evidence; do not invent persuasive features or reset the product between shot boundaries.

Keep this process layer internal. Emit only the required six sections, and run content/continuity validation separately from field/order validation. A structurally valid prompt is not evidence that the generated video will preserve the planned action.

### Compact final-output rule

Keep the director process internal. The final six-section prompt is a compact production brief, not the state ledger or a transcript of the planning pass. Include only facts that change what H3 must render. Do not repeat stable identity or global style in every beat. Keep `summary` to one or two sentences; keep each subject definition to identity, reference role and hard visual facts; keep `retention_analysis` to consequential states and transitions; write `detailed_description` as a few causal beats rather than a full checklist. Put each sound layer in one concise sentence, and use `N/A` when music is not required. Remove redundant prohibitions after positive staging is clear.

The compactness target for a normal Ref2VA shot is roughly 300–700 words across all six sections; use fewer when the shot is simple and exceed it only when a real action or reference conflict requires the space. Use one canonical mention for each stable subject, reference role, global look, and opening state in its appropriate section. Do not copy the state ledger into the final prompt. In `detailed_description`, spend words on the action path and the changed state, not on re-listing identities already defined above.


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

### Planning-to-format handoff
When a Layer 1 plan is supplied, use its approved state_ledger and timeline rather than rebuilding the action from reference appearances. If no authoritative timeline is present, run and persist Layer 1 before formatting. Keep the ledger and checking commentary out of the six-section video prompt. In subject_definitions identify the object and initial state; in retention_analysis scope identity/appearance preservation and name the intended state change; in detailed_description show the transition and sustain its result through the final view. Preserve existing dialogue, reference numbering and timing rules.

### Cross-shot opening state continuity

When an accepted same-scene tail is explicitly selected as the first frame, use its visible state as the opening evidence; asset references supply identity and appearance, not a replacement pose or object state. Privately check only consequential visible states: open/closed, on/off, seated/standing, held/released, support/contact, and object placement. Do not infer an unobserved state from a hidden surface or an asset sheet.

Write the actual opening states in the first action paragraph, then carry them forward until an explicit action changes them. A closed laptop stays closed until a visible opening action; a seated person rises before acting from a standing position; an object held in one hand is placed or transferred before appearing elsewhere. These are examples, not mandatory actions. If the script does not require the change, preserve the existing state. When a simple connective action is necessary and consistent with the script, show its cause and result within the available time instead of starting after it, hiding it behind a cut, or inventing a new plot event.

If explicit script facts materially conflict with the visible tail, report the concrete conflict rather than silently resetting the opening or claiming both states match. Unknown details remain unspecified. Keep one consistent opening requirement across all six sections; never describe the same tail as both required and optional. Ref2VA provides a prompt-level constraint, not a pixel-lock guarantee: do not claim continuity has passed before the generated opening is checked against the source tail. Return the scene, not this checklist.

- Leave nonessential blinking, breathing, cloth movement, small gestures, exact foot placement and minor camera easing to natural realization unless they communicate a story fact. Silence means no intelligible dialogue, not fixed closed mouths or motionless faces. Natural silent reactions are allowed; extra spoken words are not.

## Full-Reference Mode

Use the official six-field envelope in this exact order:
`subject_definitions`, `summary`, `retention_analysis`, `detailed_description`,
`overall_soundscape`, `non_diegetic_music`. Write each lowercase field once at
the start of a line. Every field needs content; use `N/A` for absent ambience
or score. The canonical contract is shared with the base-mode skill in
`../h3-prompt-writing/references/output-format.json`.

Keep `summary` to one short task/reference-scope sentence. Use
`retention_analysis` for concise preservation/transfer roles, not a second
event description. Put the entire chronological performance in
`detailed_description`, starting with `[Shot 1]` even for a single take. Add
consecutive `[Shot N]` blocks only for actual cuts, with later cut times at
the beginning of the block. Within each shot, use natural paragraphs and
meaningful `MM:SS.mmm-MM:SS.mmm` event windows. The last action paragraph
carries the approved ending. Do not output a parallel eight-block checklist,
repeat dialogue in bookkeeping, or pad a simple shot to meet a word quota.

Establish reference-to-identity mappings once. Use stable semantic names or
`<Subject N>` labels afterward. Reference pictures determine identity, objects,
or space according to their role; their crop and pose need not become the shot.
A preceding tail is continuity context unless the user explicitly selected it
as the current first frame. That selection anchors the opening, not the ending.

Select references for recognizable continuity or viewer attention, not for
every noun in the scene. Repeated use, mention or ordinary handling alone does
not require a separate image. Generic incidental objects stay in text with
their actions and states intact. Reuse scene, character-sheet and product
coverage before splitting furnishings, clothing or accessories into new
assets; a one-off focal clue or important product detail can justify a reference.
Do not impose an object-name blacklist or fixed image count. Preserve explicit
user references and approved assets. During prompt-only revision, use the actual
supplied list; do not silently remove assets or demand new image generation.

## Write Unfolding Audiovisual Events

- Establish only the starting composition and facts needed to understand the
  event. Develop the action and finish on its visible result or planned hold.
- Where mechanics matter, describe cause, action, contact or movement path,
  consequence, and the resulting state. Ordinary gestures do not need an
  exhaustive inventory of body parts.
- Preserve supplied dialogue exactly. Identify the speaker, delivery, and the
  listener's visible response or resulting action when relevant. A short line
  can carry a full beat; a silent shot can be complete without any speech.
- Let camera placement, movement, focus, and cuts reveal the event. Honor
  explicit camera choices; choose one coherent idea for a continuous passage,
  not a default push-in or an arbitrary quota of cuts.
- Express style through the actual medium, material behavior, light, motion,
  recording texture, and sound. Do not stack generic cinematic adjectives or
  force a glossy treatment on every genre.
- Detail follows complexity, not duration-based word quotas. Describe a simple
  action briefly; develop a complex exchange where intermediate states matter.
- Place meaningful timing around changes, dialogue, and reactions. Speech,
  movement, listening, and ambience may overlap; time blocks do not imply cuts.
- Treat supplied duration and windows as references unless explicitly hard.
  Allocate complete speech at a natural language- and emotion-appropriate pace,
  including breaths, pauses, turn handoffs and relevant reactions. Prefer
  measured audio duration when available. Shorten or extend reference timing
  from the actual unfolding events, not description length. First-frame
  composition, appearance and already-completed actions are opening states,
  not timed beats to replay. A long silent hold needs a supported dramatic or
  visual purpose. Neither an oversized reference nor a text estimate alone
  proves infeasibility. Reflow timing when needed,
  updating the effective clip duration and all endpoints together. Never rush,
  truncate or paraphrase dialogue to fit, or invent events to fill added time.
  Beyond the caller's clip budget, split at complete turns or action results
  in planning; report the need to split in prompt-only revision.
- State identity, appearance, reference roles, and continuity facts once, then
  describe changes. Keep authoring diagnostics and repetitive prevention lists
  out of the final prompt. Preserve an explicit user constraint concisely.
- Treat dialogue as part of the unfolding event rather than a detached block.
  Put each complete line beside the action that produces it, with its sole
  speaker, stable voice ID, approximate time or clear sequence cue, delivery,
  and the relevant silent listener response. If exact windows are unavailable,
  the prose must still make the speaker order and handoff unmistakable.
- Give voice IDs only to actual speaking subjects. A silent subject, background
  crowd, or visual group receives no voice ID unless the group speaks together;
  an individual speaker who belongs to a visual group needs an identity mapping
  of their own. Never reuse one voice ID for two physical speakers, and never
  infer ownership from a title, addressee, or nearby group label.
- An individually mapped group member is the same already-present person, not
  an extra body. Collective speech uses the participating speakers' compound
  IDs. Match narrated speaker names, question counts and handoffs to the actual
  supplied turns; do not imply additional intelligible speech.

## Output Rules

Return only the usable prompt. English visual prose is the workshop default;
dialogue, lyrics, and visible text retain their original language. Preserve the
approved events, cast, dialogue, hard timing constraints, and ending. Add expressive detail,
not new story facts. Report unresolved identity or genuinely incompatible hard
timing rather than guessing, truncating dialogue, or silently changing the shot.
