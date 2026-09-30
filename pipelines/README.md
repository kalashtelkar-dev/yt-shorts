# Engine X pipelines (source of truth)

The stage pipelines behind the edit styles (see `docs/edit-styles/`), built from edit-studio v8's proven nodes.

| File | Pipeline | Engine X id |
|---|---|---|
| `gameplay-index.json` | gameplay link + player → video, kill times, intro-flex moments | `tpl_v6kGXcY1_I82` |
| `gameplay-index-upload.json` | same, from an uploaded file | `tpl_6V6yanSolGTE` |
| `song-index.json` | song link → audio, duration, loudness, lyrics as force-aligned segments | `tpl_gLc9bMedBz16` |
| `song-index-upload.json` | same, from an uploaded audio file | `tpl_sVzbs9FDpeFW` |
| `style-kill-montage.json` | indexes → Kill Montage | `tpl_A_MNb8DRHume` |
| `style-ultra-edit.json` | indexes → Smart Edit (called Ultra Edit until 2026-09-30) | `tpl_dxRIHs2Bd4VP` |
| `style-lyrical-kill-montage.json` | indexes → Lyrical Kill Montage (retired 2026-09-30: switched off in the catalog, pipeline kept) | `tpl_v9F-bU2kppn3` |

**Changing a pipeline:**
1. Edit `build.py`, then run `python3 pipelines/build.py`.
2. Run `python3 pipelines/check.py`. The emulator builds each style's render command from fixed inputs and asserts what it must contain.
3. Run `pnpm enginex:pipeline validate pipelines/<file>.json`.
4. Run `pnpm enginex:pipeline import pipelines/<file>.json`. The run key can't overwrite pipelines, so this makes a new one.
5. Publish it in the dashboard.
6. Put the new id in this table and in `src/db/catalog-seed.ts` (and the mock's list in `src/server/enginex/mock.ts`), then run `pnpm catalog:sync`. It updates the catalog through the admin save (validated against Engine X, audited). Admin → Catalog → "Pipelines in use" then shows every pipeline by stage.

**`emulate.py`:** a local interpreter for the util nodes. It reproduced real v7 and v8 runs' render commands exactly (see `docs/edit-styles/README.md`).
