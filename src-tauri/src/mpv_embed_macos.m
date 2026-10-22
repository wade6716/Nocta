#import <Cocoa/Cocoa.h>

static NSWindow *g_parent_window = nil;
static NSWindow *g_mpv_window = nil;
static NSTimer *g_sync_timer = nil;

static void sync_mpv_window(void) {
    if (!g_parent_window || !g_mpv_window) {
        return;
    }
    [g_mpv_window setFrame:[g_parent_window frame] display:YES];
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
    sync_mpv_window();

    [mpv_window orderFront:nil];
    [parent addChildWindow:mpv_window ordered:NSWindowBelow];
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

    if (g_mpv_window && g_parent_window) {
        [g_parent_window removeChildWindow:g_mpv_window];
        [g_mpv_window orderOut:nil];
    }

    g_parent_window = nil;
    g_mpv_window = nil;
}
