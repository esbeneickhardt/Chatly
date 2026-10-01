# Performance

What Chatly is built for, what was measured, and how to measure it again.

## The target

A community of roughly 50–100 people on one small host. The realistic
peak is a few dozen people typing at once — on the order of **tens of
requests per second**, not hundreds — plus a handful of voice calls, whose
media is relayed by the SFU and never touches the HTTP path.

## The load test

`crates/server/src/load_tests.rs` drives the real router over a real
SQLite database (no sockets, so it measures the application, not the
kernel's TCP stack). It registers 60 users, then has all of them, *at the
same time*, post 25 messages each to a shared channel, post to a DM, read
the latest page, list their DMs and run a server-wide search — about 2,800
requests fired as fast as the server will take them, which is a far harsher
burst than any real evening.

```sh
cargo test --release -p server -- --ignored --nocapture load
```

### A reference run

One host (16 cores, shared with other containers), release build, median of
three alternating runs of the old and new binary, back to back:

| p50 at saturation | first version | with statement cache | now |
|---|---|---|---|
| Post a message (channel) | ≈ 155 ms | ≈ 107 ms | **≈ 11 ms** |
| Post a message (DM) | ≈ 77 ms | ≈ 53 ms | **≈ 10 ms** |
| Read the latest 50 messages | ≈ 152 ms | ≈ 96 ms | **≈ 16 ms** |
| List my DMs | ≈ 51 ms | ≈ 32 ms | **≈ 9 ms** |
| Search the server | ≈ 287 ms | ≈ 238 ms | **≈ 140 ms** |
| Throughput at saturation | ≈ 350 req/s | ≈ 520 req/s | **≈ 2,700 req/s** |

(The "first version" column is from an earlier session's runs, so treat it as
indicative; the last two columns were measured against each other.)

Those latencies are **queueing time at saturation**: sixty clients all
waiting on one SQLite connection. Real traffic leaves the queue empty, and a
request then costs a millisecond or two.

**Headroom: well over fifty times** what the community is expected to
generate.

### Caveats worth knowing

- The host is shared, and results vary a lot with what else is running —
  the same binary measured anywhere between ~310 and ~1,300 requests/s on
  different occasions. Compare builds by **alternating runs on the same
  machine in the same minute**, as the release-profile choice below was,
  never against a number from another day.
- It measures HTTP and storage. Voice/video are not covered: the SFU is a
  single task that forwards packets, and its limits are bandwidth and CPU
  for RTP, not the request path.

## Decisions the numbers support

- **A first-in-first-out queue in front of the connection** (a
  `tokio::sync::Mutex` taken before the blocking thread is spawned). This was
  the biggest single win, about five times the throughput. Before it, every
  waiting request parked a blocking thread on the connection's std mutex:
  sixty threads waking and sleeping around one lock (a "lock convoy"), and an
  unfair lock that let some requests be overtaken again and again. Now only
  the request whose turn it is takes a thread. The queue is cancel-safe (a
  client that hangs up while waiting does not jam it; there is a test).
- **One round trip per permission check.** `AccessStore::channel_access_facts`
  loads the channel, server, membership, roles, overwrites and restricted-
  channel access together; `api::permissions` makes the (pure) decision. A
  post used to make about nine trips to the database.
- **Message pages are enriched with one query per table**, not per message
  (attachments, reactions, mentions; a `json_each` parameter keeps the SQL text
  constant so it stays cached). A test pins that nothing leaks between
  messages.
- **The member list is only loaded when a message contains an `@`**, the only
  case where it can mention anyone.
- **Prepared statements are cached** (`prepare_cached`, capacity 128
  instead of rusqlite's 16). Every request used to re-parse and re-plan
  its SQL. Measured by alternating builds: 20–38% lower median latency.
- **`opt-level = 3`, not `"z"`.** Alternating builds: ~9% more requests per
  second (median 349 vs 319) for a few extra megabytes in the image.
- **One SQLite connection** behind the queue above, on a blocking thread. It
  makes every multi-step operation trivially atomic, and WAL mode keeps
  commits cheap. At ~2,700 requests/s it is nowhere near the ceiling for a
  community this size; if it ever is, the next step is a small pool of
  read-only connections.
- **Search is the most expensive request** (an FTS scan plus a permission
  check per channel in the hits). It is capped: 50 results a page, and the
  candidate scan is bounded (`MAX_CANDIDATE_PAGES`).

## Known limits

- The voice SFU does not estimate a *receiver's* bandwidth or pace its
  sends, so a viewer on a weak connection can stutter on a heavy screen
  share. Senders are capped to keep that in check (screen share: 4 Mbps,
  30 fps). Adding downstream bandwidth estimation is the real fix and is
  a larger piece of work.
- The kernel caps UDP socket buffers at `net.core.rmem_max`/`wmem_max`;
  the server asks for 4 MiB and logs what it got at startup.
