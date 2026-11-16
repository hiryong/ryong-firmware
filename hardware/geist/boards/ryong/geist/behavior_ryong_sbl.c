/* &sbl SBL_TOG / SBL_ON / SBL_OFF / SBL_UP / SBL_DN — geist geist-UG4-SB Smart Backlight */
#define DT_DRV_COMPAT ryong_behavior_smart_backlight

#include <zephyr/device.h>
#include <drivers/behavior.h>
#include <zmk/behavior.h>
#include "ryong_smartbl.h"

#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)

#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
static const struct behavior_parameter_value_metadata vals[] = {
    {.display_name = "Toggle On/Off", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = SBL_TOG},
    {.display_name = "Turn On", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = SBL_ON},
    {.display_name = "Turn Off", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = SBL_OFF},
    {.display_name = "More Sensitive", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = SBL_UP},
    {.display_name = "Less Sensitive", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = SBL_DN},
};
static const struct behavior_parameter_metadata_set set = {.param1_values = vals, .param1_values_len = ARRAY_SIZE(vals)};
static const struct behavior_parameter_metadata metadata = {.sets_len = 1, .sets = &set};
#endif

static int pressed(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event)
{
    return ryong_sbl_set(binding->param1);
}
static int released(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event)
{
    return ZMK_BEHAVIOR_OPAQUE;
}
static const struct behavior_driver_api api = {
    .binding_pressed = pressed,
    .binding_released = released,
    .locality = BEHAVIOR_LOCALITY_CENTRAL,
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
    .parameter_metadata = &metadata,
#endif
};
BEHAVIOR_DT_INST_DEFINE(0, NULL, NULL, NULL, NULL, POST_KERNEL, CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &api);
#endif
