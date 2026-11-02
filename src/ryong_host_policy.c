#include "ryong_fw/host_policy.h"
#include <string.h>

static bool valid_os(ry_host_os_t os) {
    return os >= RY_OS_UNKNOWN && os <= RY_OS_ANDROID;
}
void ry_host_policy_init(ry_host_policy_t *policy) {
    if (policy) memset(policy, 0, sizeof(*policy));
}
bool ry_host_bind(ry_host_profile_t *profile, uint32_t generation) {
    if (!profile || !generation) return false;
    if (profile->bond_generation != generation) {
        memset(profile, 0, sizeof(*profile));
        profile->bond_generation = generation;
    }
    return true;
}
bool ry_host_override(ry_host_profile_t *profile, ry_host_os_t os) {
    if (!profile || !valid_os(os)) return false;
    profile->override_os = os;
    return true;
}
bool ry_host_observe(ry_host_profile_t *profile, uint32_t generation,
                     ry_host_os_t os, bool settled) {
    if (!profile || !generation || profile->bond_generation != generation ||
        !valid_os(os) || os == RY_OS_UNKNOWN || !settled) return false;
    profile->detected = os;
    return true;
}
ry_host_os_t ry_host_effective_os(const ry_host_profile_t *profile) {
    if (!profile) return RY_OS_UNKNOWN;
    return profile->override_os != RY_OS_UNKNOWN ? profile->override_os : profile->detected;
}
bool ry_host_should_swap(const ry_host_profile_t *profile) {
    if (!profile || profile->base_layout == RY_LAYOUT_UNCHANGED) return false;
    const ry_host_os_t os = ry_host_effective_os(profile);
    if (!valid_os(os) || os == RY_OS_UNKNOWN) return false;
    const bool apple = os == RY_OS_MACOS || os == RY_OS_IOS;
    if (profile->base_layout == RY_LAYOUT_WINDOWS) return apple;
    if (profile->base_layout == RY_LAYOUT_APPLE) return !apple;
    return false;
}
bool ry_host_latched_swap(const ry_host_profile_t *profile, unsigned held_keys, bool current_swap) {
    return held_keys ? current_swap : ry_host_should_swap(profile);
}
uint16_t ry_host_modifier_usage(uint16_t usage, bool swap, bool swap_right) {
    if (!swap) return usage;
    switch (usage) {
    case 0xe2: return 0xe3; /* Left Alt -> Left GUI */
    case 0xe3: return 0xe2;
    case 0xe6: return swap_right ? 0xe7 : usage;
    case 0xe7: return swap_right ? 0xe6 : usage;
    default: return usage;
    }
}
