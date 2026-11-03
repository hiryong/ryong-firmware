#!/usr/bin/env bash
# Two power-ups of one simulated keyboard on the same flash: first the old firmware (one shared
# Bluetooth address; two computers pair on profiles 0 and 1), then the per-slot-address firmware.
# Usage (from zmk/app, BSIM_OUT_PATH set):
#   run_migration.sh <cases dir> <label> <old case: old|old-ids> <old app dir> <new app dir>
set -u
cases=$1; label=$2; old_case=$3; old_app=$4; new_app=$5
out=$(pwd)/build/tests/migration-$label; mkdir -p "$out"; rm -f "$out"/*.log
bin=$BSIM_OUT_PATH/bin; flash=$out/flash.bin; rm -f "$flash"
for v in old new; do
  if [ $v = old ]; then app=$old_app; c=$old_case; else app=$new_app; c=new; fi
  west build -p -d "build/migration-$label-$v" -s "$app" -b nrf52_bsim//zmk_test_mock -- -DZMK_CONFIG="$cases/$c" > "$out/build-$v.log" 2>&1 \
    || { echo "BUILD FAILED ($v): see build-$v.log"; tail -30 "$out/build-$v.log"; exit 1; }
  cp "build/migration-$label-$v/zephyr/zmk.exe" "$bin/mig_${label}_$v.exe"
done
run() { # $1 = old|new, $2.. = central lines
  local v=$1; shift; local id="mig_${label}_$v"; local n=$#
  ( cd "$bin"
    ./mig_${label}_$v.exe -d=0 -s=$id -flash_file="$flash" > "$out/$v.log" 2>&1 &
    ./bs_device_handbrake -s=$id -d=1 -r=10 > /dev/null 2>&1 &
    local d=2; for c in "$@"; do $c -s=$id -d=$d >> "$out/$v.log" 2>&1 & d=$((d+1)); done
    timeout 300 ./bs_2G4_phy_v1 -s=$id -D=$((2 + n)) -sim_length=30e6 > /dev/null 2>&1
    wait )
}
run old "./ble_test_central.exe" "./ble_test_central.exe -wait_on_start=1300"
run new "./ble_test_central.exe"
echo "### Upgrade with paired slots ($label)"
ready='Bluetooth slots ready|zmk_ble_ready: ready'
paired='Slot [0-9] paired|set_profile_address: Setting profile addr for ble/profiles/[0-9] to [0-9A-F]'
for v in old new; do
  f=$out/$v.log
  echo "- $v: Bluetooth started: $(grep -cE "$ready" "$f"), slots paired: $(grep -cE "$paired" "$f"), key reports received: $(grep -c 'notify_func: payload' "$f"), older pairings removed: $(grep -c 'removing older pairings' "$f"), crashes: $(grep -cE 'FATAL|ASSERTION|panic|Fault' "$f")"
done
# the old firmware must have left paired slots behind, and the new one must start, pair a new
# computer and deliver keys to it
grep -qE "$paired" "$out/old.log" && grep -qE "$ready" "$out/new.log" && grep -qE "$paired" "$out/new.log" \
  && grep -q 'notify_func: payload' "$out/new.log" && ! grep -qE 'FATAL|ASSERTION|panic|Fault' "$out/new.log"
