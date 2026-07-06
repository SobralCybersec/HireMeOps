//! Browser automation supervisor (Phase 4+).
//!
//! Owns `browser_sessions`, captures `automation_evidence`, and pauses for
//! human intervention on captcha/anti-bot walls. The supervisor subscribes to
//! the emergency-stop signal to abort every in-flight session immediately.

use super::{DomainError, DomainResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutomationStatus {
    Idle,
    Running,
    PausedForCaptcha,
    Stopped,
}

/// Drives `automation_tasks` through a real (Playwright/Chromium) browser while
/// never bypassing captcha or anti-bot defenses — it pauses and hands control
/// to the user, per the non-negotiable safety rules.
#[allow(async_fn_in_trait)]
pub trait AutomationSupervisor: Send + Sync {
    async fn start_task(&self, automation_task_id: &str) -> DomainResult<()>;
    async fn stop_all(&self) -> DomainResult<()>;
    fn status(&self) -> AutomationStatus;
}

pub struct AutomationSupervisorStub;

impl AutomationSupervisor for AutomationSupervisorStub {
    async fn start_task(&self, _automation_task_id: &str) -> DomainResult<()> {
        Err(DomainError::NotImplemented("AutomationSupervisor::start_task"))
    }
    async fn stop_all(&self) -> DomainResult<()> {
        // Safe no-op in Phase 1: nothing is running yet.
        Ok(())
    }
    fn status(&self) -> AutomationStatus {
        AutomationStatus::Idle
    }
}
