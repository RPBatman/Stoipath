//! Minimal "Edge Translator" hot-path stand-in: byte passthrough from a 1 MiB-aligned shard file
//! with the index in RAM. Paths: Zarr tile (shard index lookup), raw shard byte range (Range header),
//! DICOM-like EOT frame lookup, 15-tile bundle coalesced into <=4 contiguous ranges.
//! Adds Server-Timing: svc;dur=<ms> measured from middleware entry to response ready.
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use rand::{Rng, SeedableRng};
use std::{collections::HashMap, fs::File, io::Write, os::unix::fs::FileExt, sync::Arc, time::Instant};

const MIB: u64 = 1 << 20;
const TILE_SIZE: u64 = 512; // for naming only

#[derive(Clone)]
struct AppState {
    file: Arc<File>,
    shards: Arc<Vec<Vec<(u64, u32)>>>, // shard -> tile -> (abs offset, len)
    shard_base: Arc<Vec<u64>>,
    shard_len: Arc<Vec<u64>>,
    frames: Arc<Vec<(u64, u32)>>, // EOT: frame -> (abs offset, len)
    blocking: bool,
}

fn build_store(path: &str, n_shards: usize, tiles_per_shard: usize, seed: u64) -> (Vec<Vec<(u64, u32)>>, Vec<u64>, Vec<u64>, Vec<(u64, u32)>) {
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let mut f = File::create(path).unwrap();
    let mut shards = Vec::new();
    let mut bases = Vec::new();
    let mut lens = Vec::new();
    let mut frames = Vec::new();
    let mut cursor: u64 = 0;
    for _s in 0..n_shards {
        let base = cursor;
        let mut idx = Vec::new();
        let mut off = 0u64;
        for _t in 0..tiles_per_shard {
            let len: u32 = rng.gen_range(30_000..90_000); // mean ~60 KB like JPEG q80 512^2
            idx.push((base + off, len));
            frames.push((base + off, len));
            off += len as u64;
        }
        // shard index trailer (16 B per tile + crc) like Zarr sharding_indexed
        off += (tiles_per_shard * 16 + 4) as u64;
        let padded = ((off + MIB - 1) / MIB) * MIB; // 1 MiB alignment
        let mut buf = vec![0u8; padded as usize];
        rng.fill(&mut buf[..]);
        f.write_all(&buf).unwrap();
        shards.push(idx);
        bases.push(base);
        lens.push(padded);
        cursor += padded;
    }
    f.sync_all().unwrap();
    (shards, bases, lens, frames)
}

async fn read_range(st: &AppState, off: u64, len: usize) -> Vec<u8> {
    let file = st.file.clone();
    if st.blocking {
        tokio::task::spawn_blocking(move || {
            let mut v = vec![0u8; len];
            file.read_exact_at(&mut v, off).unwrap();
            v
        })
        .await
        .unwrap()
    } else {
        let mut v = vec![0u8; len];
        file.read_exact_at(&mut v, off).unwrap();
        v
    }
}

fn bytes_resp(v: Vec<u8>, status: StatusCode) -> Response {
    let mut r = Response::new(Body::from(v));
    *r.status_mut() = status;
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    r
}

async fn zarr_tile(State(st): State<AppState>, Path((s, t)): Path<(usize, usize)>) -> Response {
    let Some(&(off, len)) = st.shards.get(s).and_then(|v| v.get(t)) else { return StatusCode::NOT_FOUND.into_response() };
    let v = read_range(&st, off, len as usize).await;
    bytes_resp(v, StatusCode::OK)
}

async fn dicom_frame(State(st): State<AppState>, Path(n): Path<usize>) -> Response {
    let Some(&(off, len)) = st.frames.get(n) else { return StatusCode::NOT_FOUND.into_response() };
    let v = read_range(&st, off, len as usize).await;
    bytes_resp(v, StatusCode::OK)
}

// Raw shard byte range, single Range: bytes=a-b (what a CDN would send for a 1 MiB slice)
async fn shard_range(State(st): State<AppState>, Path(s): Path<usize>, headers: HeaderMap) -> Response {
    let Some(&base) = st.shard_base.get(s) else { return StatusCode::NOT_FOUND.into_response() };
    let slen = st.shard_len[s];
    let (a, b) = match headers.get(header::RANGE).and_then(|h| h.to_str().ok()) {
        Some(r) if r.starts_with("bytes=") => {
            let mut it = r[6..].splitn(2, '-');
            let a: u64 = it.next().unwrap_or("0").parse().unwrap_or(0);
            let b: u64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(slen - 1);
            (a, b.min(slen - 1))
        }
        _ => (0, slen - 1),
    };
    if a > b { return StatusCode::RANGE_NOT_SATISFIABLE.into_response(); }
    let v = read_range(&st, base + a, (b - a + 1) as usize).await;
    let mut r = bytes_resp(v, StatusCode::PARTIAL_CONTENT);
    r.headers_mut().insert(header::CONTENT_RANGE, HeaderValue::from_str(&format!("bytes {}-{}/{}", a, b, slen)).unwrap());
    r
}

