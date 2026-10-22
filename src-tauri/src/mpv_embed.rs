#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{c_char, c_void, CString};

    extern "C" {
        fn nocta_attach_mpv_window(parent: *mut c_void, title: *const c_char) -> i32;
        fn nocta_detach_mpv_window();
    }

    pub fn attach(parent: *mut c_void, title: &str) -> Result<bool, String> {
        let title = CString::new(title).map_err(|_| "Invalid mpv window title".to_string())?;
        Ok(unsafe { nocta_attach_mpv_window(parent, title.as_ptr()) == 1 })
    }

    pub fn detach() {
        unsafe { nocta_detach_mpv_window() };
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::ffi::c_void;

    pub fn attach(_parent: *mut c_void, _title: &str) -> Result<bool, String> {
        Ok(false)
    }

    pub fn detach() {}
}

pub use platform::{attach, detach};
