//! Travel time engine of geo-reach, compiled to WebAssembly.
//!
//! A bounded multi-source Dijkstra over a road graph stored as compressed rows (CSR). The page writes the graph of the
//! current profile (mode and direction) once into buffers owned by the module, then calls [`run`] on every cursor
//! move: the shortest times land in the `dist` buffer, which the page reads in place (no copy, no allocation).
//!
//! Raw `extern "C"` exports, no bindings generator: the page reaches every buffer through its pointer in the
//! module memory.

use std::cell::RefCell;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// No predecessor, or unreachable
pub const NONE: u32 = u32::MAX;

#[derive(Default)]
pub struct Engine {
    /// Arcs of node `n` are `offsets[n]..offsets[n + 1]`
    pub offsets: Vec<u32>,
    /// Head node of each arc
    pub heads: Vec<u32>,
    /// Cost of each arc, in seconds
    pub costs: Vec<f32>,
    /// Road section of each arc, to rebuild a path
    pub arc_edge: Vec<u32>,
    pub src_nodes: Vec<u32>,
    pub src_costs: Vec<f32>,
    /// Shortest time of each node, `f32::INFINITY` beyond the bound
    pub dist: Vec<f32>,
    pub pred_node: Vec<u32>,
    pub pred_edge: Vec<u32>,
    heap: BinaryHeap<Reverse<(u32, u32)>>,
    /// Nodes reached by the previous run, reset lazily
    touched: Vec<u32>,
}

impl Engine {
    pub fn reserve(&mut self, nodes: usize, arcs: usize, sources: usize) {
        self.offsets = vec![0; nodes + 1];
        self.heads = vec![0; arcs];
        self.costs = vec![0.0; arcs];
        self.arc_edge = vec![0; arcs];
        self.src_nodes = vec![0; sources];
        self.src_costs = vec![0.0; sources];
        self.dist = vec![f32::INFINITY; nodes];
        self.pred_node = vec![NONE; nodes];
        self.pred_edge = vec![NONE; nodes];
        self.heap = BinaryHeap::with_capacity(arcs + sources);
        self.touched = Vec::with_capacity(nodes);
    }

    /// Shortest times from the first `sources` sources (each with its starting cost), up to `max_cost` seconds.
    /// Returns the number of settled nodes.
    pub fn run(&mut self, sources: usize, max_cost: f32) -> u32 {
        for &n in &self.touched {
            self.dist[n as usize] = f32::INFINITY;
            self.pred_node[n as usize] = NONE;
            self.pred_edge[n as usize] = NONE;
        }
        self.touched.clear();
        self.heap.clear();
        for i in 0..sources {
            let (n, c) = (self.src_nodes[i] as usize, self.src_costs[i]);
            if c < self.dist[n] && c <= max_cost {
                if self.dist[n].is_infinite() {
                    self.touched.push(n as u32);
                }
                self.dist[n] = c;
                // Non-negative floats order like their bit patterns
                self.heap.push(Reverse((c.to_bits(), n as u32)));
            }
        }
        let mut settled = 0;
        while let Some(Reverse((bits, n))) = self.heap.pop() {
            let d = f32::from_bits(bits);
            let n = n as usize;
            if d > self.dist[n] {
                continue;
            }
            settled += 1;
            for arc in self.offsets[n] as usize..self.offsets[n + 1] as usize {
                let next = d + self.costs[arc];
                let head = self.heads[arc] as usize;
                if next < self.dist[head] && next <= max_cost {
                    if self.dist[head].is_infinite() {
                        self.touched.push(head as u32);
                    }
                    self.dist[head] = next;
                    self.pred_node[head] = n as u32;
                    self.pred_edge[head] = self.arc_edge[arc];
                    self.heap.push(Reverse((next.to_bits(), head as u32)));
                }
            }
        }
        settled
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    /// 0 → 1 → 2, and a slower 0 → 2
    fn line() -> Engine {
        let mut e = Engine::default();
        e.reserve(3, 3, 1);
        e.offsets.copy_from_slice(&[0, 2, 3, 3]);
        e.heads.copy_from_slice(&[1, 2, 2]);
        e.costs.copy_from_slice(&[10.0, 50.0, 10.0]);
        e.arc_edge.copy_from_slice(&[7, 8, 9]);
        e
    }

    #[test]
    fn shortest_times_and_path() {
        let mut e = line();
        e.src_nodes[0] = 0;
        e.src_costs[0] = 5.0;
        assert_eq!(e.run(1, 1000.0), 3);
        assert_eq!(e.dist, vec![5.0, 15.0, 25.0]);
        assert_eq!((e.pred_node[2], e.pred_edge[2]), (1, 9));
    }

    #[test]
    fn bound_and_reset_between_runs() {
        let mut e = line();
        e.src_nodes[0] = 0;
        e.src_costs[0] = 0.0;
        e.run(1, 12.0);
        assert!(e.dist[2].is_infinite());
        e.src_nodes[0] = 2;
        e.run(1, 100.0);
        assert_eq!(e.dist[2], 0.0);
        assert!(e.dist[0].is_infinite() && e.dist[1].is_infinite());
        assert_eq!(e.pred_node[1], NONE);
    }
}
