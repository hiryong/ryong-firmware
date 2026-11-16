/*
 * geist Ver2: 고속 충전기(USB-C 1.5 A / 3 A 광고)일 때 충전 칩 BQ24075 를 ILIM 모드로.
 *
 *  하드웨어 (V3 와 같은 방식)
 *   - CC_SENSE = P0.03(AIN1): CC1·CC2 를 각각 220k 로 한 점에 합침 → 연결된 쪽 CC 전압의 1/2 (다른 쪽 CC 는 Rd 로 0 V)
 *       USB-C 규격 (Rd 5.1k 에서 본 CC 전압):  기본 0.25~0.61 V,  1.5 A 0.70~1.16 V,  3 A 1.31~2.04 V
 *       → 측정값(1/2):                         기본 ≤ 0.31 V,     1.5 A 0.35~0.58 V,   3 A ≥ 0.65 V
 *   - BQ_EN2 = P1.02. EN1 = NOT EN2 (Q83 2N7002 + R27 100k → VBUS). R28 100k 풀다운
 *       EN2=0, EN1=1 : USB500 (기본, MCU 가 꺼져 있거나 리셋 중일 때도 이 상태)
 *       EN2=1, EN1=0 : ILIM (R14 1.8k → 약 0.86 A)
 *       EN2=1, EN1=1 (Standby, 입력 차단) 은 하드웨어로 만들 수 없음
 *
 *  판단: USB 가 꽂혀 있는 동안 1초마다 측정. 0.33 V 이상 3번 연속 → 고속, 0.29 V 미만 2번 연속 또는 USB 뺌 → 기본.
 *  실제 광고 전류(Rp 전류원/저항, 부품 공차, SAADC 1.5 %)로 계산한 최악값: 기본 ≤ 0.253 V, 1.5 A ≥ 0.408 V, 3 A ≥ 0.759 V
 *  → 0.33 V 는 양쪽에 약 77 mV 여유. A-to-C 케이블(56k)은 0.19~0.25 V 로 기본.
 */
#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/adc.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/init.h>
#include <zephyr/logging/log.h>
#include <zmk/event_manager.h>
#include <zmk/events/usb_conn_state_changed.h>
#include <zmk/usb.h>
#include "ryong_keyleds.h"

LOG_MODULE_REGISTER(ryong_charger, CONFIG_ZMK_LOG_LEVEL);

#define USER DT_PATH(zephyr_user)

static const struct adc_dt_spec cc = ADC_DT_SPEC_GET_BY_IDX(USER, 0);
static const struct gpio_dt_spec en2 = GPIO_DT_SPEC_GET(USER, bq_en2_gpios);

static bool fast;
static int up, down;
static bool ready;

bool ryong_charger_fast(void) { return fast; }

static void set_fast(bool f) {
    if (f == fast) {
        return;
    }
    fast = f;
    gpio_pin_set_dt(&en2, f ? 1 : 0);
    LOG_INF("charger %s", f ? "fast (ILIM ~0.89 A)" : "default (USB500)");
    ryong_keyleds_rebudget();
#if IS_ENABLED(CONFIG_RYONG_UG_BAT_GUARD)
    ryong_ug_batt_recheck(); /* plain USB keeps the battery guard on the underglow, a fast charger lifts it */
#endif
}

static int read_mv(int32_t *mv) {
    int16_t raw = 0;
    struct adc_sequence seq = {.buffer = &raw, .buffer_size = sizeof(raw)};
    int err = adc_sequence_init_dt(&cc, &seq);
    if (!err) {
        err = adc_read_dt(&cc, &seq);
    }
    if (err) {
        return err;
    }
    *mv = raw < 0 ? 0 : raw;
    return adc_raw_to_millivolts_dt(&cc, mv);
}

static void poll_fn(struct k_work *w);
static K_WORK_DELAYABLE_DEFINE(poll_work, poll_fn);

static void poll_fn(struct k_work *w) {
    if (!ready) {
        return;
    }
    if (!zmk_usb_is_powered()) {
        up = down = 0;
        set_fast(false);
        return;
    }
    int32_t mv;
    if (read_mv(&mv) == 0) {
        set_fast(ryong_charger_classify(mv, fast, &up, &down) == 1);
    }
    k_work_reschedule(&poll_work, K_SECONDS(1));
}

void ryong_charger_off(void) {
    /* before System OFF: default mode, both NFC pins low */
    k_work_cancel_delayable(&poll_work);
    fast = false;
    if (ready) {
        gpio_pin_set_dt(&en2, 0);
    }
}

static int charger_usb_listener(const zmk_event_t *eh) {
    if (!ready) {
        return ZMK_EV_EVENT_BUBBLE;
    }
    if (zmk_usb_is_powered()) {
        k_work_reschedule(&poll_work, K_MSEC(500)); /* let CC settle after attach */
    } else {
        k_work_cancel_delayable(&poll_work);
        up = down = 0;
        set_fast(false);
    }
    return ZMK_EV_EVENT_BUBBLE;
}
ZMK_LISTENER(ryong_charger, charger_usb_listener);
ZMK_SUBSCRIPTION(ryong_charger, zmk_usb_conn_state_changed);

static int charger_init(void) {
    if (!gpio_is_ready_dt(&en2) || gpio_pin_configure_dt(&en2, GPIO_OUTPUT_INACTIVE)) {
        LOG_ERR("BQ_EN2 gpio not ready");
        return 0;
    }
    if (!adc_is_ready_dt(&cc) || adc_channel_setup_dt(&cc)) {
        LOG_ERR("CC_SENSE adc not ready");
        return 0; /* EN2 stays low: default USB500, the safe state */
    }
    ready = true;
    if (zmk_usb_is_powered()) {
        k_work_reschedule(&poll_work, K_SECONDS(1));
    }
    return 0;
}
SYS_INIT(charger_init, APPLICATION, 90);
