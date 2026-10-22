fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/mpv_embed_macos.m")
            .flag("-fobjc-arc")
            .compile("nocta_mpv_embed");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rerun-if-changed=src/mpv_embed_macos.m");
    }

    tauri_build::build()
}
