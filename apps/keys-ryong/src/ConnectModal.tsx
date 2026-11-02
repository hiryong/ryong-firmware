import { ComputerAnim } from "./ryong/Scenes";
import { t } from "./ryong/i18n";
import { BrandFloat } from "./ryong/BrandFloat";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { AvailableDevice } from "./tauri/index";
import { Bluetooth, RefreshCw } from "lucide-react";
import { Key, ListBox, ListBoxItem, Selection } from "react-aria-components";
import { useModalRef } from "./misc/useModalRef";
import { GenericModal } from "./GenericModal";

export type TransportFactory = {
  label: string;
  isWireless?: boolean;
  connect?: () => Promise<RpcTransport>;
  pick_and_connect?: {
    list: () => Promise<Array<AvailableDevice>>;
    connect: (dev: AvailableDevice) => Promise<RpcTransport>;
  };
};

export interface ConnectModalProps {
  open?: boolean;
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
  /** keys.ryong.com: shown under the connect options */
  extra?: React.ReactNode;
  lead?: React.ReactNode;
}

function deviceList(
  open: boolean,
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void
) {
  const [devices, setDevices] = useState<
    Array<[TransportFactory, AvailableDevice]>
  >([]);
  const [selectedDev, setSelectedDev] = useState(new Set<Key>());
  const [refreshing, setRefreshing] = useState(false);

  async function LoadEm() {
    setRefreshing(true);
    let entries: Array<[TransportFactory, AvailableDevice]> = [];
    for (const t of transports.filter((t) => t.pick_and_connect)) {
      const devices = await t.pick_and_connect?.list();
      if (!devices) {
        continue;
      }

      entries.push(
        ...devices.map<[TransportFactory, AvailableDevice]>((d) => {
          return [t, d];
        })
      );
    }

    setDevices(entries);
    setRefreshing(false);
  }

  useEffect(() => {
    setSelectedDev(new Set());
    setDevices([]);

    LoadEm();
  }, [transports, open, setDevices]);

  const onRefresh = useCallback(() => {
    setSelectedDev(new Set());
    setDevices([]);

    LoadEm();
  }, [setDevices]);

  const onSelect = useCallback(
    async (keys: Selection) => {
      if (keys === "all") {
        return;
      }
      const dev = devices.find(([_t, d]) => keys.has(d.id));
      if (dev) {
        dev[0]
          .pick_and_connect!.connect(dev[1])
          .then(onTransportCreated)
          .catch((e) => alert(e));
      }
    },
    [devices, onTransportCreated]
  );

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto]">
        <label>Select A Device:</label>
        <button
          className="p-1 rounded hover:bg-base-300 disabled:bg-base-100 disabled:opacity-75"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw
            className={`size-5 transition-transform ${
              refreshing ? "animate-spin" : ""
            }`}
          />
        </button>
      </div>
      <ListBox
        aria-label="Device"
        items={devices}
        onSelectionChange={onSelect}
        selectionMode="single"
        selectedKeys={selectedDev}
        className="flex flex-col gap-1 pt-1"
      >
        {([t, d]) => (
          <ListBoxItem
            className="grid grid-cols-[1em_1fr] rounded hover:bg-base-300 cursor-pointer px-1"
            id={d.id}
            aria-label={d.label}
          >
            {t.isWireless && (
              <Bluetooth className="w-4 justify-center content-center h-full" />
            )}
            <span className="col-start-2">{d.label}</span>
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
}

function simpleDevicePicker(
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void
) {
  const [availableDevices, setAvailableDevices] = useState<
    AvailableDevice[] | undefined
  >(undefined);
  const [selectedTransport, setSelectedTransport] = useState<
    TransportFactory | undefined
  >(undefined);

  useEffect(() => {
    if (!selectedTransport) {
      setAvailableDevices(undefined);
      return;
    }

    let ignore = false;

    if (selectedTransport.connect) {
      async function connectTransport() {
        try {
          const transport = await selectedTransport?.connect?.();

          if (!ignore) {
            if (transport) {
              onTransportCreated(transport);
            }
            setSelectedTransport(undefined);
          }
        } catch (e) {
          if (!ignore) {
            console.error(e);
            if (e instanceof Error && !(e instanceof UserCancelledError)) {
              alert(e.message);
            }
            setSelectedTransport(undefined);
          }
        }
      }

      connectTransport();
    } else {
      async function loadAvailableDevices() {
        const devices = await selectedTransport?.pick_and_connect?.list();

        if (!ignore) {
          setAvailableDevices(devices);
        }
      }

      loadAvailableDevices();
    }

    return () => {
      ignore = true;
    };
  }, [selectedTransport]);

  let connections = transports.map((t) => (
    <li key={t.label} className="list-none">
      <button
        className="bg-base-300 hover:bg-primary hover:text-primary-content rounded px-2 py-1"
        type="button"
        onClick={async () => setSelectedTransport(t)}
      >
        {t.label}
      </button>
    </li>
  ));
  return (
    <div>
      <p className="text-sm">Select a connection type.</p>
      <ul className="flex gap-2 pt-2">{connections}</ul>
      {selectedTransport && availableDevices && (
        <ul>
          {availableDevices.map((d) => (
            <li
              key={d.id}
              className="m-1 p-1"
              onClick={async () => {
                onTransportCreated(
                  await selectedTransport!.pick_and_connect!.connect(d)
                );
                setSelectedTransport(undefined);
              }}
            >
              {d.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// keys.ryong.com: phones and Safari can't reach a keyboard (no Web Serial / Web Bluetooth). Say so plainly
// and point to where it works, instead of Studio's notice about web APIs.
function noTransportsOptionsPrompt() {
  return (
    // takes the dialog's first focus, so nothing below opens with a focus ring
    <div className="ry-nosupport" tabIndex={-1} ref={(el) => el?.setAttribute("autofocus", "")}>
      <ComputerAnim />
      <p className="ry-nosupport-t">{t("Open this on a computer", "컴퓨터에서 열어주세요")}</p>
      <p>
        {t(
          "Changing keys needs a cable or Bluetooth connection that this browser can't make. Use Chrome or Edge on a Mac or Windows PC, or the desktop app.",
          "키를 바꾸려면 케이블이나 블루투스로 키보드에 연결해야 하는데, 이 브라우저에서는 할 수 없어요. Mac이나 Windows PC의 Chrome·Edge, 또는 데스크톱 앱에서 열어주세요.",
        )}
      </p>
    </div>
  );
}

function connectOptions(
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void,
  open?: boolean
) {
  const useSimplePicker = useMemo(
    () => transports.every((t) => !t.pick_and_connect),
    [transports]
  );

  return useSimplePicker
    ? simpleDevicePicker(transports, onTransportCreated)
    : deviceList(open || false, transports, onTransportCreated);
}

export const ConnectModal = ({
  open,
  transports,
  onTransportCreated,
  extra,
  lead,
}: ConnectModalProps) => {
  const dialog = useModalRef(open || false, false, false);

  const haveTransports = useMemo(() => transports.length > 0, [transports]);

  return (
    <GenericModal ref={dialog} className="max-w-xl ry-solid">
      <div className="ry-connect">
        <h1 className="text-xl">Connect a keyboard</h1>
        {haveTransports && lead}
        {haveTransports
          ? connectOptions(transports, onTransportCreated, open)
          : noTransportsOptionsPrompt()}
        {extra}
      </div>
      {/* last, so the dialog still focuses the connection buttons first */}
      <BrandFloat />
    </GenericModal>
  );
};
