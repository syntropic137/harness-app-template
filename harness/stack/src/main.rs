// harness-stack — stub for the stack-manager slot (S1 r3.3 C20 / bead
// agentic-harness-lab-impl-f-harness-7yf).
//
// The real `stack-manager` plugin (per `harness.manifest.json#slots.stack-manager`)
// is `rust-bollard-portpicker` — a Rust binary using bollard 0.21 + portpicker
// that shells out to `docker compose`. Until the lab ships the real crate, this
// stub exists so the canonical-template's dogfoodability promise (C13:
// `just bootstrap && just test` on a fresh clone) holds.
//
// When `just stack <args>` is invoked, the bash shim at `bin/stack.sh` prints
// the stub line directly (no Rust compile path). When `pnpm turbo run build`
// runs via the slot's `package.json` Turbo wrapper, `cargo build --release`
// produces this binary as a no-op-shaped artifact so the Turbo cache picks
// it up.

fn main() {
    eprintln!("[stub] harness-stack: install a real stack-manager plugin to enable.");
    eprintln!("       See `harness.manifest.json#slots.stack-manager` for the contract.");
    std::process::exit(0);
}
