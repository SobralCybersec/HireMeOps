//! Domain layer — service traits and module skeleton (Phase 1).
//!
//! Each submodule owns one feature area. Phase 1 defines the trait contracts
//! and DTO shapes only; concrete implementations land in later phases. Keeping
//! the traits here lets commands and the automation supervisor depend on
//! abstractions rather than concrete engines (e.g. swap AI providers or the
//! browser backend without touching callers).
//!
//! Phase 1 ships trait + stub definitions that are not yet wired into any
//! caller, so intentional dead-code is allowed crate-wide for this module tree.
#![allow(dead_code)]

pub mod ai;
pub mod applications;
pub mod automation;
pub mod cv;
pub mod exports;
pub mod jobs;

use thiserror::Error;

/// Shared error type for domain services.
#[derive(Debug, Error)]
pub enum DomainError {
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error(transparent)]
    Storage(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type DomainResult<T> = Result<T, DomainError>;
