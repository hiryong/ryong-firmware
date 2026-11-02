#ifndef RYONG_HOST_LAYOUT_H
#define RYONG_HOST_LAYOUT_H
#include <stdbool.h>
#include <stdint.h>
#define RY_LAYOUT_POSITIONS 96
struct ry_layout_state {
    bool apple, pending_apple;
    int64_t deadline;
    uint32_t pressed[RY_LAYOUT_POSITIONS];
};
void ry_layout_observe(struct ry_layout_state *s, bool apple, int64_t now, int64_t settle);
void ry_layout_endpoint_reset(struct ry_layout_state *s, unsigned held);
void ry_layout_tick(struct ry_layout_state *s, int64_t now, unsigned held);
bool ry_layout_press(struct ry_layout_state *s, unsigned position, uint32_t windows, uint32_t apple, uint32_t *usage);
bool ry_layout_release(struct ry_layout_state *s, unsigned position, uint32_t *usage);
#endif
