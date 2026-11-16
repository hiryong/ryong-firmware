/*
 * geist Ver2: Zephyr driver for the ISSI/Lumissil IS31FL3746A (datasheet Rev. C, 04/08/2021).
 *
 * Registers: FEh write 0xC5 unlocks one write of FDh (page select: 0 = PWM, 1 = scaling + function).
 * Page 0 01h-48h PWM, page 1 01h-48h scaling (SL), 50h configuration (SWS D7:D4 = 0000 for 1/4 scan,
 * OSDE D2:D1, SSD D0 = 1 for normal operation), 51h GCC, 52h SW pull-down / CS pull-up (de-ghost,
 * default 0x33), 53h-5Eh open/short, 5Fh thermal roll off, 60h spread spectrum, 8Fh reset (write 0xAE).
 * IOUT(peak) = 343 / RISET x GCC/256 x SL/256; average = IOUT x PWM/256 / 4.14.
 * Register map, page numbers, unlock value and dot order cross-checked against QMK's IS31FL3746A driver
 * (drivers/led/issi/is31fl3746a.[ch]), which ships on production keyboards.
 * The page is selected before every access group instead of being cached across calls, so a reset (8Fh,
 * SDB, power) can never leave the driver thinking it is on a page it is not (the Zephyr IS31FL3733
 * driver has exactly that bug).
 */
#define DT_DRV_COMPAT issi_is31fl3746a

#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/led.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <string.h>
#include <drivers/is31fl3746a.h>

LOG_MODULE_REGISTER(is31fl3746a, CONFIG_LED_LOG_LEVEL);

#define REG_PAGE 0xFD
#define REG_LOCK 0xFE
#define UNLOCK 0xC5
#define PG_PWM 0
#define PG_FUNC 1
#define REG_CONF 0x50
#define REG_GCC 0x51
#define REG_PULL 0x52
#define REG_OPEN 0x53
#define REG_TEMP 0x5F
#define REG_SPREAD 0x60
#define REG_RESET 0x8F
#define RESET_KEY 0xAE

#define CONF_SSD_RUN 0x01
#define CONF_OSD_OPEN 0x02 /* OSDE = 01 */
#define PULL_DEFAULT 0x33  /* 2 kOhm in the off time on SWx and CSy (datasheet default) */
#define TEMP_ROLLOFF 0x0A  /* TS = 10 (100 C), TROF = 10 (55 %) */
#define SPREAD_ON 0x10     /* SSP, +-5 %, 1980 us */

struct is31_cfg {
    struct i2c_dt_spec bus;
    struct gpio_dt_spec sdb;
    struct gpio_dt_spec pwr; /* load switch enable for VCC (optional) */
    uint8_t gcc_max;
    bool spread;
};

struct is31_data {
    uint8_t conf;
    uint8_t page_now; /* page selected by the last page(); 0xFF = unknown. Only blank() relies on it */
    uint8_t buf[IS31FL3746A_DOTS + 1];
    struct k_mutex lock;
};

static int page(const struct device *dev, uint8_t pg)
{
    const struct is31_cfg *cfg = dev->config;
    struct is31_data *d = dev->data;
    int ret = i2c_reg_write_byte_dt(&cfg->bus, REG_LOCK, UNLOCK);
    if (ret == 0) {
        ret = i2c_reg_write_byte_dt(&cfg->bus, REG_PAGE, pg);
    }
    d->page_now = ret == 0 ? pg : 0xFF;
    return ret;
}

static int wr(const struct device *dev, uint8_t pg, uint8_t reg, uint8_t v)
{
    const struct is31_cfg *cfg = dev->config;
    int ret = page(dev, pg);
    return ret ? ret : i2c_reg_write_byte_dt(&cfg->bus, reg, v);
}

/* dot registers are written in chunks of 18 (one SW line), the same transfer size QMK's driver uses */
static int burst(const struct device *dev, uint8_t pg, uint8_t reg, const uint8_t *v, uint8_t n)
{
    const struct is31_cfg *cfg = dev->config;
    struct is31_data *d = dev->data;
    int ret = page(dev, pg);
    while (ret == 0 && n > 0) {
        uint8_t c = MIN(n, 18);
        d->buf[0] = reg;
        memcpy(&d->buf[1], v, c);
        ret = i2c_write_dt(&cfg->bus, d->buf, c + 1);
        reg += c; v += c; n -= c;
    }
    return ret;
}

