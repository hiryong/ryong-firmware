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
uint32_t ry_layout_apple_of(uint32_t windows) {
    uint32_t base = windows & 0x00ffffff, mods = windows & 0xff000000;
    switch (base) {
    case 0x700e2: return mods | 0x700e3; /* L Alt -> L Command */
    case 0x700e3: return mods | 0x700e2; /* L Win -> L Option */
    case 0x700e6: return mods | 0x700e7; /* R Alt -> R Command */
    case 0x700e7: return mods | 0x700e6; /* R Win -> R Option */
    default: return windows;
    }
}
bool ry_layout_release(struct ry_layout_state *s, unsigned position, uint32_t *usage) {
    if (position >= RY_LAYOUT_POSITIONS || !s->pressed[position]) return false;
    *usage = s->pressed[position];
    s->pressed[position] = 0;
    return true;
}
