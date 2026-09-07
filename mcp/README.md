# mcp

A stateless MCP server exposing all 28 of this repo's tools, so any project on
this machine can use them without a copy of the scripts.

```
npm run mcp                                  # start it (127.0.0.1:7391)
node mcp/install.js ../some-project          # point a project at it
```

That is the whole setup. The server runs once; every project shares it.

## Why stateless

The server holds no session state: no session id, no per-connection memory,
every `POST /mcp` self-contained. A fresh server and transport are built per
request and discarded after it — the Streamable HTTP spec's stateless mode.

It matters here because one server is serving many projects at once. A restart
never strands a client mid-session, two projects cannot interfere with each
other, and there is no session table to grow or leak. Long-running work still
needs somewhere to live, so it lives on disk in `.jobs/` rather than in the
protocol layer — which is also why a scrape started from one project can be
polled from another.

## Two things to know before calling anything

**Long tools return a job id.** A wiki scrape paces itself at one request a
second, so forty images is a minute or two — past what any MCP client will sit
and wait for. Every such tool waits a while (`wait_seconds`, default 25) and
then hands back a job id. The work carries on regardless. Poll with
`job_status`, watch with `job_logs`, or set `wait_seconds: 0` to get an id
immediately.

**File tools take absolute paths.** Most scripts in this repo read a hardcoded
`in/` and write a hardcoded `out/`, which is right for the drop-files-in-a-folder
workflow and wrong for "compress the screenshots in my other project". So those
tools take `input` (absolute paths to files or folders) and `output_dir`, and
the server stages around the script: your files are copied in, the script runs
against the folders it expects, results are moved to your `output_dir`, and
whatever was already sitting in `in/`  and `out/` is put back untouched. Omit
`input` and the tool works on its own `in/` folder as it always did.

Staged runs hold a per-tool lock, so two calls to the same tool queue rather
than tread on each other.

## The tools

**Datasets** — `character_pack`, `scrape_wiki`, `scrape_booru`,
`merge_datasets`, `dataset_list`, `dataset_contact_sheet`, `dataset_crop`

**Audio and video** — `get_audio`, `extract_audio`, `compress_video`,
`video_to_gif`

**Images** — `compress_img`, `convert_img`, `resize_img`, `strip_exif`,
`remove_img_bg`, `img_to_pdf`

**Documents and files** — `ocr_pdf`, `ocr_pdf_markdown`, `mermaid_to_img`,
`unrar_files`, `dedupe_files`

**Git and shell** — `git_history_csv`, `git_split_commits`, `remove_artifacts`

**Jobs** — `job_status`, `job_logs`, `job_list`

`node mcp/call.js list` prints them from the running server.

### character_pack

The one worth stacking. Everything for one character as a single job with one
log: audio, official art from a game wiki, fan art from Gelbooru, then both
image sources merged into one training folder.

```
node mcp/call.js character_pack '{
  "character": "Ciri",
  "wiki": "witcher.fandom.com",
  "booru_tag": "ciri",
  "limit": 40,
  "audio_search": true
}'
```

Image sources are independent — a wiki with nothing on the character still
leaves you the booru pull and the merge. Audio is off unless you pass
`audio_urls` or `audio_search: true`; with `audio_search` the query and every
video it picked come back in the result, so a wrong pick is visible rather than
turning up later as the wrong character's voice.

`booru_tag` defaults to the character name, which is often wrong for a tagged
franchise — the booru tag usually carries the series
(`shadowheart_(baldur's_gate)`, not `shadowheart`). Pass it explicitly.

## Adding it to your other projects

An MCP server is wired into a project by a `.mcp.json` in its root:

```json
{
  "mcpServers": {
    "scripts": {
      "type": "http",
      "url": "http://127.0.0.1:7391/mcp"
    }
  }
}
```

Two lines, no paths, nothing to install — which is the whole point of running
one shared HTTP server rather than a copy per project. The installer writes
that, merging into whatever is already there:

```
node mcp/install.js ../my-project
node mcp/install.js ../one ../two ../three
node mcp/install.js ../my-project --check      # say what would change first
```

Restart the MCP client in those projects afterwards so it re-reads the config.

To make it available in every project at once without a per-project file, add it
to your Claude Code user config instead:

```
claude mcp add --scope user --transport http scripts http://127.0.0.1:7391/mcp
```

### Keeping it running

The server has to be up for an HTTP client to reach it. `npm run mcp` in a
terminal is enough while you are working. To have it always there, register it
as a Windows scheduled task that runs at logon:

```powershell
$action  = New-ScheduledTaskAction -Execute "node" `
             -Argument "mcp\http.js" `
             -WorkingDirectory "C:\Users\joell\Projects\MyProjects\scripts"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "scripts-mcp" -Action $action -Trigger $trigger
```

Check it any time without speaking MCP:

```
curl http://127.0.0.1:7391/health
```

### When a background server is the wrong shape

`--stdio` wires the project to spawn its own copy per client instead:

```
node mcp/install.js ../my-project --stdio
```

Nothing to keep running, but the client owns the process — when it exits, any
child still running dies with it. Jobs survive on disk and report themselves as
`orphaned`, but a scrape killed halfway is still a scrape killed halfway. Prefer
HTTP for anything that takes minutes.

## Layout

```
server.js       list the tools, call the tools — knows nothing about any of them
http.js         stateless Streamable HTTP entry (the one you want)
stdio.js        stdio entry, for when a background process is wrong
install.js      write .mcp.json into another project
call.js         call one tool from a terminal
smoke-test.js   drive the running server with a real MCP client
tools/          the registry — one entry per tool, declared as data
lib/            job store, process runner, in/out staging, schema validation
.jobs/          job records and logs (gitignored)
out/            default landing place for staged results (gitignored)
```

Adding a tool is one entry in `tools/`. The server does not need to change.

## Testing

```
npm run mcp          # in one terminal
npm run mcp:test     # in another
```

The smoke test drives the live server with a real MCP client: every tool's
schema survives `tools/list`, argument validation rejects what it should, the
transport really is stateless, a staged run resizes real files without
disturbing the tool's own folders, and a job started by one client is readable
by another.

## Security

Bound to `127.0.0.1` with DNS-rebinding protection on. These tools run local
scripts, download files and — in one case — delete directory trees, so binding
anywhere reachable would hand that to the network. There is no authentication:
anything that can reach the port can run any tool.

`remove_artifacts` is the one genuinely destructive tool. It recursively deletes
build artifacts and dependency folders with no undo and no recycle bin, so it
requires `confirm: "DELETE"` exactly and an explicit directory, and never
defaults to the current one. If you would rather it were not reachable by an
agent at all, drop it from the array at the bottom of `tools/files.js`.
