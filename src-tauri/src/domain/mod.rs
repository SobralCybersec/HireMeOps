//! Domain layer: service trait contracts and DTO shapes, one submodule per feature area.
//! Key: DomainError — shared error type for domain services
//! Key: DomainResult<T> — Result<T, DomainError> alias used across all domain services
#![allow(dead_code)]

pub mod ai;
pub mod applications;
pub mod automation;
pub mod cv;
pub mod exports;
pub mod ids;
pub mod jobs;
pub mod profile_sync;
pub mod profile_variants;
pub mod rate;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error(transparent)]
    Storage(#[from] sqlx::Error),
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type DomainResult<T> = Result<T, DomainError>;
