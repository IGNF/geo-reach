//! Travel time engine of geo-reach, compiled to WebAssembly.
//!
//! A bounded multi-source Dijkstra over a road and transit graph stored as compressed rows (CSR). The page writes
//! the graph of the current profile (mode, direction, hour) once into buffers owned by the module, then calls `run`
//! on every cursor move: the shortest times land in the `dist` buffer, which the page reads in place (no copy, no
//! allocation).
//!
//! Modules: [`dijkstra`] (the graph and the search, plain Rust, tested natively), [`ffi`] (the C exports the page
//! calls, no bindings generator: the page reaches every buffer through its pointer in the module memory).

pub mod dijkstra;
pub mod ffi;

pub use dijkstra::{Engine, NONE};
