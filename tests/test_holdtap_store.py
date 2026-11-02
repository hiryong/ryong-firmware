"""Compile the actual settings store against fault-injectable host settings APIs."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class HoldTapStore(unittest.TestCase):
    def test_persistence_failures_and_corrupt_records(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            headers = {
                'zephyr/kernel.h': '#define K_MUTEX_DEFINE(n) int n\n#define K_FOREVER 0\n#define k_mutex_lock(a,b) ((void)0)\n#define k_mutex_unlock(a) ((void)0)\n',
                'zephyr/settings/settings.h': '''#include <stddef.h>
typedef int (*settings_read_cb)(void*,void*,size_t);
int settings_save_one(const char*,const void*,size_t);
int settings_delete(const char*);
#define SETTINGS_STATIC_HANDLER_DEFINE(...)
''',
                'zephyr/sys/printk.h': '#include <stdio.h>\n#define snprintk snprintf\n',
                'zephyr/logging/log.h': '#define LOG_MODULE_DECLARE(...)\n#define LOG_ERR(...)\n',
            }
            for name, text in headers.items():
                f = p / name; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(text)
            source = p / 'test.c'
            source.write_text('''#include <assert.h>
#include <string.h>
#include <errno.h>
#define CONFIG_ZMK_RUNTIME_HOLDTAP_SLOTS 8
#define CONFIG_ZMK_LOG_LEVEL 0
static int failure, writes;
int settings_save_one(const char*k,const void*v,size_t n){writes++;return failure;}
int settings_delete(const char*k){return failure;}
#include "runtime_holdtap_store.c"
static struct rt_holdtap_timing record;
static int length;
static int read_record(void*a,void*b,size_t n){memcpy(b,&record,n);return length;}
int main(void){
 struct rt_holdtap_timing live={200,0,0,0},defaults=live,next={275,100,50,2},got;
 assert(rt_holdtap_register(0,&live,&defaults,"mt")==0);
 struct rt_holdtap_timing duplicate=defaults;
 assert(rt_holdtap_register(0,&duplicate,&defaults,"lt")==-EEXIST);
 assert(rt_holdtap_set(0,&next)==0 && live.tapping_term_ms==275);
 failure=-EIO;next.tapping_term_ms=300;
 assert(rt_holdtap_set(0,&next)==-EIO && live.tapping_term_ms==275);
 assert(rt_holdtap_reset(0)==-EIO && live.tapping_term_ms==275);
 failure=0;assert(rt_holdtap_reset(0)==0 && live.tapping_term_ms==200);
 int oldwrites=writes;next.flavor=255;
 assert(rt_holdtap_set(0,&next)==-EINVAL && writes==oldwrites);
 next.flavor=2;next.tapping_term_ms=0;
 assert(rt_holdtap_set(0,&next)==-EINVAL && writes==oldwrites);
 assert(rt_holdtap_set(7,&defaults)==-EINVAL && writes==oldwrites);
 record=defaults;record.flavor=255;length=sizeof(record);
 assert(rt_holdtap_settings_set("0",sizeof(record),read_record,0)==-EINVAL);
 record=defaults;length=1;
 assert(rt_holdtap_settings_set("0",sizeof(record),read_record,0)==-EINVAL);
 assert(rt_holdtap_get(0,&got)==0 && got.tapping_term_ms==200);
 length=sizeof(record);record.tapping_term_ms=350;
 assert(rt_holdtap_settings_set("0",sizeof(record),read_record,0)==0 && live.tapping_term_ms==350);
 return 0;
}''')
            subprocess.run([os.environ.get('CC', 'cc'), '-std=c11', '-I'+temp,
                '-I'+str(ROOT/'modules/ryong-holdtap/include'),
                '-I'+str(ROOT/'modules/ryong-holdtap/src'), str(source), '-o', str(p/'test')], check=True)
            subprocess.run([str(p/'test')], check=True)

if __name__ == '__main__':
    unittest.main()
