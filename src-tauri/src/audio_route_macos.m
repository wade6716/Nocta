#import <CoreAudio/CoreAudio.h>
#import <CoreFoundation/CoreFoundation.h>
#import <Foundation/Foundation.h>

extern void nocta_on_macos_audio_output_changed(
    bool previous_removed,
    bool previous_was_headphone,
    const char *previous_name,
    const char *current_name
);

static AudioDeviceID g_last_device_id = kAudioObjectUnknown;
static BOOL g_last_was_headphone = NO;
static NSString *g_last_device_name = nil;
static UInt32 g_last_data_source = 0;
static BOOL g_listener_installed = NO;

static NSString *nocta_get_device_name(AudioDeviceID deviceId) {
    if (deviceId == kAudioObjectUnknown) return @"";
    CFStringRef nameRef = NULL;
    UInt32 size = sizeof(nameRef);
    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyDeviceNameCFString,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectGetPropertyData(deviceId, &addr, 0, NULL, &size, &nameRef) == noErr && nameRef != NULL) {
        NSString *name = [(__bridge_transfer NSString *)nameRef copy];
        return name ?: @"";
    }
    return @"";
}

static UInt32 nocta_get_device_transport(AudioDeviceID deviceId) {
    if (deviceId == kAudioObjectUnknown) return 0;
    UInt32 transport = 0;
    UInt32 size = sizeof(transport);
    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyTransportType,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectGetPropertyData(deviceId, &addr, 0, NULL, &size, &transport) == noErr) {
        return transport;
    }
    return 0;
}

static UInt32 nocta_get_output_data_source(AudioDeviceID deviceId) {
    if (deviceId == kAudioObjectUnknown) return 0;
    UInt32 source = 0;
    UInt32 size = sizeof(source);
    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyDataSource,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectHasProperty(deviceId, &addr) &&
        AudioObjectGetPropertyData(deviceId, &addr, 0, NULL, &size, &source) == noErr) {
        return source;
    }
    return 0;
}

static AudioDeviceID nocta_get_default_output_device(void) {
    AudioDeviceID deviceId = kAudioObjectUnknown;
    UInt32 size = sizeof(deviceId);
    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &size, &deviceId) == noErr) {
        return deviceId;
    }
    return kAudioObjectUnknown;
}

static BOOL nocta_is_device_present(AudioDeviceID targetId) {
    if (targetId == kAudioObjectUnknown) return NO;
    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, NULL, &size) != noErr || size == 0) {
        return NO;
    }
    UInt32 count = size / sizeof(AudioDeviceID);
    AudioDeviceID *devices = (AudioDeviceID *)malloc(size);
    if (!devices) return NO;
    BOOL found = NO;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &size, devices) == noErr) {
        for (UInt32 i = 0; i < count; i++) {
            if (devices[i] == targetId) {
                found = YES;
                break;
            }
        }
    }
    free(devices);
    return found;
}

static BOOL nocta_is_headphone_device(AudioDeviceID deviceId, UInt32 dataSource) {
    if (deviceId == kAudioObjectUnknown) return NO;
    UInt32 transport = nocta_get_device_transport(deviceId);
    if (transport == kAudioDeviceTransportTypeBluetooth ||
        transport == kAudioDeviceTransportTypeBluetoothLE) {
        return YES;
    }
    // 内置声卡插入 3.5mm 耳机时 dataSource 为 'hdpn' (0x6864706E)
    if (dataSource == 'hdpn') {
        return YES;
    }
    return NO;
}

static OSStatus nocta_data_source_listener(
    AudioObjectID inObjectID,
    UInt32 inNumberAddresses,
    const AudioObjectPropertyAddress *inAddresses,
    void *inClientData
) {
    (void)inNumberAddresses;
    (void)inAddresses;
    (void)inClientData;

    if (inObjectID != g_last_device_id) {
        return noErr;
    }

    UInt32 newSource = nocta_get_output_data_source(inObjectID);
    if (newSource == g_last_data_source) {
        return noErr;
    }

    BOOL wasHeadphone = (g_last_data_source == 'hdpn');
    BOOL isNowSpeaker = (newSource == 'ispk');
    g_last_data_source = newSource;
    g_last_was_headphone = nocta_is_headphone_device(inObjectID, newSource);

    if (wasHeadphone && isNowSpeaker) {
        NSString *name = nocta_get_device_name(inObjectID);
        g_last_device_name = name;
        nocta_on_macos_audio_output_changed(
            true,
            true,
            "Headphones",
            [name UTF8String]
        );
    }

    return noErr;
}

static void nocta_attach_data_source_listener(AudioDeviceID oldId, AudioDeviceID newId) {
    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyDataSource,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    if (oldId != kAudioObjectUnknown) {
        AudioObjectRemovePropertyListener(oldId, &addr, nocta_data_source_listener, NULL);
    }
    if (newId != kAudioObjectUnknown && AudioObjectHasProperty(newId, &addr)) {
        AudioObjectAddPropertyListener(newId, &addr, nocta_data_source_listener, NULL);
    }
}

static OSStatus nocta_default_device_listener(
    AudioObjectID inObjectID,
    UInt32 inNumberAddresses,
    const AudioObjectPropertyAddress *inAddresses,
    void *inClientData
) {
    (void)inObjectID;
    (void)inNumberAddresses;
    (void)inAddresses;
    (void)inClientData;

    AudioDeviceID newId = nocta_get_default_output_device();
    if (newId == g_last_device_id) {
        return noErr;
    }

    AudioDeviceID prevId = g_last_device_id;
    BOOL prevWasHeadphone = g_last_was_headphone;
    NSString *prevName = g_last_device_name ?: @"";

    BOOL prevRemoved = (prevId != kAudioObjectUnknown) && !nocta_is_device_present(prevId);
    UInt32 newSource = nocta_get_output_data_source(newId);
    NSString *newName = nocta_get_device_name(newId);

    nocta_attach_data_source_listener(prevId, newId);
    g_last_device_id = newId;
    g_last_data_source = newSource;
    g_last_was_headphone = nocta_is_headphone_device(newId, newSource);
    g_last_device_name = newName;

    if (prevId != kAudioObjectUnknown) {
        nocta_on_macos_audio_output_changed(
            prevRemoved,
            prevWasHeadphone,
            [prevName UTF8String],
            [newName UTF8String]
        );
    }

    return noErr;
}

void nocta_start_macos_audio_route_monitor(void) {
    if (g_listener_installed) return;
    g_listener_installed = YES;

    g_last_device_id = nocta_get_default_output_device();
    g_last_data_source = nocta_get_output_data_source(g_last_device_id);
    g_last_was_headphone = nocta_is_headphone_device(g_last_device_id, g_last_data_source);
    g_last_device_name = nocta_get_device_name(g_last_device_id);
    nocta_attach_data_source_listener(kAudioObjectUnknown, g_last_device_id);

    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioObjectAddPropertyListener(
        kAudioObjectSystemObject,
        &addr,
        nocta_default_device_listener,
        NULL
    );
}
