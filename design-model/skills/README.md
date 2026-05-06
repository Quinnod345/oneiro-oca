# Claude Code skills for the design model

Skills that wrap the local design model server + distilled VLM as
Claude Code tools.  Mirrored copies of `~/.claude/skills/...` for
version control + reproducibility.

## Installing

The skills live at the user level in `~/.claude/skills/`.  To install
this skill on a new machine after cloning the repo:

```bash
cp -r design-model/skills/design-model-build ~/.claude/skills/
chmod +x ~/.claude/skills/design-model-build/scripts/*.py
chmod +x ~/.claude/skills/design-model-build/scripts/*.sh
```

The scripts assume the design model checkout is at:
`/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/design-model`

If that's wrong on a new machine, edit the `DESIGN_MODEL_DIR` /
`START_SCRIPT` constants in `scripts/grade.py`, `scripts/explain.py`,
and `scripts/render.sh`.

## Skills shipped here

### `design-model-build`
Orchestrates a generate → render → grade → improve loop using the
local design model.  Triggered by phrases like:
- "using the design model build..."
- "iterate this design with the model"
- "grade my design with the model"

See `design-model-build/SKILL.md` for full instructions.
