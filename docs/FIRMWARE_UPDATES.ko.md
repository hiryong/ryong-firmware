# Ryong Firmware 설정 저장과 펌웨어 업데이트

## 평소 설정을 바꿀 때

키맵·레이어는 기존 Studio에서, 콤보·매크로·Tap Dance·Hold-Tap 시간은
별도 개발본의 동적 설정에서 변경하고 저장합니다. 런타임 기능을 포함한
펌웨어가 설치된 보드에서는 이 변경마다 빌드하거나 다시 설치하지 않습니다.
브라우저 미리보기는 브라우저에만 저장하며 키보드와 통신하지 않습니다.

현재 실험의 Tap Dance는 1~3회 동작과 전체 공통 판정 시간을 지원합니다.
Hold-Tap은 컴파일된 Mod-Tap/Layer-Tap의 판정 시간·빠른 재탭·사전 유휴 시간·
flavor를 변경합니다. 임의의 새로운 Hold-Tap 동작 종류나 GPIO/절전 정책을
런타임에서 생성하는 기능은 아닙니다. 중첩 Tap Dance는 허용하지 않습니다.

## 펌웨어 업데이트가 필요한 때

새 기능 추가, 오류 수정, 보드 드라이버 변경처럼 프로그램 자체가 달라질 때입니다.
기존 Firmware 탭의 백업·다운로드·부트로더 진입·UF2 설치 안내는 그대로 보존합니다.
이 안내가 존재한다고 새 개발 펌웨어의 설치 검증까지 끝난 것은 아닙니다.

운영 사이트의 기존 펌웨어를 본 개발본으로 대체하거나 자동 배포하지 않습니다.
현재 Actions는 설정·의존성·메모리 진단만 보관하고 설치용 이미지는 게시하지 않습니다.

## BT60 v2 개발 시험: 아직 설치 단계가 아님

BT60 기본 빌드와 새 런타임 빌드는 정확히 bt60//zmk를 대상으로 합니다.
Ryong60 이미지를 BT60에 사용하지 않습니다. 사용자의 기존 정상 동작은 기준입니다.
기존 펌웨어에서 사용하는 동작 ID 테이블과 런타임 CRC16 ID 방식이 다를 수 있어,
동작 이름에 따른 키맵 변환과 BLE 페어링 유지·되돌리기를 실제로 검증해야 합니다.
설정 초기화나 페어링 전체 삭제를 호환성 문제의 해결책으로 사용하지 않습니다.

실물 시험에 앞서 준비할 것은 다음과 같습니다.

1. 실제 BT60 v2 보드·부트로더 식별 정보.
2. 현재 정상 동작하는 원래 펌웨어 파일과 Studio 키맵 백업.
3. 동적 설정을 사용 중이면 동적 설정 백업도 별도 보관.
4. 앱이 응답하지 않아도 부트로더에 들어갈 수 있는 검증된 물리적 절차.
5. 해당 보드·설정 저장 영역·복구 방법이 일치하는 시험 이미지.

저장소에는 Fn+Enter 부트로더 진입이 정의되어 있으나, 앱이 고장난 상태에서의
복구를 입증하지는 않습니다. 현재는 이 키 조합만 믿고 설치를 요청하지 않습니다.
준비가 끝나면 정확한 파일명과 확인 방법, 순서, 실패 시 원래 펌웨어로 돌아가는
방법을 따로 제공합니다. 사용자 PC에 개발 도구를 설치하거나 빌드하지 않습니다.

## 백업과 저장 실패 복구

기존 백업 탭은 Studio 키맵을 보관합니다. 새 동적 설정 백업은 콤보·매크로·
Tap Dance·Hold-Tap 값을 보관합니다. 두 파일은 역할이 달라 둘 다 보관합니다.
동적 백업 가져오기는 화면에만 불러옵니다. 검토하고 저장해야 장치에 적용됩니다.
펌웨어 동작 목록·레이어·키 수가 다른 백업은 자동 적용하지 않습니다.

저장 시작 전 변경 전 상태와 요청을 브라우저에 기록합니다. 중간 연결 끊김이나
응답 유실 시 이 기록을 남기며, 성공으로 표시하거나 자동 재시도하지 않습니다.
다시 연결하고 장치 상태를 불러온 뒤 중단 기록을 내려받아 이전 설정을 검토합니다.
복원 역시 사용자가 명시적으로 저장해야 적용됩니다. 기록이 해석되지 않으면
장치를 초기화하지 말고 기록을 보관합니다. 다중 모듈 저장은 전체 원자적 트랜잭션이
아니므로 일부 항목만 저장됐을 수 있습니다.

