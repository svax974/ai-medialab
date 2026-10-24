// VXFramework
//
// Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

//! External links: the webview ignores `mailto:`, `sms:` and links to other sites (`window.open`, `target="_blank"`)
//! unless the shell hands them to the system. Only these schemes are forwarded, never a local or `file:` address.

use std::process::Command;
use tauri::Url;

/// A link the page must not load itself: a mail/SMS/phone scheme, or a web address outside the local app.
pub fn is_external(url: &Url) -> bool {
    match url.scheme() {
        "mailto" | "sms" | "tel" => true,
        "http" | "https" => !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "::1" | "tauri.localhost")),
        _ => false,
    }
}

/// Opens the link with the default application of the system.
pub fn open_external(url: &Url) {
    let target = url.as_str();
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(target).spawn();
    #[cfg(target_os = "windows")]
    let spawned = Command::new("rundll32").args(["url.dll,FileProtocolHandler", target]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(target).spawn();
    let _ = spawned;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn external(url: &str) -> bool {
        is_external(&Url::parse(url).unwrap())
    }

    #[test]
    fn mail_sms_and_other_sites_go_to_the_system() {
        assert!(external("mailto:?subject=a&body=b"));
        assert!(external("sms:&body=hello"));
        assert!(external("https://wa.me/?text=hi"));
        assert!(external("https://twitter.com/intent/tweet?text=hi"));
    }

    #[test]
    fn the_local_app_and_other_schemes_stay_in_the_window() {
        assert!(!external("http://127.0.0.1:54321/studio"));
        assert!(!external("http://localhost:5173/"));
        assert!(!external("tauri://localhost/index.html"));
        assert!(!external("file:///etc/hosts"));
    }
}
