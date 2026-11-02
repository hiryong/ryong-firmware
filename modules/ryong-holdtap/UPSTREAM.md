# Selected MIT hold-tap implementation

Imported only hold-tap source/schema from qtrnmr/zmk-module-runtime-config
at 76703f306052a69be869f55d98a518ab92efa020. Original MIT license retained.
Other features excluded to avoid symbol conflicts with the existing modules.
Ryong changes: secured RPC, validate before integer narrowing, bounded timings,
validate persisted records and short reads, propagate reset persistence errors,
and snapshot timing under the store mutex for each active keypress.
Slots belong to compiled behavior instances; this edits timing/flavor, not
arbitrary new hold/tap device types. Default mt/lt parameters remain Studio-editable.

Storage identity is explicit: runtime-slot is required, mt=0 and lt=1 in the
experiment overlays. Devicetree instance enumeration must not change storage
ownership. Duplicate registrations fail instead of replacing another behavior.
The current NVS timing record remains the selected upstream struct format;
versioned product migration and downgrade policy are still release gates.
