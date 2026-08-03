//! Per-board rate governor for the apply queue — the real anti-ban lever. Every 2026 source agreed:
//! bans come from PACING, not from the captcha click. This counts completed applies per platform in
//! rolling 24h / 1h windows and decides whether the next apply to that board is allowed.
//!
//! Caps default per board (2026 job-board research — see docs/AUTOMATION_UPGRADE_PLAN.md) and are
//! overridable at runtime via env: HIREMEOPS_RATE_<PLATFORM>_DAY / HIREMEOPS_RATE_<PLATFORM>_HOUR
//! (e.g. HIREMEOPS_RATE_LINKEDIN_DAY=20). LO tunes these as boards change — the numbers are estimates.

use sqlx::SqlitePool;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};

#[derive(Debug, Clone)]
pub struct RateDecision {
    pub allowed: bool,
    pub reason: Option<String>,
    pub used_day: u32,
    pub cap_day: u32,
    pub used_hour: u32,
    pub cap_hour: u32,
}

// (per-24h, per-1h) caps per platform. LinkedIn is deliberately the tightest — its 2026 crackdown
// targets exactly browser-based apply automation. The hour cap smooths bursts within the day budget.
fn default_caps(platform: &str) -> (u32, u32) {
    match platform.to_ascii_lowercase().as_str() {
        "linkedin" => (30, 8),
        "indeed" => (40, 12),
        "upwork" => (20, 6),
        "gupy" => (40, 12),
        "catho" => (40, 12),
        "infojobs" => (40, 12),
        _ => (40, 12),
    }
}

fn env_u32(key: &str) -> Option<u32> {
    std::env::var(key).ok().and_then(|v| v.trim().parse().ok())
}

fn caps_for(platform: &str) -> (u32, u32) {
    let (d, h) = default_caps(platform);
    let up = platform.to_ascii_uppercase();
    let day = env_u32(&format!("HIREMEOPS_RATE_{up}_DAY")).unwrap_or(d);
    let hour = env_u32(&format!("HIREMEOPS_RATE_{up}_HOUR")).unwrap_or(h);
    (day, hour)
}

// Count completed applies to `platform` with finished_at >= cutoff. `finished_at` is RFC-3339 UTC
// (util::now_iso), so a plain string comparison is a correct chronological filter.
async fn count_since(db: &SqlitePool, platform: &str, cutoff: &str) -> u32 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM automation_tasks
         WHERE task_type = 'apply_job' AND status = 'completed'
           AND finished_at >= ?1
           AND lower(json_extract(payload_json, '$.platform')) = lower(?2)",
    )
    .bind(cutoff)
    .bind(platform)
    .fetch_one(db)
    .await
    .unwrap_or(0) as u32
}

/// Decide whether one more apply to `platform` is within its rolling 24h / 1h budget.
pub async fn rate_check(db: &SqlitePool, platform: &str) -> RateDecision {
    let (cap_day, cap_hour) = caps_for(platform);
    let now = OffsetDateTime::now_utc();
    let day_cut = (now - Duration::hours(24))
        .format(&Rfc3339)
        .unwrap_or_default();
    let hour_cut = (now - Duration::hours(1))
        .format(&Rfc3339)
        .unwrap_or_default();

    let used_day = count_since(db, platform, &day_cut).await;
    let used_hour = count_since(db, platform, &hour_cut).await;

    let (allowed, reason) = if used_day >= cap_day {
        (
            false,
            Some(format!(
                "{platform}: daily cap reached ({used_day}/{cap_day} in 24h) — deferred"
            )),
        )
    } else if used_hour >= cap_hour {
        (
            false,
            Some(format!(
                "{platform}: hourly cap reached ({used_hour}/{cap_hour} in 1h) — pacing"
            )),
        )
    } else {
        (true, None)
    };

    RateDecision {
        allowed,
        reason,
        used_day,
        cap_day,
        used_hour,
        cap_hour,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        assert_eq!(default_caps("linkedin"), (30, 8));
        assert_eq!(default_caps("LinkedIn"), (30, 8)); // case-insensitive
        assert_eq!(default_caps("unknown"), (40, 12));
        // hour cap must be below the day cap on every board or the hour gate is dead.
        for p in [
            "linkedin", "indeed", "upwork", "gupy", "catho", "infojobs", "x",
        ] {
            let (d, h) = default_caps(p);
            assert!(h < d, "{p}: hour cap {h} should be < day cap {d}");
        }
    }

    #[test]
    fn env_override_wins() {
        std::env::set_var("HIREMEOPS_RATE_TESTBOARD_DAY", "5");
        std::env::set_var("HIREMEOPS_RATE_TESTBOARD_HOUR", "2");
        assert_eq!(caps_for("testboard"), (5, 2));
        assert_eq!(caps_for("TestBoard"), (5, 2)); // env key uppercased
        std::env::remove_var("HIREMEOPS_RATE_TESTBOARD_DAY");
        std::env::remove_var("HIREMEOPS_RATE_TESTBOARD_HOUR");
        // Falls back to defaults when unset.
        assert_eq!(caps_for("indeed"), (40, 12));
    }
}
