/* SPDX-License-Identifier: MIT */
#define DT_DRV_COMPAT ryong_behavior_named_runtime_macro

#include <zephyr/device.h>
#include <zephyr/logging/log.h>
#include <drivers/behavior.h>
#include <zmk/behavior.h>
#include <cormoran/zmk/runtime_macro.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

struct named_macro_config {
    const char *name;
};

static int pressed(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    const struct device *dev = zmk_behavior_get_binding(binding->behavior_dev);
    const struct named_macro_config *cfg = dev->config;
    uint32_t slot;
    int ret = zmk_runtime_macro_slot_for_name(cfg->name, &slot);
    if (ret < 0) {
        LOG_WRN("Runtime macro \"%s\" not found (%d)", cfg->name, ret);
        return ZMK_BEHAVIOR_OPAQUE;
    }
    ret = zmk_runtime_macro_play(slot, &event);
    if (ret < 0) LOG_WRN("Runtime macro \"%s\" failed: %d", cfg->name, ret);
    return ZMK_BEHAVIOR_OPAQUE;
}

static int released(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    ARG_UNUSED(binding);
    ARG_UNUSED(event);
    return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api api = {
    .binding_pressed = pressed,
    .binding_released = released,
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
    .get_parameter_metadata = zmk_behavior_get_empty_param_metadata,
#endif
};

#define NAMED_MACRO_INST(n)                                                                        \
    static const struct named_macro_config named_macro_config_##n = {                              \
        .name = DT_INST_PROP(n, macro_name),                                                       \
    };                                                                                             \
    BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, &named_macro_config_##n, POST_KERNEL,             \
                            CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &api);

DT_INST_FOREACH_STATUS_OKAY(NAMED_MACRO_INST)
