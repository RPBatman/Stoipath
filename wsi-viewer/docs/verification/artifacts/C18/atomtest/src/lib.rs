pub static X: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0); #[no_mangle] pub extern "C" fn inc()->u32{ X.fetch_add(1, std::sync::atomic::Ordering::SeqCst) }
