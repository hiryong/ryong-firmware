"""Firmware-built combos/macros become editable runtime defaults (scripts/runtime_defaults.py)."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("rd", ROOT / "scripts/runtime_defaults.py")
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
FIX = ROOT / "hardware/test-fixtures/bt60-v2/config"


class RuntimeDefaults(unittest.TestCase):
    def test_bt60_fixture(self):
        out, combos, macros = rd.convert((FIX / "ryong-behaviors.dtsi").read_text(), rd.json_names(FIX / "ryong-behaviors.json"))
        self.assertEqual((combos, macros), (1, 4))
        self.assertIn("/delete-node/ combos;", out)
        self.assertIn('compatible = "cormoran,runtime-combo-defaults";', out)
        self.assertIn('display-name = "Studio Unlock (Esc + Backspace)";', out)
        self.assertIn("bindings = <&studio_unlock>;", out)
        for n in range(4):
            self.assertIn(f'&BT_Profile{n} {{\n    compatible = "ryong,behavior-named-runtime-macro";\n    macro-name = "BT_PROFILE{n}";', out)
        self.assertIn("bindings = <&macro_tap &bt BT_SEL 0 &bt BT_DISC 1 &bt BT_DISC 2 &bt BT_DISC 3>;", out)
        self.assertEqual(out.count('compatible = "cormoran,runtime-macro-default";'), 4)

    def test_refusals(self):
        param = '/ { macros { m: m { compatible = "zmk,behavior-macro-one-param"; }; x: x { compatible = "zmk,behavior-macro"; #binding-cells = <1>; bindings = <&kp A>; }; }; };'
        with self.assertRaises(SystemExit):
            rd.convert(param)
        long = '/ { macros { m: m { compatible = "zmk,behavior-macro"; #binding-cells = <0>; display-name = "' + "x" * 30 + '"; bindings = <&kp A>; }; }; };'
        with self.assertRaises(SystemExit):
            rd.convert(long)
        dup = '/ { macros { a: a { compatible = "zmk,behavior-macro"; #binding-cells = <0>; display-name = "M"; bindings = <&kp A>; }; b: b { compatible = "zmk,behavior-macro"; #binding-cells = <0>; display-name = "M"; bindings = <&kp B>; }; }; };'
        with self.assertRaises(SystemExit):
            rd.convert(dup)

    def test_nothing_to_convert(self):
        out, combos, macros = rd.convert("/ { };")
        self.assertEqual((combos, macros), (0, 0))
        self.assertNotIn("delete-node", out)


if __name__ == "__main__":
    unittest.main()
