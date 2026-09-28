# Engine X pipelines (source of truth)

The stage pipelines behind the edit styles (see `docs/edit-styles/`), built from edit-studio v8's proven nodes.

| File | Pipeline | Engine X id |
|---|---|---|
| `gameplay-index.json` | gameplay link + player → video, kill times, intro-flex moments | `tpl_yYsSXHkQXJBP` |
| `gameplay-index-upload.json` | same, from an uploaded file | `tpl_K6Lo3rwFya4A` |
| `song-index.json` | song link → audio, duration, loudness, word timings | `tpl_sfY_wbow51wN` |
| `style-kill-montage.json` | indexes → Kill Montage | `tpl_L9GCGiLR4xdr` |
| `style-lyrical-kill-montage.json` | indexes → Lyrical Kill Montage | `tpl_yd7ODZifX40-` |

**Changing a pipeline:**
1. Edit `build.py`, then run `python3 pipelines/build.py`.
2. Run `python3 pipelines/check.py`. The emulator builds each style's render command from fixed inputs and asserts what it must contain.
3. Run `pnpm enginex:pipeline validate pipelines/<file>.json`.
4. Run `pnpm enginex:pipeline import pipelines/<file>.json`. The run key can't overwrite pipelines, so this makes a new one.
5. Publish it in the dashboard, and point the catalog at the new id.

**`emulate.py`:** a local interpreter for the util nodes. It reproduced real v7 and v8 runs' render commands exactly (see `docs/edit-styles/README.md`).