int is31fl3746a_write_scaling(const struct device *dev, uint8_t start, uint8_t n, const uint8_t *sl)
{
    struct is31_data *d = dev->data;
    if (start + n > IS31FL3746A_DOTS) {
        return -EINVAL;
    }
    k_mutex_lock(&d->lock, K_FOREVER);
    int ret = burst(dev, PG_FUNC, 0x01 + start, sl, n);
    k_mutex_unlock(&d->lock);
    return ret;
}

int is31fl3746a_set_gcc(const struct device *dev, uint8_t gcc)
{
    const struct is31_cfg *cfg = dev->config;
    struct is31_data *d = dev->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    int ret = wr(dev, PG_FUNC, REG_GCC, MIN(gcc, cfg->gcc_max));
    k_mutex_unlock(&d->lock);
    return ret;
}

int is31fl3746a_blank(const struct device *dev, bool blank)
{
    struct is31_data *d = dev->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    const struct is31_cfg *cfg = dev->config;
    d->conf = blank ? (d->conf & ~CONF_SSD_RUN) : (d->conf | CONF_SSD_RUN);
    /* the function page is usually still selected (blank(true) just before blank(false)): one write instead of
     * three keeps the dark gap of a Smart Backlight measurement short. Every other write selects its page. */
    int ret = d->page_now == PG_FUNC ? i2c_reg_write_byte_dt(&cfg->bus, REG_CONF, d->conf)
                                     : wr(dev, PG_FUNC, REG_CONF, d->conf);
    if (ret != 0) {
        d->page_now = 0xFF;
    }
    k_mutex_unlock(&d->lock);
    return ret;
}

int is31fl3746a_configure(const struct device *dev)
{
    const struct is31_cfg *cfg = dev->config;
    struct is31_data *d = dev->data;
    int ret;

    k_mutex_lock(&d->lock, K_FOREVER);
    ret = wr(dev, PG_FUNC, REG_RESET, RESET_KEY); /* all registers to POR (page select too) */
    d->page_now = 0xFF;
    d->conf = 0x00;                               /* SWS 0000 = 1/4 scan, shutdown until blank(false) */
    ret |= wr(dev, PG_FUNC, REG_CONF, d->conf);
    ret |= wr(dev, PG_FUNC, REG_GCC, 0);
    ret |= wr(dev, PG_FUNC, REG_PULL, PULL_DEFAULT);
    ret |= wr(dev, PG_FUNC, REG_TEMP, TEMP_ROLLOFF);
    ret |= wr(dev, PG_FUNC, REG_SPREAD, cfg->spread ? SPREAD_ON : 0);
    k_mutex_unlock(&d->lock);
    return ret;
}

int is31fl3746a_prepare_shutdown(const struct device *dev)
{
    struct is31_data *d = dev->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    int ret = wr(dev, PG_FUNC, REG_PULL, 0x00);
    k_mutex_unlock(&d->lock);
    return ret;
}

int is31fl3746a_detect_open(const struct device *dev, uint8_t open[IS31FL3746A_DOTS / 8])
{
    const struct is31_cfg *cfg = dev->config;
    struct is31_data *d = dev->data;
    uint8_t raw[12];
    int ret;

    k_mutex_lock(&d->lock, K_FOREVER);
    /* datasheet: 0x0F <= GCC <= 0x40 and 52h = 0 before setting OSDE; clear OSDE, then set 01 */
    ret = wr(dev, PG_FUNC, REG_GCC, 0x20);
    ret |= wr(dev, PG_FUNC, REG_PULL, 0x00);
    ret |= wr(dev, PG_FUNC, REG_CONF, d->conf & ~0x06);
    ret |= wr(dev, PG_FUNC, REG_CONF, (d->conf & ~0x06) | CONF_OSD_OPEN);
    k_msleep(2); /* at least 2 scan cycles of 136.5 us */
    if (ret == 0) {
        ret = page(dev, PG_FUNC);
        ret |= i2c_burst_read_dt(&cfg->bus, REG_OPEN, raw, sizeof(raw));
    }
    ret |= wr(dev, PG_FUNC, REG_CONF, d->conf & ~0x06);
    ret |= wr(dev, PG_FUNC, REG_PULL, PULL_DEFAULT);
    k_mutex_unlock(&d->lock);
    if (ret) {
        return ret;
    }
    /* 53h + (SW-1)*3 + (CS-1)/6, bit (CS-1)%6 */
    memset(open, 0, IS31FL3746A_DOTS / 8);
    for (int sw = 0; sw < 4; sw++) {
        for (int cs = 0; cs < 18; cs++) {
            if (raw[sw * 3 + cs / 6] & BIT(cs % 6)) {
                int dot = sw * 18 + cs;
                open[dot / 8] |= BIT(dot % 8);
            }
        }
    }
    return 0;
}

