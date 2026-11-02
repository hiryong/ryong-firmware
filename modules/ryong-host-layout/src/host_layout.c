#include <ryong/host_layout.h>
void ry_layout_observe(struct ry_layout_state *s, bool apple, int64_t now, int64_t settle) {
    s->pending_apple = apple;
    s->deadline = now + settle;
}
void ry_layout_endpoint_reset(struct ry_layout_state *s, unsigned held) {
    s->pending_apple = false;
    s->deadline = 0;
    if (!held) s->apple = false;
}
void ry_layout_tick(struct ry_layout_state *s, int64_t now, unsigned held) {
    if (!held && now >= s->deadline) s->apple = s->pending_apple;
}
bool ry_layout_press(struct ry_layout_state *s, unsigned position, uint32_t windows, uint32_t apple, uint32_t *usage) {
    if (position >= RY_LAYOUT_POSITIONS || s->pressed[position] || !windows || !apple) return false;
    *usage = s->apple ? apple : windows;
    s->pressed[position] = *usage;
    return true;
}
bool ry_layout_release(struct ry_layout_state *s, unsigned position, uint32_t *usage) {
    if (position >= RY_LAYOUT_POSITIONS || !s->pressed[position]) return false;
    *usage = s->pressed[position];
    s->pressed[position] = 0;
    return true;
}
