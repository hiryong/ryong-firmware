import {createContext} from "react";
import type {RpcConnection} from "@zmkfirmware/zmk-studio-ts-client/index";
export const UpdateConnectionContext=createContext({
 setUpdating:(_value:boolean)=>{},
 adopt:(_conn:RpcConnection,_name:string,_abort:AbortController)=>{},
});
