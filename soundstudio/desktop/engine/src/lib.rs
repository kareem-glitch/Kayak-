//! SoundStudio audio core, shared by the desktop app's audio callbacks.
//! Mirrors app/audio/worklet.js (the browser version) so both behave the same.
pub mod player;
pub mod mixer;
pub mod blocks;
pub mod link;
pub mod resample;
pub mod direct;

pub const RATE: u32 = 48_000;
pub const FRAMES: usize = 128;   // one block / render quantum (2.67 ms), as in the browser
