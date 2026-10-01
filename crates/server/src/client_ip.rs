//! Resolves the real client IP for rate limiting. `X-Forwarded-For` is
//! only trusted when the direct peer is the configured `TRUSTED_PROXY`
//! — otherwise a client could simply forge the header to dodge limits.

use std::net::{IpAddr, SocketAddr};

use axum::http::HeaderMap;

pub fn resolve(headers: &HeaderMap, peer: SocketAddr, trusted_proxy: Option<IpAddr>) -> IpAddr {
    if trusted_proxy == Some(peer.ip()) {
        if let Some(forwarded) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(first) = forwarded.split(',').next() {
                if let Ok(ip) = first.trim().parse() {
                    return ip;
                }
            }
        }
    }
    peer.ip()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn uses_peer_ip_when_no_proxy_is_trusted() {
        let headers = HeaderMap::new();
        let peer: SocketAddr = "203.0.113.5:1234".parse().unwrap();
        assert_eq!(resolve(&headers, peer, None), peer.ip());
    }

    #[test]
    fn ignores_forwarded_header_from_an_untrusted_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("1.2.3.4"));
        let peer: SocketAddr = "203.0.113.5:1234".parse().unwrap();
        let trusted = Some("10.0.0.1".parse().unwrap());
        assert_eq!(resolve(&headers, peer, trusted), peer.ip());
    }

    #[test]
    fn uses_forwarded_header_from_the_trusted_proxy() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("1.2.3.4, 10.0.0.1"));
        let peer: SocketAddr = "10.0.0.1:1234".parse().unwrap();
        let trusted = Some("10.0.0.1".parse().unwrap());
        assert_eq!(resolve(&headers, peer, trusted), "1.2.3.4".parse::<IpAddr>().unwrap());
    }
}
