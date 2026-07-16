# Real-model theme-to-full-episode E2E

This suite validates the expensive production path against the locally configured
real providers:

1. create an isolated project from a theme;
2. stream an AI-written script;
3. parse and confirm AI characters, episodes, scenes, and shots;
4. generate, approve, and activate AI character references;
5. generate and validate every shot panel;
6. synthesize every non-empty dialogue line;
7. generate and validate a Wan MP4 for every shot;
8. render and validate the full episode MP4;
9. require the persisted render review to pass;
10. create, gate, approve, and register the final release candidate;
11. open the generated project in the Web UI and verify both shot video and final episode playback.

Run from the repository root or `apps/web`:

```bash
npm run test:e2e:real --workspace @comic-studio/web
```

The runner uses isolated ports and data by default:

- Web: `http://127.0.0.1:3100`
- API: `http://127.0.0.1:8100`
- Runtime: `.runtime/e2e-real`
- Timeout: 120 minutes (override with `AI_COMIC_E2E_TIMEOUT_MS`)

It reads `data/provider-channels.json` in place and does not copy API keys into
the isolated runtime. Override the input theme or locations when needed:

```bash
AI_COMIC_E2E_THEME='一名深海考古学家发现会说话的古代潜水钟。' \
AI_COMIC_E2E_TIMEOUT_MS=2400000 \
AI_COMIC_E2E_PROVIDER_CHANNELS_PATH=/absolute/path/provider-channels.json \
npm run test:e2e:real --workspace @comic-studio/web
```

The test is excluded from `npm test` and only calls real models through the
explicit `test:e2e:real` command. Playwright traces and screenshots are written
under `apps/web/test-results`; generated media and the isolated database remain
under `.runtime/e2e-real` for inspection until the next run.

This is intentionally an expensive release gate: the default prompt requests a
multi-shot episode with dialogue so image, TTS, video, compositor, QC, and
publication paths are all exercised. After the model pipeline succeeds, the test also saves
`.runtime/e2e-real/result.json`. If only a final browser assertion fails, rerun
the browser verification without paying for the models again:

```bash
AI_COMIC_E2E_REUSE_RUNTIME=1 \
npm run test:e2e:real --workspace @comic-studio/web
```
