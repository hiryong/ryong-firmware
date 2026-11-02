# 프로파일별 Apple 배치 자동 전환

사용자 요구: macOS/iOS만 Apple 계열로 감지하고, 나머지와 감지 불명은
Windows 표준 배치를 사용한다. Windows/Linux/Android를 서로 구분할 필요는 없다.

## 적용 기준

- 기본 물리 배치는 Windows 표준. Apple 계열일 때 왼쪽 Alt와 GUI를 교환해
  스페이스바 옆을 Command, 그 바깥을 Option으로 맞춘다.
- 오른쪽 Alt/GUI 교환은 별도 선택. Windows의 AltGr 사용을 임의로 바꾸지 않는다.
- 프로파일별 선택: 자동 / Apple / Windows 표준 / 현재 배치 유지.
  수동 선택이 감지 결과보다 우선한다.
- 사용자가 이미 Mac 배치를 만들었으면 기준 배치를 표시해 이중 교환을 방지한다.
- BLE 프로파일별로 상태를 분리하고 재연결 시 재사용한다. 재페어링/프로파일 삭제 시
  이전 호스트의 감지 및 수동 지정을 제거한다. 연결 세대가 다른 관측은 무시한다.
- USB 감지를 BLE의 다른 호스트에 복사하지 않는다.
- 감지 초기의 흔들리는 결과로 즉시 전환하지 않는다. 안정화 후, 모든 키가
  떼어진 시점에만 새 배치를 적용한다. 눌린 키의 해제는 눌렀을 때의 매핑을 쓴다.
- 저장된 키맵이나 매크로 HID 출력을 전역 치환하지 않는다. 명시적으로 OS 자동
  전환에 참여하는 물리 바인딩에만 적용한다. 매크로의 의도적 Alt/Command 입력은 유지한다.

## 조사 결과와 한계

외부 MIT 모듈 cormoran/zmk-feature-os-detection은 USB/BLE 관측, 프로파일별
수동 지정과 RPC를 제공한다. 다만 BLE 감지는 휴리스틱이며 연결 초기에 값이 바뀐다.
macOS/iOS를 서로 구분하기도 어렵지만 이번 요구에는 그 구분이 필요 없다.
Windows/Linux 모호성도 둘 다 Windows 표준으로 처리하면 된다.
Apple과 비 Apple의 오감지 가능성까지 사라지는 것은 아니므로 수동 지정은 유지한다.
검토 출처: https://github.com/cormoran/zmk-feature-os-detection/blob/main/README.md

## 현재 구현 수준

include/ryong_fw/host_policy.h와 src/ryong_host_policy.c는 부작용 없는 정책 코어다.
tests/test_host_policy.c는 독립 프로파일, 모호한 감지, 수동 우선, 재페어링 초기화,
USB/BLE 분리, 키를 누른 동안의 매핑 유지와 modifier 변환을 검사한다.
호스트 C 테스트를 통과했으며 CMake/CTest에 등록했다.

실제 BLE 감지기, ZMK 이벤트/바인딩 연결, 플래시 영구 저장, 잠금이 적용된 RPC,
UI와 백업은 아직 연결하지 않았다. 자동 감지가 실물에서 작동한다고 주장하지 않는다.
기존 사이트/키맵/기기에는 변경이 없다. 모든 개발은 ryong-firmware에서만 한다.

## 업데이트 UX 요구 보완

물리 리셋은 사용자가 동작을 확인한 비상 복구 수단으로 유지한다.
평소 펌웨어 업데이트는 버튼 한 번, 자동 백업/검증/전송, 진행률과 전원 유지 안내,
자동 재연결과 결과 확인을 목표로 한다. Fn+Enter/폴더/UF2 복사를 평상시 제품
업데이트 UX로 채택하지 않는다. 기존 수동 절차는 개발/비상 경로로 구분한다.


## ZMK adapter experiment

`modules/ryong-host-layout` now implements an opt-in two-parameter physical
binding with Windows/Apple usages, a debounce and press/release latching.
`experiments/host-layout` adds a separate BT60 compile variant. The actual
host-layout state source is also compiled by CMake and tested on the host.
The detector is pinned to 3052679f645b8fc1997275c2eaa6b86bdd55ca01; its custom
Studio handler is secured by the fail-closed source patch.
Do not call this real-device verified. Bond-identity reset, integrated OS UI,
physical classification and native ZMK event snapshots remain open.


## Host profile UI and bond-owner guard

The integrated host-layout section uses the detector's generated protobuf codec,
requires Studio unlock, reads current profile state before writes, validates the
acknowledgement and reads back without automatic retries after a lost reply.
AUTO / Apple / Windows standard are offered per bonded profile.

A local private `bond_owner_v1` custom-settings record now associates each slot
with its actual paired BLE address. A missing/changed owner clears the override
and detected cache durably before committing the new owner. Failure leaves the
old owner tag and fails closed. The firmware guard source passes a compiled
host shim test including reboot after each of its three write failure points.
The upstream adapter patch validates every anchor before changing any source.
Hardware pairing and flash behavior remain unverified.


BT60 physical order is verified from the imported keymap: Windows is
Ctrl / GUI(Win) / Alt / Space; Apple is Ctrl / Alt(Option) / GUI(Command) /
Space. A preparation regression test checks these exact positions and that
the manual OS layer and imported source bytes remain unchanged.
