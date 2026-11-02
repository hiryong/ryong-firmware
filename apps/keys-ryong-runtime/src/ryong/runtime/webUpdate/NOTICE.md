# Web Serial DFU protocol provenance

Protocol reference: Adafruit/Adafruit_nRF52_nrfutil commit
7fdfe15feee5f304fb7d9b031721dcefa1f72b58, especially
nordicsemi/dfu/dfu_transport_serial.py, util.py and crc16.py.
Bootloader reference: Adafruit/Adafruit_nRF52_Bootloader
c67f0bcf0fa8e841426335b1bbde91cda6ca1f50.
This is legacy Adafruit HCI/SLIP DFU, NOT Nordic Secure DFU.

Copyright (c) 2015, Nordic Semiconductor. All rights reserved.
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:
* Source redistributions retain this notice, conditions and disclaimer.
* Binary redistributions reproduce them in documentation/materials.
* Neither Nordic Semiconductor ASA nor contributors' names may endorse derived
  products without prior written permission.
THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT EXPRESS OR IMPLIED WARRANTIES,
INCLUDING MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. THE COPYRIGHT
HOLDERS/CONTRIBUTORS ARE NOT LIABLE FOR DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY OR CONSEQUENTIAL DAMAGES, HOWEVER CAUSED AND UNDER ANY THEORY OF
LIABILITY, ARISING IN ANY WAY OUT OF USE, EVEN IF ADVISED OF SUCH POSSIBILITY.

No real board policy/key is enabled. A BT60 UF2 drive alone does not establish
CDC DFU support, application offset or a unique USB bootloader identity.
Native inventory is a fallback diagnostic, not an app-install requirement.
Web Serial requests may need a browser-controlled device permission prompt.
