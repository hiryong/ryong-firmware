# ryong60 ZMK 펌웨어

ryong60 **Ver2**(61키 무선, Rule60 v3 6.25u 기반 + 키별 흰색 LED IS31FL3746A) 용 ZMK 설정입니다. **rev1.0 보드와 핀이 달라 서로 바꿔 쓸 수 없습니다.**
보드 정의는 chcbaram 님의 [zmk-config / zmk-rule60](https://github.com/chcbaram/zmk-config/tree/main/zmk-rule60)(MIT)을 그대로 가져와서 아래만 바꿨습니다.

## 바뀐 점

| 항목 | 내용 |
|---|---|
| 이름 | `CONFIG_ZMK_KEYBOARD_NAME="geist"` |
| 키 LED | IS31FL3746A 1개(U81, I²C 0x60, 100kHz) → LITEON LTW-C230DS 61개. RISET 18k(R20) → LED 1개 순간 19mA(정격 20mA). 전원은 U83 TPS2553(EN = P0.10), SDB·VIO = P0.03. 모두 꺼지면 칩 전원도 끊어 대기 0µA. `led 0` = 전체(`zmk,backlight`), `led 1+n` = 키 n 하나 |
| 백라이트 기본값 | 처음 켜면 꺼진 상태, 켜면 밝기 40%, 단계 20%, 키 입력이 없으면 자동 꺼짐 |
| 전류 예산 | 일반 USB 400mA, 고속 충전기(USB-C 1.5A/3A) 700mA, 배터리 600mA. 언더글로우가 켜져 있으면 300mA를 먼저 뺌. 61키 최대는 약 280mA |
| 배터리 자동 상한 | 배터리일 때 잔량별로 가장 밝은 키의 최대 전류를 제한(100% 100 · 80% 72 · 60% 54 · 30% 40 · 10% 23). 언더글로우가 켜져 있으면 조금 낮은 표(100% 83 · 80% 56 · 50% 34). USB(일반 · 고속 충전기)에서는 잔량 상한 없음: 일반 USB에서 언더글로우가 켜져 있으면 전류 예산이 키 LED에 100mA만 남겨 입력 한도 450mA를 넘지 않음 |
| 블루투스 슬롯 키 | 슬롯 키 LED만 깜빡임(밝기 8). 키를 어디로 옮겨도 따라감 |
| RGB 언더글로우 | 켜서 빌드함 (`CONFIG_ZMK_RGB_UNDERGLOW=y`, 최대 밝기 50%). 언더글로우 전원은 U84(TPS2553, 0.31~0.40A 전류 제한)와 330µF 고분자 콘덴서 5개(C42~C46)를 거쳐 들어가서, LED 14개가 1kHz로 켜졌다 꺼지는 0.5A 맥동이 VDD로 나오지 않음. 배터리와 일반 USB에서는 잔량 40% 이하에서 자동으로 꺼지고 50% 이상에서 다시 켜짐(`ryong_ug_batt.c`). 배터리 없는 일반 USB에서는 꺼짐. 고속 충전기(1.5A/3A)에서는 항상 켤 수 있음 |
| 절전 | 15분 동안 입력이 없으면 잠듦 (BT60 V2 설정과 같음), 아무 키나 누르면 깸 |
| 전원 끄기/켜기 | **Fn + 왼쪽 Ctrl 3초** 누르고 떼면 꺼짐 (ZMK 공식 Soft Off — ZMK Studio로 다른 키에 옮길 수 있고, 시간은 keys.ryong.com 설정 탭). 끈 뒤에는 **Fn만 키보드를 깨우고**, Fn + Soft Off 키를 3초 누르면 켜짐(백라이트가 한 번 깜빡임) — 아니면 8초 안에 다시 꺼짐. USB 연결·리셋 버튼·슬라이드 스위치로는 바로 켜짐. Fn + Esc = ` |
| ZMK Studio | `CONFIG_ZMK_STUDIO=y` (USB 연결로 키 배치 변경) |
| ZMK 버전 | 항상 최신(`main`). 보드 폴더는 새 형식(`boards/ryong/ryong60`, 빌드 대상 `ryong60//zmk`) |
| 키맵 | 사용자의 BT60 V2 키맵([hiryong/zmk-config-studio](https://github.com/hiryong/zmk-config-studio))을 그대로 옮김 |

## 키 조작 (BT60 V2 와 같음)

- **기본(base)**: Mac 배열 — 아래 줄 Ctrl · Option(Alt) · Cmd · Space · Cmd · Option · Ctrl · **Fn**. Esc 자리는 Shift/GUI 와 함께 누르면 `` ` `` (ZMK `&gresc` 동작: 누르고 있던 Shift/GUI 는 컴퓨터로 보내지 않으므로 `~` 가 아니라 백틱이 찍힘. `~` 는 Shift + Fn + Esc). 키맵은 BT60 V2 와 같으므로 BT60 V2 와 같은 동작.
- **Fn + Tab**: Windows 배열 켜기/끄기 — 아래 줄 Ctrl · Win · Alt · Space · Alt · 메뉴(`C_MENU`, USB Consumer 메뉴 코드 — Windows 의 컨텍스트 메뉴 키 `K_APP` 와 다른 코드라, 메뉴가 안 뜨면 Studio 에서 `K_APP` 로 바꾸기) · Ctrl · Fn
- **Fn 레이어**
  - Esc = `` ` ``, 1~0, -, = = F1~F12, Backspace = Delete
  - Q / W / E / R = 블루투스 기기 1 / 2 / 3 / 4, T = USB ↔ 블루투스 전환
  - I = Insert, P = Print Screen, `\` = ZMK Studio 잠금 해제, Enter = 부트로더(UF2) 진입
  - (콤보) Esc + Backspace 를 80ms 안에 같이 누르면 ZMK Studio 잠금 해제. 이 콤보 때문에 Esc 와 Backspace 는 눌린 뒤 최대 80ms 늦게 입력됨(시뮬레이터 실측 약 82ms)
  - Z = 백라이트 켜기/끄기, X / C = 어둡게 / 밝게
  - / = ↑, 오른쪽 Cmd(Alt) / Option(메뉴) / Ctrl 자리 = ← / ↓ / →
- **Fn + 오른쪽 Shift 를 누른 채 (media)**
  - 1 / 2 = 화면 밝기 −/+, 3 = 모든 창 보기, 4 = 검색, 7 / 8 / 9 = 이전 / 재생 / 다음, 0 = 음소거, - / = = 볼륨 −/+
  - A = 블루투스 기기 전부 지우기, D = 지금 기기 지우기
  - / = Page Up, ← ↓ → 자리 = Home / Page Down / End
- Studio 로 언제든 바꿀 수 있습니다: https://zmk.studio (크롬/엣지, USB 연결)

## 빌드 (GitHub Actions, 가장 쉬움)

1. 이 폴더를 GitHub 새 저장소로 올립니다 (폴더 구조 그대로).
2. 저장소의 **Actions** 탭에서 빌드가 자동으로 돌고, 끝나면 `ryong60` 아티팩트(.uf2)가 생깁니다.
3. 빌드 목록은 `build.yaml` (보드 `ryong60//zmk`, Studio 용 snippet `studio-rpc-usb-uart`).

> **빌드 확인 (2026-11-07, Ver2)**: 플래시 28.9% · RAM 27.5%. 키 LED 전류 한도 255, 슬롯 밝기 8, 배터리 자동 상한 켜짐을 빌드 결과 `.config`·DTS에서 확인. 완성 펌웨어는 패키지의 `ryong60_ver2.uf2`.

## 처음 한 번: 부트로더 굽기

> **geist-UG4 / geist-UG4-S4 (MDBT50Q-1MV2) 보드는 `bootloader/ryong60_geistUG4_bootloader_s140_6.1.1.hex`를 씁니다.**
> Ver2(E73) 부트로더는 쓰면 안 됩니다: 상태 LED 핀 P0.04가 이 보드에서는 I2C 클럭(BMS_SCL)입니다. 이 보드의 상태 LED는 P0.02입니다.
> 아래 설명에서 파일 이름의 `ryong60_ver2`는 `ryong60_geistUG4`로, 모듈 이름 E73은 MDBT50Q로 읽으면 됩니다(2026-11-13).

빈 nRF52840(E73 모듈)에는 부트로더가 없으므로 SWD로 한 번 구워야 합니다. 자세한 내용은 `bootloader/README.md`.

1. **Ver2 전용 부트로더**: `bootloader/ryong60_geistUG4_bootloader_s140_6.1.1.hex`
   - **rev1.0 부트로더를 쓰면 안 됩니다.** rev1.0 부트로더는 P0.03을 깜빡이는데, Ver2의 P0.03은 키 LED 칩 SDB·VIO라 칩 전원이 꺼진 채 VIO에 전압이 들어갑니다.
   - chcbaram 님 포크 [Adafruit_nRF52_Bootloader](https://github.com/chcbaram/adafruit_nrf52_bootloader)(커밋 4747018)에 `ryong60_ver2` 보드를 추가해 빌드했습니다. 보드 정의는 `bootloader/board_ryong60_geistUG4/`.
   - 상태 표시는 P0.04 빨간 LED(부품 면) 하나뿐입니다. P0.03·P0.09·P0.10·P0.30은 건드리지 않아 풀다운으로 꺼진 채 있습니다.
   - VID/PID(0x239A/0x00B3), UF2 형식, 드라이브 이름 GEIST, 3.3V 설정(UICR REGOUT0), 리셋 핀(P0.18)은 rev1.0과 같습니다.
2. PCB의 SWD 헤더(H2: SWDIO / SWCLK / GND / 3V3)에 디버거를 연결합니다.
   - **보드 전원은 USB-C로 넣습니다.** H2의 3V3 핀은 디버거의 **기준 전압 감지(VTref) 입력으로만** 연결하고, 디버거에서 3.3V를 공급하지 않습니다.
   - 이유: 빈 nRF52840은 USB(VDDH) 전원일 때 3V3 핀이 **기본 1.8V**이고, 부트로더가 UICR(REGOUT0)을 3.3V로 쓴 뒤에야 3.3V가 됩니다. 이때 3.3V를 밀어 넣거나 3.3V 고정 신호로 SWD를 구동하면 정격 밖입니다.
   - VTref를 따라가는 디버거(J-Link, DAPLink 계열)를 권장합니다. 3.3V 고정인 ST-Link 복제품은 첫 기록에 쓰지 않습니다.
   - 굽기 예: `nrfjprog --program ryong60_geistUG4_bootloader_s140_6.1.1.hex --chiperase --verify --reset` (J-Link) 또는 `pyocd flash -t nrf52840 --erase chip ryong60_geistUG4_bootloader_s140_6.1.1.hex` (DAPLink).
3. 부트로더가 들어가면 USB를 연결했을 때 `GEIST` 드라이브가 보이고 빨간 LED가 숨 쉬듯 깜빡입니다. `ryong60_ver2.uf2`를 끌어다 놓으면 펌웨어 설치가 끝납니다.
4. 이후 업데이트는 Fn + Enter(부트로더) 또는 리셋 버튼 두 번 → `.uf2` 복사입니다.
5. 이미 다른 Adafruit 계열 부트로더가 들어 있는 보드는 SWD 없이 `bootloader/update-ryong60_geistUG4_bootloader.uf2`를 부트로더 드라이브에 복사해 바꿀 수 있습니다.
6. 다시 빌드하는 방법: 위 저장소(커밋 4747018)를 받고 `src/boards/ryong60_geistug4/`에 `board_ryong60_geistUG4/`의 파일 3개를 넣은 뒤 `make BOARD=ryong60_geistug4`를 실행합니다. ARM gcc가 필요합니다(Zephyr SDK의 arm-zephyr-eabi도 됨: `CROSS_COMPILE=arm-zephyr-eabi-`).

## 라이선스

원본 보드 정의와 키맵: MIT, © chcbaram (Hancheol Cho) / 원 출처 nice!60 © Nick Winans — `LICENSE-chcbaram-zmk-config` 참고.
