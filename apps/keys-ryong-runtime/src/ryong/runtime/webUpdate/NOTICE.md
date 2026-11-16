# Web Serial DFU protocol provenance

Protocol reference: Adafruit/Adafruit_nRF52_nrfutil commit
7fdfe15feee5f304fb7d9b031721dcefa1f72b58, especially
nordicsemi/dfu/dfu_transport_serial.py, util.py and crc16.py.
Bootloader reference: Adafruit/Adafruit_nRF52_Bootloader
c67f0bcf0fa8e841426335b1bbde91cda6ca1f50.
This is legacy Adafruit HCI/SLIP DFU, NOT Nordic Secure DFU.

Copyright (c) 2015, Nordic Semiconductor
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of Nordic Semiconductor ASA nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


No real board policy/key is enabled. A BT60 UF2 drive alone does not establish
CDC DFU support, application offset or a unique USB bootloader identity.
Native inventory is a fallback diagnostic, not an app-install requirement.
Web Serial requests may need a browser-controlled device permission prompt.

## Bluetooth (Web Bluetooth) legacy DFU — bleDfu.ts
Protocol reference: NordicSemiconductor/Android-DFU-Library, LegacyDfuImpl.java (main branch,
read 2026-11-16): service/characteristic UUIDs 0x1530/0x1531/0x1532/0x1534 on base
xxxxxxxx-1212-EFDE-1523-785FEABCD123, opcodes 1 start, 2 init (0 start / 1 complete), 3 receive,
4 validate, 5 activate, 8 receipt request, 0x10 response, 0x11 receipt; application-only start,
12-byte size array, PRN of 10 or fewer for legacy targets. Package format: adafruit-nrfutil
0.5.3.post16 `dfu genpkg` (manifest.json + .bin + .dat, DFU 0.5); the test fixture
tests/fixtures/ble-dfu-test-bluetooth.zip was made with it from a synthetic 100-byte image.
Development tool: the package is the unsigned build output, as with Nordic's own app. Not tried
on a real keyboard yet.
