#import <Cocoa/Cocoa.h>

static NSWindow *g_parent_window = nil;
static NSWindow *g_mpv_window = nil;
static NSTimer *g_sync_timer = nil;
static id g_enter_fullscreen_observer = nil;
static id g_exit_fullscreen_observer = nil;
static id g_change_screen_observer = nil;

static void reorder_mpv_window_below(void) {
    if (!g_parent_window || !g_mpv_window) {
        return;
    }
    [g_mpv_window setLevel:[g_parent_window level]];
    if ([g_mpv_window parentWindow] != g_parent_window) {
        [g_parent_window addChildWindow:g_mpv_window ordered:NSWindowBelow];
    }
    [g_mpv_window orderWindow:NSWindowBelow relativeTo:[g_parent_window windowNumber]];
}

static void sync_mpv_window(void) {
    if (!g_parent_window || !g_mpv_window) {
        return;
    }
    [g_mpv_window setFrame:[g_parent_window frame] display:YES];
    reorder_mpv_window_below();
}

static NSWindow *find_mpv_window(NSWindow *parent, NSString *title) {
    for (NSWindow *window in [NSApp windows]) {
        if (window == parent) {
            continue;
        }
        if ([[window title] isEqualToString:title]) {
            return window;
        }
    }
    return nil;
}

static void stop_observing_parent_window(void) {
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    if (g_enter_fullscreen_observer) {
        [center removeObserver:g_enter_fullscreen_observer];
        g_enter_fullscreen_observer = nil;
    }
    if (g_exit_fullscreen_observer) {
        [center removeObserver:g_exit_fullscreen_observer];
        g_exit_fullscreen_observer = nil;
    }
    if (g_change_screen_observer) {
        [center removeObserver:g_change_screen_observer];
        g_change_screen_observer = nil;
    }
}

static void observe_parent_window(NSWindow *parent) {
    stop_observing_parent_window();

    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    NSOperationQueue *queue = [NSOperationQueue mainQueue];

    g_enter_fullscreen_observer =
        [center addObserverForName:NSWindowDidEnterFullScreenNotification
                            object:parent
                             queue:queue
                        usingBlock:^(__unused NSNotification *note) {
        sync_mpv_window();
    }];
    g_exit_fullscreen_observer =
        [center addObserverForName:NSWindowDidExitFullScreenNotification
                            object:parent
                             queue:queue
                        usingBlock:^(__unused NSNotification *note) {
        sync_mpv_window();
    }];
    g_change_screen_observer =
        [center addObserverForName:NSWindowDidChangeScreenNotification
                            object:parent
                             queue:queue
                        usingBlock:^(__unused NSNotification *note) {
        sync_mpv_window();
    }];
}

int nocta_attach_mpv_window(void *parent_ptr, const char *title_ptr) {
    if (!parent_ptr || !title_ptr) {
        return 0;
    }

    NSWindow *parent = (__bridge NSWindow *)parent_ptr;
    NSString *title = [NSString stringWithUTF8String:title_ptr];
    if (!title) {
        return 0;
    }

    NSWindow *mpv_window = find_mpv_window(parent, title);
    if (!mpv_window) {
        return 0;
    }

    if (mpv_window != g_mpv_window) {
        if (g_mpv_window) {
            [g_parent_window removeChildWindow:g_mpv_window];
            [g_mpv_window orderOut:nil];
        }

        g_parent_window = parent;
        g_mpv_window = mpv_window;

        [mpv_window setStyleMask:NSWindowStyleMaskBorderless];
        [mpv_window setTitlebarAppearsTransparent:YES];
        [mpv_window setTitleVisibility:NSWindowTitleHidden];
        [mpv_window setMovable:NO];
        [mpv_window setIgnoresMouseEvents:YES];
        [mpv_window setHasShadow:NO];
        [mpv_window setReleasedWhenClosed:NO];
        [mpv_window setHidesOnDeactivate:NO];
        [mpv_window setBackgroundColor:[NSColor blackColor]];
        [mpv_window setLevel:[parent level]];
        [mpv_window setCollectionBehavior:(NSWindowCollectionBehaviorFullScreenAuxiliary |
                                           NSWindowCollectionBehaviorIgnoresCycle)];
    }

    g_parent_window = parent;
    g_mpv_window = mpv_window;
    observe_parent_window(parent);
    sync_mpv_window();

    reorder_mpv_window_below();
    [parent makeKeyAndOrderFront:nil];

    if (!g_sync_timer) {
        g_sync_timer = [NSTimer scheduledTimerWithTimeInterval:0.2
                                                       repeats:YES
                                                         block:^(__unused NSTimer *timer) {
            sync_mpv_window();
        }];
    }

    return 1;
}

void nocta_detach_mpv_window(void) {
    [g_sync_timer invalidate];
    g_sync_timer = nil;
    stop_observing_parent_window();

    if (g_mpv_window && g_parent_window) {
        [g_parent_window removeChildWindow:g_mpv_window];
        [g_mpv_window orderOut:nil];
    }

    g_parent_window = nil;
    g_mpv_window = nil;
}

// 全屏 OSD 浮层：作为全屏辅助窗口加入当前全屏 Space，并压在 mpv 视频窗口之上。
// 窗口本身透明，交互完全由 WebView 内的 React 组件决定。
void nocta_configure_osd_overlay(void *window_ptr) {
    if (!window_ptr) {
        return;
    }

    NSWindow *window = (__bridge NSWindow *)window_ptr;
    [window setLevel:NSStatusWindowLevel];
    [window setCollectionBehavior:(NSWindowCollectionBehaviorFullScreenAuxiliary |
                                    NSWindowCollectionBehaviorIgnoresCycle)];
    [window setHidesOnDeactivate:NO];
    [window setCanHide:NO];
    [window setOpaque:NO];
    [window setBackgroundColor:[NSColor clearColor]];
    [window setHasShadow:NO];
    [window setMovable:NO];
    [window setReleasedWhenClosed:NO];
    [window orderFrontRegardless];
}
