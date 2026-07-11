# Script Mode Segment Design

## Goal

Replace the oversized three-column-looking mode control in the script creation workspace with a compact two-option segmented control.

## Design

- Render exactly two equal segments: `AI生成` and `自动识别`.
- Size the control to its content on desktop instead of stretching across the source panel.
- Use a 36px stable height and modest horizontal padding.
- Use the Studio accent color, border, and subtle surface contrast for the selected state instead of a large black block.
- Add the existing Lucide `Sparkles` icon to `AI生成`; automatic recognition remains text-only.
- Keep an 18px visual gap between the mode control and the source form.
- On narrow mobile screens, allow the control to fill the available width.
- Preserve the existing mode behavior, keyboard focus behavior, and accessible button names.

## Acceptance Criteria

- No empty third segment or unused horizontal region is visible.
- Both labels remain fully readable at desktop and mobile widths.
- Switching modes does not resize the surrounding form vertically.
- The active mode is distinguishable without relying only on text color.
- Existing script-import component tests continue to pass.
