# dsh-plugin-subagent-clean

A DeepSeek Harness (DSH) plugin that cleans up subagent sessions — **and the historical row they leave behind in the parent session**.

The package name stays `dsh-plugin-subagent-delete`, so it drops in as a replacement for the upstream plugin.

Based on [heiheiha798/dsh-plugin-subagent-delete](https://github.com/heiheiha798/dsh-plugin-subagent-delete) (MIT).

## What is different

| | upstream 0.2.3 | this 0.3.0 |
|---|---|---|
| Delete a subagent session | ✅ | ✅ |
| Stale row in the parent catalog dropdown | ❌ stays forever | ✅ retired in place |
| Web UI cleanup entry point | ❌ | ✅ header button |
| Sweeping N subagents | — | ✅ one rewrite |
| Concurrent-write protection | — | ✅ checked before and after the write |
| Needs a patched DSH core | — | ❌ no |

## How retirement works

A session log has two invariants: event `seq` must be contiguous from 0, and compaction events cite ranges of earlier seqs. Deleting a row leaves a hole; renumbering breaks those citations. Both corrupt the log.

So instead of deleting, the plugin **rewrites the row in place** into a foreign event the loader is told to ignore:

```jsonc
{"type":"subagent-delete/retired","seq":263,"time":1730000000000,"ignorable":true,
 "data":{"childId":"…","retiredAt":1730000005000}}
```

- `seq` and `time` are preserved, so contiguity and compaction citations stay valid
- `ignorable: true` sits on the event envelope, so the loader keeps the record verbatim even though it does not know the type
- the catalog projection only materializes rows for `type === "subagent/catalog"`

Every other event is left byte-for-byte untouched.

## Install

```sh
dsh plugin --profile web add github:huajiao1998/dsh-plugin-subagent-clean
# pinned
dsh plugin --profile web add github:huajiao1998/dsh-plugin-subagent-clean#v0.3.0
```

Restart the profile and open a session.

## Use

Web UI: a **子代理 / Subagents** button appears in the conversation header. It lists this session's subagents, one delete button per row, plus **一键清理** to sweep them all with a single rewrite.

Tools are unchanged from upstream: `list_subagents`, `delete_subagent`, `release_subagent`.

## HTTP routes

```
GET  /dsh-plugin-subagent-delete/list?parentSessionId=<id>
POST /dsh-plugin-subagent-delete/delete   {"parentSessionId":"<id>","subagentId":"<id>"}
POST /dsh-plugin-subagent-delete/release  {"parentSessionId":"<id>","subagentId":"<id>"}
POST /dsh-plugin-subagent-delete/cleanup  {"sessionId":"<id>"}        // new
POST /dsh-plugin-subagent-delete/scrub    {"parentSessionId":"<id>"}  // new
```

## Notes

- Rewrites are safe while the parent session is live: seq values do not change, so the host's in-memory counter stays valid and the host keeps appending to the same path (verified).
- The swap is guarded by a stat check before the write and again right before the rename; a mismatch aborts and queues the work for the next host start instead of dropping an event.
- The whole log is decoded in memory during a rewrite — fine for a few MB, worth thinking about for hundreds of MB.
- Verified on DSH `0.2.1-rc.2` / Node 22. No DSH package is modified.

## License

MIT. Original copyright heiheiha798; changes released under the same license.