#[derive(serde::Deserialize)]
struct BundleQ { t: String, g: Option<u64> }

// Bundle: t=s:t,s:t,... -> coalesce per shard into contiguous ranges (gap <= 64 KiB), read, slice, concat
async fn bundle(State(st): State<AppState>, Query(q): Query<BundleQ>) -> Response {
    let mut tiles: Vec<(usize, usize, u64, u32)> = Vec::new();
    for part in q.t.split(',') {
        let mut it = part.splitn(2, ':');
        let (Some(s), Some(t)) = (it.next(), it.next()) else { return StatusCode::BAD_REQUEST.into_response() };
        let (Ok(s), Ok(t)) = (s.parse::<usize>(), t.parse::<usize>()) else { return StatusCode::BAD_REQUEST.into_response() };
        let Some(&(off, len)) = st.shards.get(s).and_then(|v| v.get(t)) else { return StatusCode::NOT_FOUND.into_response() };
        tiles.push((s, t, off, len));
    }
    let order: Vec<(u64, u32)> = tiles.iter().map(|x| (x.2, x.3)).collect();
    let mut sorted = tiles.clone();
    sorted.sort_by_key(|x| x.2);
    // coalesce
    let mut ranges: Vec<(u64, u64)> = Vec::new(); // [start,end)
    for &(_, _, off, len) in &sorted {
        let end = off + len as u64;
        if let Some(last) = ranges.last_mut() {
            if off <= last.1 + q.g.unwrap_or(64 * 1024) { last.1 = last.1.max(end); continue; }
        }
        ranges.push((off, end));
    }
    let mut blobs: Vec<(u64, Vec<u8>)> = Vec::with_capacity(ranges.len());
    for &(a, b) in &ranges {
        let v = read_range(&st, a, (b - a) as usize).await;
        blobs.push((a, v));
    }
    let total: usize = order.iter().map(|x| x.1 as usize).sum();
    let mut out = Vec::with_capacity(total);
    let mut lens = Vec::with_capacity(order.len());
    for &(off, len) in &order {
        let (a, v) = blobs.iter().find(|(a, v)| off >= *a && off + len as u64 <= *a + v.len() as u64).unwrap();
        let s = (off - a) as usize;
        out.extend_from_slice(&v[s..s + len as usize]);
        lens.push(len);
    }
    let mut r = bytes_resp(out, StatusCode::OK);
    r.headers_mut().insert("x-bundle-index", HeaderValue::from_str(&serde_json::to_string(&lens).unwrap()).unwrap());
    r.headers_mut().insert("x-ranges", HeaderValue::from_str(&ranges.len().to_string()).unwrap());
    r
}

async fn timing_mw(req: Request<Body>, next: Next) -> Response {
    let t0 = Instant::now();
    let mut res = next.run(req).await;
    let us = t0.elapsed().as_nanos() as f64 / 1000.0;
    res.headers_mut().insert("server-timing", HeaderValue::from_str(&format!("svc;dur={:.3}", us / 1000.0)).unwrap());
    res
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).cloned().unwrap_or("/tmp/edgebench_store.bin".into());
    let port: u16 = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(8787);
    let blocking = args.get(3).map(|x| x == "blocking").unwrap_or(true);
    let n_shards = 64usize; let tps = 64usize;
    let t0 = Instant::now();
    let (shards, bases, lens, frames) = build_store(&path, n_shards, tps, 42);
    eprintln!("store built: {} shards x {} tiles, {} bytes, {:?}", n_shards, tps, lens.iter().sum::<u64>(), t0.elapsed());
    let st = AppState {
        file: Arc::new(File::open(&path).unwrap()),
        shards: Arc::new(shards), shard_base: Arc::new(bases), shard_len: Arc::new(lens), frames: Arc::new(frames), blocking,
    };
    let app = Router::new()
        .route("/zarr/{s}/{t}", get(zarr_tile))
        .route("/shard/{s}", get(shard_range))
        .route("/dicom/frames/{n}", get(dicom_frame))
        .route("/bundle", get(bundle))
        .route("/health", get(|| async { "ok" }))
        .layer(middleware::from_fn(timing_mw))
        .with_state(st);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    eprintln!("listening on {} blocking={}", port, blocking);
    axum::serve(listener, app).await.unwrap();
}
