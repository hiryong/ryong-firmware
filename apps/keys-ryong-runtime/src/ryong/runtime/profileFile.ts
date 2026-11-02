import type { BehaviorDoc, Binding } from "../behaviors/model";
import { compileDocument, RuntimeView, viewDocument } from "./modelBridge";

const compatibility = (view:RuntimeView) => ({
  behaviors:Object.keys(view.catalog).sort(),layers:view.layerNames,positions:view.session.port.physicalKeyCount,
});
export function exportProfile(doc: BehaviorDoc, view: RuntimeView) {
  return JSON.stringify({format:"ryong-runtime-backup",version:2,createdAt:new Date().toISOString(),
    compatibility:compatibility(view),
    doc},null,2);
}
/** Restore by names, never trust slots/IDs from an imported file. No I/O. */
export function importProfile(text: string, view: RuntimeView): BehaviorDoc {
  if (text.length > 262144) throw new Error("Backup exceeds 256 KiB.");
  let data = JSON.parse(text);
  if(data?.format === "ryong-update-backup"){
    if(data.version !== 1)throw new Error("Unsupported update backup version.");
    data=data.dynamic;
  }
  if (data?.format !== "ryong-runtime-backup" || data.version !== 2 ||
      JSON.stringify(data.compatibility) !== JSON.stringify(compatibility(view))) {
    throw new Error("Backup format or firmware/layout compatibility differs. No settings changed.");
  }
  const doc = data.doc as BehaviorDoc;
  if (doc?.format !== "ryong-behaviors" || doc.version !== 1 ||
      ![doc.macros,doc.combos,doc.tapDances,doc.settings].every(Array.isArray) ||
      [doc.macros,doc.combos,doc.tapDances,doc.settings].some(items=>items.length>32)) throw new Error("Invalid backup document.");
  const current=viewDocument(view), refs=new Map<string,string>(), ids=new Set<string>();
  for (const kind of ["macros","combos","tapDances"] as const) {
    for (let n=0;n<doc[kind].length;n++) {
      const item=doc[kind][n];
      if(typeof item.id!=="string" || typeof item.name!=="string" || ids.has(item.id)) throw new Error("Invalid backup entry identity.");
      ids.add(item.id);
      const id=current[kind].find(x=>x.name===item.name)?.id ?? "import_"+kind+"_"+n;
      refs.set(item.id,id);item.id=id;
    }
  }
  const remap=(b:Binding)=>{if(b.b==="ref"){const id=refs.get(b.id);if(!id)throw new Error("Missing backup reference.");b.id=id;}};
  doc.combos.forEach(c=>remap(c.binding));doc.tapDances.forEach(d=>d.bindings.forEach(remap));
  doc.macros.forEach(m=>m.steps.forEach(s=>{if("binding" in s)remap(s.binding);}));
  compileDocument(doc,view); // all semantic/capacity validation before displaying
  return doc;
}

export function downloadText(name:string,text:string) {
  const url=URL.createObjectURL(new Blob([text],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
