/* SPDX-License-Identifier: MIT */
#define DT_DRV_COMPAT ryong_host_key
#include <zephyr/device.h>
#include <zephyr/kernel.h>
#include <drivers/behavior.h>
#include <zmk/behavior.h>
#include <zmk/event_manager.h>
#include <zmk/events/keycode_state_changed.h>
#include <zmk/events/position_state_changed.h>
#include <zmk/events/endpoint_changed.h>
#include <cormoran/os-detection/os_detection.h>
#include <ryong/host_layout.h>

static struct ry_layout_state state;
static struct k_spinlock state_lock;
static bool physical_down[RY_LAYOUT_POSITIONS];
static unsigned held;
static void settle(struct k_work *work) {
    ARG_UNUSED(work);
    k_spinlock_key_t key = k_spin_lock(&state_lock);
    ry_layout_tick(&state, k_uptime_get(), held);
    k_spin_unlock(&state_lock, key);
}
static K_WORK_DELAYABLE_DEFINE(settle_work, settle);
static void observe(void) {
    enum zmk_os os = zmk_os_detection_current();
    k_spinlock_key_t key = k_spin_lock(&state_lock);
    ry_layout_observe(&state, os == ZMK_OS_MACOS || os == ZMK_OS_IOS,
                      k_uptime_get(), CONFIG_RYONG_HOST_LAYOUT_SETTLE_MS);
    k_spin_unlock(&state_lock, key);
    k_work_reschedule(&settle_work, K_MSEC(CONFIG_RYONG_HOST_LAYOUT_SETTLE_MS));
}
static int listener(const zmk_event_t *eh) {
    const struct zmk_position_state_changed *position = as_zmk_position_state_changed(eh);
    if (position && position->position < RY_LAYOUT_POSITIONS) {
        k_spinlock_key_t key = k_spin_lock(&state_lock);
        unsigned i = position->position;
        if (physical_down[i] != position->state) {
            physical_down[i] = position->state;
            if (position->state) held++; else if (held) held--;
        }
        ry_layout_tick(&state, k_uptime_get(), held);
        k_spin_unlock(&state_lock, key);
    }
    if (as_zmk_endpoint_changed(eh)) {
        k_spinlock_key_t key = k_spin_lock(&state_lock);
        ry_layout_endpoint_reset(&state, held);
        k_spin_unlock(&state_lock, key);
        observe();
    } else if (as_zmk_os_changed(eh)) observe();
    return ZMK_EV_EVENT_BUBBLE;
}
ZMK_LISTENER(ryong_host_layout, listener);
ZMK_SUBSCRIPTION(ryong_host_layout, zmk_position_state_changed);
ZMK_SUBSCRIPTION(ryong_host_layout, zmk_endpoint_changed);
ZMK_SUBSCRIPTION(ryong_host_layout, zmk_os_changed);

static int pressed(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    uint32_t usage;
    k_spinlock_key_t key = k_spin_lock(&state_lock);
    bool ok = ry_layout_press(&state, event.position, binding->param1, binding->param2, &usage);
    k_spin_unlock(&state_lock, key);
    if (!ok) return -EINVAL;
    int rc = raise_zmk_keycode_state_changed_from_encoded(usage, true, event.timestamp);
    if (rc < 0) {
        key = k_spin_lock(&state_lock);
        ry_layout_release(&state, event.position, &usage);
        k_spin_unlock(&state_lock, key);
    }
    return rc;
}
static int released(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    ARG_UNUSED(binding);
    uint32_t usage;
    k_spinlock_key_t key = k_spin_lock(&state_lock);
    bool ok = ry_layout_release(&state, event.position, &usage);
    k_spin_unlock(&state_lock, key);
    return ok ? raise_zmk_keycode_state_changed_from_encoded(usage, false, event.timestamp) : -EINVAL;
}
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
static const struct behavior_parameter_value_metadata windows_values[] = {{
    .display_name = "Windows standard", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE,
}};
static const struct behavior_parameter_value_metadata apple_values[] = {{
    .display_name = "Apple", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE,
}};
static const struct behavior_parameter_metadata_set parameter_set[] = {{
    .param1_values = windows_values, .param1_values_len = ARRAY_SIZE(windows_values),
    .param2_values = apple_values, .param2_values_len = ARRAY_SIZE(apple_values),
}};
static const struct behavior_parameter_metadata metadata = {
    .sets = parameter_set, .sets_len = ARRAY_SIZE(parameter_set),
};
#endif
static const struct behavior_driver_api api = {
    .binding_pressed = pressed, .binding_released = released,
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
    .parameter_metadata = &metadata,
#endif
};
#define INSTANCE(n) BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, NULL, POST_KERNEL, CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &api);
DT_INST_FOREACH_STATUS_OKAY(INSTANCE)
