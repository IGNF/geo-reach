//! The C exports the page calls: one engine per module instance, its buffers reached through their pointers.

use crate::dijkstra::Engine;
use std::cell::RefCell;

thread_local! {
    static ENGINE: RefCell<Engine> = RefCell::new(Engine::default());
}

/// Allocates every buffer; their pointers stay valid until the next call
#[unsafe(no_mangle)]
pub extern "C" fn reserve(nodes: u32, arcs: u32, sources: u32) {
    ENGINE.with_borrow_mut(|e| e.reserve(nodes as usize, arcs as usize, sources as usize));
}

#[unsafe(no_mangle)]
pub extern "C" fn run(sources: u32, max_cost: f32) -> u32 {
    ENGINE.with_borrow_mut(|e| e.run(sources as usize, max_cost))
}

macro_rules! buffer_ptr {
    ($($name:ident: $field:ident -> $ty:ty),* $(,)?) => {
        $(
            #[unsafe(no_mangle)]
            pub extern "C" fn $name() -> *mut $ty {
                ENGINE.with_borrow_mut(|e| e.$field.as_mut_ptr())
            }
        )*
    };
}

buffer_ptr! {
    offsets_ptr: offsets -> u32,
    heads_ptr: heads -> u32,
    costs_ptr: costs -> f32,
    arc_edge_ptr: arc_edge -> u32,
    src_nodes_ptr: src_nodes -> u32,
    src_costs_ptr: src_costs -> f32,
    dist_ptr: dist -> f32,
    pred_node_ptr: pred_node -> u32,
    pred_edge_ptr: pred_edge -> u32,
}
