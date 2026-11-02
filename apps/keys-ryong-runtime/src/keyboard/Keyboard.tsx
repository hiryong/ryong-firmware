import { RuntimeBindingPicker } from "../ryong/runtime/RuntimeBindingPicker";
import { ViaKeyGrid } from "../ryong/runtime/ViaKeyGrid";
import React, {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Request } from "@zmkfirmware/zmk-studio-ts-client";
import { call_rpc } from "../rpc/logging";
import {
  PhysicalLayout,
  Keymap,
  SetLayerBindingResponse,
  SetLayerPropsResponse,
  BehaviorBinding,
  Layer,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import { LayerPicker } from "./LayerPicker";
import { PhysicalLayoutPicker } from "./PhysicalLayoutPicker";
import { Keymap as KeymapComp } from "./Keymap";
import { useConnectedDeviceData } from "../rpc/useConnectedDeviceData";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { UndoRedoContext } from "../undoRedo";
import { BehaviorBindingPicker } from "../behaviors/BehaviorBindingPicker";
import { produce } from "immer";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { deserializeLayoutZoom, LayoutZoom } from "./PhysicalLayout";
import { useLocalStorageState } from "../misc/useLocalStorageState";
import { t as tr } from "../ryong/i18n";

type BehaviorMap = Record<number, GetBehaviorDetailsResponse>;

function useBehaviors(): BehaviorMap {
  let connection = useContext(ConnectionContext);
  let lockState = useContext(LockStateContext);

  const [behaviors, setBehaviors] = useState<BehaviorMap>({});

  useEffect(() => {
    if (
      !connection.conn ||
      lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED
    ) {
      setBehaviors({});
      return;
    }

    async function startRequest() {
      setBehaviors({});

      if (!connection.conn) {
        return;
      }

      let get_behaviors: Request = {
        behaviors: { listAllBehaviors: true },
        requestId: 0,
      };

      let behavior_list = await call_rpc(connection.conn, get_behaviors);
      if (!ignore) {
        let behavior_map: BehaviorMap = {};
        for (let behaviorId of behavior_list.behaviors?.listAllBehaviors
          ?.behaviors || []) {
          if (ignore) {
            break;
          }
          let details_req = {
            behaviors: { getBehaviorDetails: { behaviorId } },
            requestId: 0,
          };
          let behavior_details = await call_rpc(connection.conn, details_req);
          let dets: GetBehaviorDetailsResponse | undefined =
            behavior_details?.behaviors?.getBehaviorDetails;

          if (dets) {
            behavior_map[dets.id] = dets;
          }
        }

        if (!ignore) {
          setBehaviors(behavior_map);
        }
      }
    }

    let ignore = false;
    startRequest();

    return () => {
      ignore = true;
    };
  }, [connection, lockState]);

  return behaviors;
}

function useLayouts(): [
  PhysicalLayout[] | undefined,
  React.Dispatch<SetStateAction<PhysicalLayout[] | undefined>>,
  number,
  React.Dispatch<SetStateAction<number>>
] {
  let connection = useContext(ConnectionContext);
  let lockState = useContext(LockStateContext);

  const [layouts, setLayouts] = useState<PhysicalLayout[] | undefined>(
    undefined
  );
  const [selectedPhysicalLayoutIndex, setSelectedPhysicalLayoutIndex] =
    useState<number>(0);

  useEffect(() => {
    if (
      !connection.conn ||
      lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED
    ) {
      setLayouts(undefined);
      return;
    }

    async function startRequest() {
      setLayouts(undefined);

      if (!connection.conn) {
        return;
      }

      let response = await call_rpc(connection.conn, {
        keymap: { getPhysicalLayouts: true },
      });

      if (!ignore) {
        setLayouts(response?.keymap?.getPhysicalLayouts?.layouts);
        setSelectedPhysicalLayoutIndex(
          response?.keymap?.getPhysicalLayouts?.activeLayoutIndex || 0
        );
      }
    }

    let ignore = false;
    startRequest();

    return () => {
      ignore = true;
    };
  }, [connection, lockState]);

  return [
    layouts,
    setLayouts,
    selectedPhysicalLayoutIndex,
    setSelectedPhysicalLayoutIndex,
  ];
}

export default function Keyboard() {
  const [
    layouts,
    _setLayouts,
    selectedPhysicalLayoutIndex,
    setSelectedPhysicalLayoutIndex,
  ] = useLayouts();
  const [keymap, setKeymap] = useConnectedDeviceData<Keymap>(
    { keymap: { getKeymap: true } },
    (keymap) => {
      console.log("Got the keymap!");
      return keymap?.keymap?.getKeymap;
    },
    true
  );

  // keys.ryong.com: flat (2D) or keycaps seen from slightly above (3D)
  const [keymapView, setKeymapView] = useLocalStorageState<"2d" | "3d">("keymapView", "2d");
  // Runtime copy: the VIA-style grid is the main picker; Studio's detailed editor opens on request.
  const [detailPicker, setDetailPicker] = useLocalStorageState<boolean>("ryong.detailPicker", false);
  const viaFirst = import.meta.env.VITE_RYONG_RUNTIME === "1";
  // Runtime copy: the layer menu stays at the screen's left edge, its top level with the keyboard's top edge;
  // the keyboard keeps generous margins in the space to the right of the menu.
  const canvasRef = useRef<HTMLDivElement>(null), layerMenuRef = useRef<HTMLDivElement>(null);
  const [layerMenuPos, setLayerMenuPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!viaFirst) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const board = canvas.querySelector(".ry-tilt > *"), menu = layerMenuRef.current;
        if (!board || !menu) return;
        const reserve = menu.offsetLeft + menu.offsetWidth + "px";
        if (canvas.style.getPropertyValue("--ry-menu") !== reserve) { canvas.style.setProperty("--ry-menu", reserve); place(); return; }
        const c = canvas.getBoundingClientRect(), b = board.getBoundingClientRect();
        const left = 16, top = Math.max(8, b.top - c.top);
        setLayerMenuPos(p => p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top });
      });
    };
    const observer = new ResizeObserver(place);
    observer.observe(canvas);
    const board = canvas.querySelector(".ry-tilt > *");
    if (board) observer.observe(board);
    if (layerMenuRef.current) observer.observe(layerMenuRef.current);
    canvas.addEventListener("animationend", place);
    window.addEventListener("resize", place);
    const settle = setTimeout(place, 250); // after auto-zoom has applied its scale
    place();
    return () => { observer.disconnect(); canvas.removeEventListener("animationend", place); window.removeEventListener("resize", place); clearTimeout(settle); cancelAnimationFrame(frame); };
  });
  const [keymapScale, setKeymapScale] = useLocalStorageState<LayoutZoom>("keymapScale", "auto", {
    deserialize: deserializeLayoutZoom,
  });

  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(0);
  const [selectedKeyPosition, setSelectedKeyPosition] = useState<
    number | undefined
  >(undefined);
  const behaviors = useBehaviors();

  const conn = useContext(ConnectionContext);
  const undoRedo = useContext(UndoRedoContext);

  useEffect(() => {
    setSelectedLayerIndex(0);
    setSelectedKeyPosition(undefined);
  }, [conn]);

  useEffect(() => {
    async function performSetRequest() {
      if (!conn.conn || !layouts) {
        return;
      }

      let resp = await call_rpc(conn.conn, {
        keymap: { setActivePhysicalLayout: selectedPhysicalLayoutIndex },
      });

      let new_keymap = resp?.keymap?.setActivePhysicalLayout?.ok;
      if (new_keymap) {
        setKeymap(new_keymap);
      } else {
        console.error(
          "Failed to set the active physical layout err:",
          resp?.keymap?.setActivePhysicalLayout?.err
        );
      }
    }

    performSetRequest();
  }, [selectedPhysicalLayoutIndex]);

  let doSelectPhysicalLayout = useCallback(
    (i: number) => {
      let oldLayout = selectedPhysicalLayoutIndex;
      undoRedo?.(async () => {
        setSelectedPhysicalLayoutIndex(i);

        return async () => {
          setSelectedPhysicalLayoutIndex(oldLayout);
        };
      });
    },
    [undoRedo, selectedPhysicalLayoutIndex]
  );

  let doUpdateBinding = useCallback(
    (binding: BehaviorBinding) => {
      if (!keymap || selectedKeyPosition === undefined) {
        console.error(
          "Can't update binding without a selected key position and loaded keymap"
        );
        return;
      }

      const layer = selectedLayerIndex;
      const layerId = keymap.layers[layer].id;
      const keyPosition = selectedKeyPosition;
      const oldBinding = keymap.layers[layer].bindings[keyPosition];
      undoRedo?.(async () => {
        if (!conn.conn) {
          throw new Error("Not connected");
        }

        let resp = await call_rpc(conn.conn, {
          keymap: { setLayerBinding: { layerId, keyPosition, binding } },
        });

        if (
          resp.keymap?.setLayerBinding ===
          SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
        ) {
          setKeymap(
            produce((draft: any) => {
              draft.layers[layer].bindings[keyPosition] = binding;
            })
          );
        } else {
          console.error("Failed to set binding", resp.keymap?.setLayerBinding);
        }

        return async () => {
          if (!conn.conn) {
            return;
          }

          let resp = await call_rpc(conn.conn, {
            keymap: {
              setLayerBinding: { layerId, keyPosition, binding: oldBinding },
            },
          });
          if (
            resp.keymap?.setLayerBinding ===
            SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
          ) {
            setKeymap(
              produce((draft: any) => {
                draft.layers[layer].bindings[keyPosition] = oldBinding;
              })
            );
          } else {
          }
        };
      });
    },
    [conn, keymap, undoRedo, selectedLayerIndex, selectedKeyPosition]
  );

  let selectedBinding = useMemo(() => {
    if (keymap == null || selectedKeyPosition == null || !keymap.layers[selectedLayerIndex]) {
      return null;
    }

    return keymap.layers[selectedLayerIndex].bindings[selectedKeyPosition];
  }, [keymap, selectedLayerIndex, selectedKeyPosition]);

  const moveLayer = useCallback(
    (start: number, end: number) => {
      const doMove = async (startIndex: number, destIndex: number) => {
        if (!conn.conn) {
          return;
        }

        let resp = await call_rpc(conn.conn, {
          keymap: { moveLayer: { startIndex, destIndex } },
        });

        if (resp.keymap?.moveLayer?.ok) {
          setKeymap(resp.keymap?.moveLayer?.ok);
          setSelectedLayerIndex(destIndex);
        } else {
          console.error("Error moving", resp);
        }
      };

      undoRedo?.(async () => {
        await doMove(start, end);
        return () => doMove(end, start);
      });
    },
    [undoRedo]
  );

  const addLayer = useCallback(() => {
    async function doAdd(): Promise<number> {
      if (!conn.conn || !keymap) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, { keymap: { addLayer: {} } });

      if (resp.keymap?.addLayer?.ok) {
        const newSelection = keymap.layers.length;
        setKeymap(
          produce((draft: any) => {
            draft.layers.push(resp.keymap!.addLayer!.ok!.layer);
            draft.availableLayers--;
          })
        );

        setSelectedLayerIndex(newSelection);

        return resp.keymap.addLayer.ok.index;
      } else {
        console.error("Add error", resp.keymap?.addLayer?.err);
        throw new Error("Failed to add layer:" + resp.keymap?.addLayer?.err);
      }
    }

    async function doRemove(layerIndex: number) {
      if (!conn.conn) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { removeLayer: { layerIndex } },
      });

      console.log(resp);
      if (resp.keymap?.removeLayer?.ok) {
        setKeymap(
          produce((draft: any) => {
            draft.layers.splice(layerIndex, 1);
            draft.availableLayers++;
          })
        );
      } else {
        console.error("Remove error", resp.keymap?.removeLayer?.err);
        throw new Error(
          "Failed to remove layer:" + resp.keymap?.removeLayer?.err
        );
      }
    }

    undoRedo?.(async () => {
      let index = await doAdd();
      return () => doRemove(index);
    });
  }, [conn, undoRedo, keymap]);

  const removeLayer = useCallback(() => {
    async function doRemove(layerIndex: number): Promise<void> {
      if (!conn.conn || !keymap) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { removeLayer: { layerIndex } },
      });

      if (resp.keymap?.removeLayer?.ok) {
        if (layerIndex == keymap.layers.length - 1) {
          setSelectedLayerIndex(layerIndex - 1);
        }
        setKeymap(
          produce((draft: any) => {
            draft.layers.splice(layerIndex, 1);
            draft.availableLayers++;
          })
        );
      } else {
        console.error("Remove error", resp.keymap?.removeLayer?.err);
        throw new Error(
          "Failed to remove layer:" + resp.keymap?.removeLayer?.err
        );
      }
    }

    async function doRestore(layerId: number, atIndex: number) {
      if (!conn.conn) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { restoreLayer: { layerId, atIndex } },
      });

      console.log(resp);
      if (resp.keymap?.restoreLayer?.ok) {
        setKeymap(
          produce((draft: any) => {
            draft.layers.splice(atIndex, 0, resp!.keymap!.restoreLayer!.ok);
            draft.availableLayers--;
          })
        );
        setSelectedLayerIndex(atIndex);
      } else {
        console.error("Remove error", resp.keymap?.restoreLayer?.err);
        throw new Error(
          "Failed to restore layer:" + resp.keymap?.restoreLayer?.err
        );
      }
    }

    if (!keymap) {
      throw new Error("No keymap loaded");
    }

    let index = selectedLayerIndex;
    let layerId = keymap.layers[index].id;
    undoRedo?.(async () => {
      await doRemove(index);
      return () => doRestore(layerId, index);
    });
  }, [conn, undoRedo, selectedLayerIndex]);

  const changeLayerName = useCallback(
    (id: number, oldName: string, newName: string) => {
      async function changeName(layerId: number, name: string) {
        if (!conn.conn) {
          throw new Error("Not connected");
        }

        const resp = await call_rpc(conn.conn, {
          keymap: { setLayerProps: { layerId, name } },
        });

        if (
          resp.keymap?.setLayerProps ==
          SetLayerPropsResponse.SET_LAYER_PROPS_RESP_OK
        ) {
          setKeymap(
            produce((draft: any) => {
              const layer_index = draft.layers.findIndex(
                (l: Layer) => l.id == layerId
              );
              draft.layers[layer_index].name = name;
            })
          );
        } else {
          throw new Error(
            "Failed to change layer name:" + resp.keymap?.setLayerProps
          );
        }
      }

      undoRedo?.(async () => {
        await changeName(id, newName);
        return async () => {
          await changeName(id, oldName);
        };
      });
    },
    [conn, undoRedo, keymap]
  );

  useEffect(() => {
    if (!keymap?.layers) return;

    const layers = keymap.layers.length - 1;

    if (selectedLayerIndex > layers) {
      setSelectedLayerIndex(layers);
    }
  }, [keymap, selectedLayerIndex]);

  return (
    <div className={viaFirst
      ? "ry-canvas ry-canvas-float relative grid grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] bg-base-300 max-w-full min-w-0 min-h-0"
      : "ry-canvas grid grid-cols-[auto_1fr] grid-rows-[1fr_minmax(10em,auto)] bg-base-300 max-w-full min-w-0 min-h-0"} ref={canvasRef}>
      {/* runtime copy: layers float beside the keyboard instead of taking a full-height column */}
      <div className={viaFirst ? "ry-layer-float" : "p-2 flex flex-col gap-2 bg-base-200 row-span-2"} ref={layerMenuRef}
        style={viaFirst ? (layerMenuPos ? { left: layerMenuPos.left, top: layerMenuPos.top } : { visibility: "hidden" }) : undefined}>
        {/* the keyboard reports its own layouts; a single one is not a choice, so it is not shown */}
        {layouts && (!viaFirst || layouts.length > 1) && (
          <div className="col-start-3 row-start-1 row-end-2">
            <PhysicalLayoutPicker
              layouts={layouts}
              selectedPhysicalLayoutIndex={selectedPhysicalLayoutIndex}
              onPhysicalLayoutClicked={doSelectPhysicalLayout}
            />
          </div>
        )}

        {keymap && (
          <div className="col-start-1 row-start-1 row-end-2">
            <LayerPicker
              layers={keymap.layers}
              selectedLayerIndex={selectedLayerIndex}
              onLayerClicked={setSelectedLayerIndex}
              onLayerMoved={moveLayer}
              canAdd={(keymap.availableLayers || 0) > 0}
              canRemove={(keymap.layers?.length || 0) > 1}
              onAddClicked={addLayer}
              onRemoveClicked={removeLayer}
              onLayerNameChanged={changeLayerName}
            />
          </div>
        )}
      </div>
      {layouts && keymap && behaviors && (
        <div className={(viaFirst ? "ry-keys-float " : "") + "p-2 " + (viaFirst ? "col-start-1" : "col-start-2") + " row-start-1 grid items-center justify-center relative min-w-0"}>
          <div className={keymapView === "3d" ? "ry-view-3d" : "ry-view-2d"}>
          <div className="ry-tilt" key={keymapView}>
          <KeymapComp
            keymap={keymap}
            layout={layouts[selectedPhysicalLayoutIndex]}
            behaviors={behaviors}
            scale={keymapScale}
            selectedLayerIndex={selectedLayerIndex}
            selectedKeyPosition={selectedKeyPosition}
            onKeyPositionClicked={setSelectedKeyPosition}
          />
          </div>
          </div>
          <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
          <div className="ry-seg" role="group" aria-label="View">
            {/* icons only: a key seen from above, and a keycap seen from above and in front; the name shows on hover */}
            <button aria-pressed={keymapView === "2d"} onClick={() => setKeymapView("2d")} aria-label={tr("Flat view", "평면 보기")} data-tip={tr("Flat", "평면")}>
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="3.5" width="13" height="13" rx="3" />
              </svg>
            </button>
            <button aria-pressed={keymapView === "3d"} onClick={() => setKeymapView("3d")} aria-label={tr("Keycap view", "키캡 보기")} data-tip={tr("Keycaps", "키캡")}>
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
                {/* seen from above and in front, like the keycap view: the foot, and the smaller top set back on it */}
                {/* drawn a little larger and a hair bolder than the flat square: its inner lines make it read smaller and lighter */}
                <rect x="2.4" y="2.9" width="15.2" height="14.2" rx="3.2" />
                <rect x="5" y="4.2" width="10" height="8.6" rx="1.9" />
                <path d="M5.5 12.5 3.3 16.2M14.5 12.5l2.2 3.7" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <select
            className="h-8 rounded px-2"
            value={keymapScale}
            onChange={(e) => {
              const value = deserializeLayoutZoom(e.target.value);
              setKeymapScale(value);
            }}
          >
            <option value="auto">Auto</option>
            <option value={0.25}>25%</option>
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
          </div>
        </div>
      )}
      {keymap && selectedBinding && (viaFirst ? (
        <div className="ry-picker-panel col-start-1 row-start-2">
          <ViaKeyGrid behaviors={Object.values(behaviors)} binding={selectedBinding}
            layers={keymap.layers.map(({ id, name }) => ({ id, name }))} onChange={doUpdateBinding}
            detail={detailPicker} onDetail={setDetailPicker}>
            <RuntimeBindingPicker binding={selectedBinding} onChange={doUpdateBinding} />
            <BehaviorBindingPicker binding={selectedBinding} behaviors={Object.values(behaviors)}
              layers={keymap.layers.map(({ id, name }, li) => ({ id, name: name || li.toLocaleString() }))}
              onBindingChanged={doUpdateBinding} />
          </ViaKeyGrid>
        </div>
      ) : (
        <div className="p-2 col-start-2 row-start-2 bg-base-200">
          <BehaviorBindingPicker
            binding={selectedBinding}
            behaviors={Object.values(behaviors)}
            layers={keymap.layers.map(({ id, name }, li) => ({
              id,
              name: name || li.toLocaleString(),
            }))}
            onBindingChanged={doUpdateBinding}
          />
        </div>
      ))}
    </div>
  );
}
