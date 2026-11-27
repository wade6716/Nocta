#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{c_char, c_void, CString};

    extern "C" {
        fn nocta_attach_mpv_window(parent: *mut c_void, title: *const c_char) -> i32;
        fn nocta_detach_mpv_window();
        fn nocta_configure_osd_overlay(window: *mut c_void);
        fn nocta_configure_main_window(window: *mut c_void);
        fn nocta_focus_webview(window: *mut c_void);
        fn nocta_protect_app_icon(fallback_icon_bytes: *const c_void, fallback_icon_len: usize);
    }

    pub fn attach(parent: *mut c_void, title: &str) -> Result<bool, String> {
        let title = CString::new(title).map_err(|_| "Invalid mpv window title".to_string())?;
        Ok(unsafe { nocta_attach_mpv_window(parent, title.as_ptr()) == 1 })
    }

    pub fn detach() {
        unsafe { nocta_detach_mpv_window() };
    }

    pub fn configure_osd_overlay(window: *mut c_void) {
        unsafe { nocta_configure_osd_overlay(window) };
    }

    pub fn configure_main_window(window: *mut c_void) {
        unsafe { nocta_configure_main_window(window) };
    }

    pub fn focus_webview(window: *mut c_void) {
        unsafe { nocta_focus_webview(window) };
    }

    pub fn protect_app_icon(fallback_icon: Option<&[u8]>) {
        match fallback_icon {
            Some(bytes) if !bytes.is_empty() => unsafe {
                nocta_protect_app_icon(bytes.as_ptr() as *const c_void, bytes.len());
            },
            _ => unsafe {
                nocta_protect_app_icon(std::ptr::null(), 0);
            },
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::ffi::c_void;

    pub fn attach(_parent: *mut c_void, _title: &str) -> Result<bool, String> {
        Ok(false)
    }

    pub fn detach() {}

    pub fn configure_osd_overlay(_window: *mut c_void) {}

    pub fn configure_main_window(_window: *mut c_void) {}

    pub fn focus_webview(_window: *mut c_void) {}

    pub fn protect_app_icon(_fallback_icon: Option<&[u8]>) {}
}

pub use platform::{
    attach, configure_main_window, configure_osd_overlay, detach, focus_webview, protect_app_icon,
};
