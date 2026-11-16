# geist board code (soft off: wake with Fn, turn on with Fn + the Soft Off key; RGB power).
# Added to the app target (not a separate library) so its key listener is linked
# before ZMK's own sources and sees key events first while confirming power-on.
if(CONFIG_BOARD_GEIST)
  target_sources(app PRIVATE boards/ryong/geist/geist_power.c boards/ryong/geist/ryong_gauge_sleep.c boards/ryong/geist/ryong_charger.c boards/ryong/geist/ryong_charger_logic.c)
  # Ver2: 61 key LEDs on one IS31FL3746A (own driver; index 0 = all keys for ZMK backlight, 1+n = key n)
  target_sources(app PRIVATE drivers/led/is31fl3746a.c boards/ryong/geist/ryong_keyleds.c)
  target_include_directories(app PRIVATE include)
  target_sources_ifdef(CONFIG_RYONG_SLOT_LED app PRIVATE boards/ryong/geist/ryong_slotled.c)
  # Bluetooth slot light on the slot key itself (ZMK ble_indicator -> zmk_backlight_indicate, wrapped)
  if(CONFIG_RYONG_SLOT_KEY_INDICATOR)
    target_sources(app PRIVATE boards/ryong/geist/ryong_slot_indicate.c)
    zephyr_ld_options(-Wl,--wrap=zmk_backlight_indicate)
  endif()
  # underglow off on a low battery (SK6812MINI-HS below 3.7 V)
  target_sources_ifdef(CONFIG_RYONG_UG_BAT_GUARD app PRIVATE boards/ryong/geist/ryong_ug_batt.c boards/ryong/geist/ryong_ug_batt_logic.c)
  target_include_directories(app PRIVATE boards/ryong/geist)
  # geist-UG4-SB: Smart Backlight (SX9324) and its &sbl behavior
  target_sources_ifdef(CONFIG_RYONG_SMART_BACKLIGHT app PRIVATE boards/ryong/geist/ryong_smartbl.c boards/ryong/geist/behavior_ryong_sbl.c)
  # Every soft off (key or ZMK Studio binding) goes through the wrapper in geist_power.c, which leaves a
  # mark so the next wake asks for Fn + the Soft Off key. 15 min idle sleep does not.
  zephyr_ld_options(-Wl,--wrap=zmk_pm_soft_off)
endif()
