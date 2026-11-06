# Shadowing practice

The `跟读练习` page lets a user paste a YouTube link and import the video. The worker fetches metadata and captions with yt-dlp, and an LLM splits the captions into sentences with Chinese explanations. The video then appears in the library. Opening it shows the sentences to shadow one by one.

## Sub-features

- `shadowing-import` imports a YouTube URL and shows the video in the library with the status badge `导入中…`.
- `shadowing-ready` moves the video to `ready` and opens `/shadowing/<videoId>` with its sentences.
- `shadowing-failed` shows a failed import with a retry action.
- `shadowing-delete` removes a video from the library.

## How to get to it (user POV)

- Choose `跟读练习` in the sidebar, or open `/shadowing`.

## Driving it with agent-browser

Preconditions:

- The session is signed in through a developer-utilities preset.
- `.env` sets `SHADOWING_LLM_API_KEY`, `SHADOWING_LLM_BASE_URL`, and `SHADOWING_LLM_MODEL`, and the worker was restarted after they were set. The machine can reach YouTube, and `yt-dlp --version` works. Without these preconditions, only `shadowing-import` and `shadowing-failed` can be driven.

- **Open the page.** Run `$B open http://localhost:3000/shadowing` and `$B wait --text "跟读练习"`. The page shows the textbox `YouTube 视频链接` and a disabled `导入` button. An empty library reads `还没有导入视频。`.
- **Import.** Run `$B find label "YouTube 视频链接" fill "https://www.youtube.com/watch?v=<id>"` and `$B find role button click --name "导入"`. A toast reads `已开始导入`, or `该视频已在视频库中` for a duplicate. The video appears with the badge `导入中…`.
- **Wait for the worker.** Reload until the badge changes. Check `select status, failure_reason from shadowing_videos order by created_at desc limit 1` and `amp orb service logs worker`.
- **Open the video.** Open the ready video. `/shadowing/<videoId>` lists its sentences.
- **Proof.** Take screenshots of the library after the import and after the status change. Save the `shadowing_videos` row and the worker log lines for the import workflow.

## Gotchas

- The orb blanks the LLM credentials. An import there ends with `status = failed` and `failure_reason = import_error`. The worker logs `LLM is not configured; missing environment variables: SHADOWING_LLM_API_KEY, ...`. That run proves `shadowing-import` and `shadowing-failed` only.
- A yt-dlp error in the worker log, such as a YouTube block of the machine's IP address, is an environment failure, not an app regression. Report it as an unmet precondition.
