//! A load smoke test, not run by default: `cargo test --release -- --ignored
//! --nocapture load`. It drives the real router over a real database with
//! the community size this app targets (dozens of people chatting at once)
//! and prints latency percentiles, so a performance regression — or a
//! claim about capacity — rests on a number instead of a feeling. Results
//! from a reference run are recorded in `docs/performance.md`.

use std::time::{Duration, Instant};

use axum::http::StatusCode;
use serde_json::json;

use crate::test_support::{TestApp, TestClient};

const USERS: usize = 60;
const MESSAGES_PER_USER: usize = 25;

struct Sample {
    what: &'static str,
    took: Duration,
}

fn report(samples: &[Sample], wall: Duration) {
    let mut kinds: Vec<&'static str> = samples.iter().map(|s| s.what).collect();
    kinds.sort();
    kinds.dedup();
    println!(
        "\n{:<28} {:>7} {:>9} {:>9} {:>9} {:>9}",
        "request", "count", "p50", "p95", "p99", "max"
    );
    for kind in kinds {
        let mut times: Vec<Duration> =
            samples.iter().filter(|s| s.what == kind).map(|s| s.took).collect();
        times.sort();
        let pick = |q: f64| times[((times.len() as f64 * q) as usize).min(times.len() - 1)];
        println!(
            "{:<28} {:>7} {:>8.1}ms {:>8.1}ms {:>8.1}ms {:>8.1}ms",
            kind,
            times.len(),
            pick(0.50).as_secs_f64() * 1e3,
            pick(0.95).as_secs_f64() * 1e3,
            pick(0.99).as_secs_f64() * 1e3,
            times.last().unwrap().as_secs_f64() * 1e3,
        );
    }
    println!(
        "\n{} requests in {:.2}s = {:.0} req/s\n",
        samples.len(),
        wall.as_secs_f64(),
        samples.len() as f64 / wall.as_secs_f64()
    );
}

async fn timed<T>(
    what: &'static str,
    out: &mut Vec<Sample>,
    fut: impl std::future::Future<Output = T>,
) -> T {
    let start = Instant::now();
    let value = fut.await;
    out.push(Sample { what, took: start.elapsed() });
    value
}

async fn one_user(
    mut client: TestClient,
    guild: String,
    channel: String,
    dm_peer: String,
) -> Vec<Sample> {
    let mut samples = Vec::new();
    let (_, dm) = client.post("/api/dms", json!({ "usernames": [dm_peer] })).await;
    let dm_channel = dm["channel"]["id"].as_str().unwrap().to_string();

    for n in 0..MESSAGES_PER_USER {
        let (status, _) = timed(
            "post message (channel)",
            &mut samples,
            client.post(
                &format!("/api/channels/{channel}/messages"),
                json!({ "content": format!("load test message {n} about zeppelins and lunch") }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        if n % 5 == 0 {
            timed(
                "post message (dm)",
                &mut samples,
                client.post(
                    &format!("/api/channels/{dm_channel}/messages"),
                    json!({ "content": "hello there" }),
                ),
            )
            .await;
        }
        if n % 3 == 0 {
            timed(
                "read latest 50 messages",
                &mut samples,
                client.get(&format!("/api/channels/{channel}/messages")),
            )
            .await;
        }
        if n % 5 == 2 {
            timed("list my DMs", &mut samples, client.get("/api/dms")).await;
        }
        if n % 8 == 4 {
            timed(
                "search (server)",
                &mut samples,
                client.get(&format!("/api/search?guild_id={guild}&q=zeppelins")),
            )
            .await;
        }
    }
    samples
}

#[tokio::test]
#[ignore = "load test; run with --release --ignored --nocapture"]
async fn load_a_community_chatting_at_once() {
    let app = TestApp::new().await;
    let (mut owner, guild, channel) = app.owner("root").await;

    // Setup isn't measured (it's dominated by password hashing).
    let mut clients = Vec::new();
    let mut names = Vec::new();
    for i in 0..USERS {
        let name = format!("user{i}");
        clients.push(app.member(&mut owner, &channel, &name).await);
        names.push(name);
    }
    println!("{USERS} users registered; {MESSAGES_PER_USER} messages each, all at once");

    let started = Instant::now();
    let mut tasks = Vec::new();
    for (i, client) in clients.into_iter().enumerate() {
        let peer = names[(i + 1) % USERS].clone();
        let channel = channel.clone();
        let guild = guild.clone();
        tasks.push(tokio::spawn(one_user(client, guild, channel, peer)));
    }
    let mut samples = Vec::new();
    for task in tasks {
        samples.extend(task.await.unwrap());
    }
    report(&samples, started.elapsed());
}