## 향후 Ryong60 제품

출고 전 보드별 부트로더·기본 펌웨어 설치와 검증을 마칩니다. 구매자의 초기 사용에
SWD·GitHub·컴파일·UF2 복사를 요구하지 않는 것이 제품 목표입니다.
큰 업데이트도 별도 Firmware 탭에서 제공하되, 보드 식별·서명 검증·설정 변환·
중단 복구가 확인된 경로만 제공해야 합니다. 현재 USB 저장장치로 보이는 UF2
부트로더만으로 브라우저 자동 업데이트가 완성됐다고 주장하지 않습니다.
실제 부트로더 사양과 복구 검증에 맞춰 웹 또는 기존 데스크톱 앱의 전송 경로를
선택합니다. 아직 자동 업데이트·서명된 릴리스·실물 복구를 구현 완료하지 않았습니다.


## Native updater implementation checkpoint

`tools/ryong-updater` now implements Ed25519 manifest validation, exact model and
bootloader Board-ID matching, SHA-256 payload validation, downgrade rejection,
UF2 family/block/range checks and exclusive-create transfer with byte progress.
A transfer receipt does not mean reboot success. Identity/build confirmation
and bond/settings migration still need an end-to-end hardware test.

The independent Tauri copy now has a native adapter and read-only bootloader
inventory. Its embedded release-policy list is empty: no real keyboard can be
flashed through this path. Real Board-ID, application partition ranges, recovery
image and approved signing policy must be established before enabling it.
The development Mac app has a distinct bundle ID and ad-hoc signature; it is
not a production deployment or a firmware release. The web preview does not
access volumes or pretend to perform updates.

The native serial sender now uses write_all and stops on error, preventing a
short serial write from silently truncating a Studio request.


## Web-first update path

User preference: keep configuration and firmware updating on the web; desktop
software is an optional fallback, not a customer prerequisite. Adafruit nRF52
bootloader upstream provides CDC serial DFU as well as UF2 MSC. Web Serial can
use CDC; WebUSB cannot directly claim the protected mass-storage interface.
Browser permission prompts remain browser-controlled, especially on first use.

`webUpdate` now contains real WebCrypto Ed25519/SHA-256 package verification,
strict contiguous application-range checks, independently checked HCI/SLIP
framing and a Web Serial application-only DFU transport. Officially generated
init packet bytes must be included and hashed in the signed package. No
SoftDevice or bootloader update mode is sent. Unexpected ACKs/disconnection
stop without retries. A shared update state machine requires durable backup
before reboot and exact unit/model/build/version after reconnect before success.

The browser policy registry is empty. Seeing a UF2 drive does not prove that
this BT60's actual bootloader exposes CDC DFU or that its application start
matches the DFU write location. These must be verified before any real image
or bootloader-enter permission is enabled. Native Mac app builds successfully
as a separate development bundle; it remains optional and cannot flash because
its release registry is empty too.


The web UI is now wired to the browser update adapters: signed approved-package
download, strict IndexedDB backup transaction, two-phase firmware bridge,
browser-owned bootloader permission, application-only transfer, automatic
reconnection through an already granted matching runtime port, and same-unit
verification before completion. The normal connection chooser stays closed
while an update is active. Backup preserves semantic dynamic settings, keymap
behavior names plus named macro/dance references, and host profile choices.
No record is restored automatically after a failure. All live paths remain
closed because the approved browser/native policy registries are empty and
firmware bootloader entry defaults off. This wiring is not a real-device test.


### Update backup recovery (no automatic restore)

The update transaction exposes its durable backup ID before bootloader entry,
so its backup file remains downloadable on success or failure. The combined
file can be imported into the dynamic editor, reviewed and explicitly saved;
then the same file can be imported in the existing Backup tab for keymap
review/restore and explicit Save. Named macro/Tap Dance references are resolved
against current saved entries after a dynamic restore, never reused as stale
numeric slots. Missing/ambiguous names are skipped with a report. Host-profile
choices are retained in the backup for review; they are not blindly copied to
different BLE bonds. No settings reset or automatic downgrade occurs.
