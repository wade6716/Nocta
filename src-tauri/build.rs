fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/mpv_embed_macos.m")
            .file("src/audio_route_macos.m")
            .flag("-fobjc-arc")
            .compile("nocta_mpv_embed");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        println!("cargo:rerun-if-changed=src/mpv_embed_macos.m");
        println!("cargo:rerun-if-changed=src/audio_route_macos.m");
    }

    tauri_build::build()
}
