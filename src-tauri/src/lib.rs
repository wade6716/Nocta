mod proxy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_libmpv::init())
        .invoke_handler(tauri::generate_handler![proxy::get_system_proxy])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