static int is31_write_channels(const struct device *dev, uint32_t start, uint32_t n, const uint8_t *buf)
{
    struct is31_data *d = dev->data;
    if (start + n > IS31FL3746A_DOTS) {
        return -EINVAL;
    }
    k_mutex_lock(&d->lock, K_FOREVER);
    int ret = burst(dev, PG_PWM, 0x01 + start, buf, n);
    k_mutex_unlock(&d->lock);
    return ret;
}

static int is31_set_brightness(const struct device *dev, uint32_t led, uint8_t value)
{
    uint8_t v = (uint8_t)((MIN(value, 100U) * 255U) / 100U);
    return is31_write_channels(dev, led, 1, &v);
}

int is31fl3746a_power(const struct device *dev, bool on)
{
    const struct is31_cfg *cfg = dev->config;
    if (on) {
        /* VCC first, then VIO/SDB: no input pin may exceed VCC + 0.3 V (datasheet absolute maximum) */
        if (cfg->pwr.port) {
            gpio_pin_set_dt(&cfg->pwr, 1);
            k_msleep(8); /* TPS2553 datasheet: turn-on 3 ms + rise 1.5 ms max, then VCC settling + chip power-on reset (was 3 ms) */
        }
        gpio_pin_set_dt(&cfg->sdb, 1);
        k_msleep(1); /* SDB rising edge resets the I2C block; no I2C during it */
        return is31fl3746a_configure(dev);
    }
    gpio_pin_set_dt(&cfg->sdb, 0); /* VIO/SDB off first: the I2C isolation FETs (gates on LED_SDB) open, then VCC_LED off */
    if (cfg->pwr.port) {
        k_usleep(100);
        gpio_pin_set_dt(&cfg->pwr, 0);
    }
    return 0;
}

static int is31_init(const struct device *dev)
{
    const struct is31_cfg *cfg = dev->config;
    struct is31_data *d = dev->data;

    k_mutex_init(&d->lock);
    if (!i2c_is_ready_dt(&cfg->bus) || !gpio_is_ready_dt(&cfg->sdb)) {
        return -ENODEV;
    }
    int ret = gpio_pin_configure_dt(&cfg->sdb, GPIO_OUTPUT_INACTIVE);
    if (!ret && cfg->pwr.port) {
        ret = gpio_is_ready_dt(&cfg->pwr) ? gpio_pin_configure_dt(&cfg->pwr, GPIO_OUTPUT_INACTIVE) : -ENODEV;
    }
    if (ret) {
        return ret;
    }
    ret = is31fl3746a_power(dev, true);
    if (ret) {
        LOG_ERR("IS31FL3746A 0x%02x does not answer (%d)", cfg->bus.addr, ret);
        is31fl3746a_power(dev, false);
        return -EIO;
    }
    return 0;
}

static DEVICE_API(led, is31_api) = {
    .set_brightness = is31_set_brightness,
    .write_channels = is31_write_channels,
};

#define IS31_DEFINE(n)                                                                             \
    static const struct is31_cfg is31_cfg_##n = {                                                 \
        .bus = I2C_DT_SPEC_INST_GET(n),                                                            \
        .sdb = GPIO_DT_SPEC_INST_GET(n, sdb_gpios),                                               \
        .pwr = GPIO_DT_SPEC_INST_GET_OR(n, power_gpios, {0}),                                     \
        .gcc_max = DT_INST_PROP(n, current_limit),                                                 \
        .spread = DT_INST_PROP(n, spread_spectrum),                                                \
    };                                                                                             \
    static struct is31_data is31_data_##n;                                                         \
    DEVICE_DT_INST_DEFINE(n, is31_init, NULL, &is31_data_##n, &is31_cfg_##n, POST_KERNEL,          \
                          CONFIG_LED_INIT_PRIORITY, &is31_api);

DT_INST_FOREACH_STATUS_OKAY(IS31_DEFINE)
