# geist-UG4 / geist-UG4-S4 전용 부트로더 (MDBT50Q-1MV2)

**Ver2(E73) 부트로더를 이 보드에 쓰면 안 됩니다.** Ver2 부트로더는 P0.04를 상태 LED로 깜빡이는데,
이 보드의 P0.04는 I2C 클럭(BMS_SCL)입니다. 상태 LED는 P0.02(모듈 11번 패드)에 있습니다.

## 이 부트로더
- 소스: Adafruit_nRF52_Bootloader (chcbaram 포크, 커밋 4747018), SoftDevice S140 6.1.1 — rev1.0·Ver2·geist와 같은 소스.
- 보드 정의: `board_ryong60_geistUG4/` (board.h, board.mk, pinconfig.c)
- 상태 표시: P0.02 LED1(부품 면 빨간 LED, R3로 GND, High에서 켜짐) 하나만 사용.
- 건드리지 않는 핀: P1.11 LED_SDB, P0.08 LED_PWR, P1.10 UG_PWR, P1.02 BQ_EN2, P1.00 SB_EN, P0.04·P0.06 I2C.
- 3.3V 설정(UICR REGOUT0 = 3.3V), 리셋 핀 P0.18, USB 드라이브 이름 GEIST, VID/PID 0x239A/0x00B3,
  플래시 배치(MBR 0x0, 앱 0x1000, 부트로더 0xF4000)는 다른 판과 같음 → 키보드 펌웨어 UF2가 그대로 들어감.
- Ver2 부트로더 hex와 바이트 대조: MBR·SoftDevice 구간 동일, 부트로더 구간은 LED 핀 번호(4 → 2)와
  이름 문자열(및 그 길이로 밀린 주소)만 다름.
- 2026-11-13 S4 작업 공간에서 다시 빌드한 것(arm-zephyr-eabi-gcc 12.2). n5(geist-UG4) 묶음의 전용 부트로더와
  같은 정의(상태 LED P0.02)이며, 어느 쪽을 써도 됩니다.

## 파일
| 파일 | 쓰는 때 |
|---|---|
| `ryong60_geistUG4_bootloader_s140_6.1.1.hex` | 빈 모듈에 처음 굽기 (SWD: SWDIO·SWCLK·GND·3V3). 칩 전체 지우기 후 굽기 |
| `update-ryong60_geistUG4_bootloader.uf2` | 이미 Adafruit 계열 부트로더가 있는 칩에서 바꿀 때. 부트로더 드라이브에 끌어 놓기 |

## 처음 굽는 순서
1. USB-C로 전원을 넣고 SWD로 hex를 굽습니다(전체 지우기 포함). 처음 켤 때 UICR에 3.3V 설정이 들어갑니다.
2. USB-C를 다시 꽂으면 GEIST 드라이브가 나타납니다(빨간 LED가 숨 쉬듯 깜빡임).
3. 키보드 펌웨어 UF2를 드라이브에 끌어 놓습니다. 자동으로 재시작합니다.
4. 다시 부트로더로 들어가려면 리셋 버튼 두 번 또는 Fn+Enter.

실제 칩 동작은 첫 보드에서 확인합니다(빌드와 바이트 대조만 했음).
