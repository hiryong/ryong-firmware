"""Compile the actual BLE profile store against a ZMK/Zephyr shim.

Covers owner-bound names, stale tokens, keyboard-side clearing of a
non-selected slot, flash write failure and reboot at each persistence point.
This is a host shim test; it proves nothing about real BLE pairing."""
from pathlib import Path
import os, subprocess, tempfile, unittest

ROOT = Path(__file__).resolve().parents[1]
SHIM = r'''
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <errno.h>
#include <sys/types.h>
#define ZMK_BLE_PROFILE_COUNT 5
#define IS_ENABLED(x) (x + 0)
#define BUILD_ASSERT(x) _Static_assert(x, #x)
#define ARG_UNUSED(x) (void)(x)
#define K_FOREVER 0
#define K_MUTEX_DEFINE(name) int name
#define k_mutex_lock(m, t) (lock_depth++, (void)(m))
#define k_mutex_unlock(m) (lock_depth--, (void)(m))
#define K_SEM_DEFINE(name, a, b) int name
#define k_sem_reset(s) ((void)(s))
#define k_sem_give(s) ((void)(s))
#define k_sem_take(s, t) ((void)(s))
struct k_work { void (*fn)(struct k_work *); };
#define K_WORK_DEFINE(name, f) struct k_work name = {f}
static int k_work_submit(struct k_work *w) { w->fn(w); return 1; }
extern int lock_depth;
uint32_t sys_rand32_get(void);
typedef ssize_t (*settings_read_cb)(void *cb_arg, void *data, size_t len);
typedef int (*settings_set_fn)(const char *, size_t, settings_read_cb, void *);
extern settings_set_fn captured_set;
#define SETTINGS_STATIC_HANDLER_DEFINE(n, root, g, set, c, e) \
  static void __attribute__((constructor)) capture_##n(void) { captured_set = set; }
int settings_name_steq(const char *name, const char *key, const char **next);
int settings_save_one(const char *name, const void *value, size_t len);
int settings_delete(const char *name);
typedef struct { uint8_t type; uint8_t a[6]; } bt_addr_le_t;
bt_addr_le_t *zmk_ble_profile_address(uint8_t);
bool zmk_ble_profile_is_connected(uint8_t);
bool zmk_ble_profile_is_open(uint8_t);
int zmk_ble_active_profile_index(void);
int zmk_ble_prof_select(uint8_t);
void zmk_ble_clear_bonds(void);
int zmk_ble_prof_clear(uint8_t i);
int ryong_host_guard_profile(uint8_t);
'''
HARNESS = r'''
#include <assert.h>
#include <stdio.h>
#include "store.c"
int lock_depth; settings_set_fn captured_set;
static bt_addr_le_t peers[5]; static bool conn[5]; static int active, selects[8], nselect, guards[8], nguard;
static char keys[8][32]; static uint8_t vals[8][64]; static size_t lens[8]; static int fail_save, fail_delete;
uint32_t sys_rand32_get(void){return 0x1234;}
bt_addr_le_t *zmk_ble_profile_address(uint8_t i){return &peers[i];}
static bool empty(int i){static const bt_addr_le_t z;return !memcmp(&peers[i],&z,sizeof z);}
bool zmk_ble_profile_is_open(uint8_t i){return empty(i);}
bool zmk_ble_profile_is_connected(uint8_t i){return conn[i];}
int zmk_ble_active_profile_index(void){return active;}
int zmk_ble_prof_select(uint8_t i){if(i>=5)return -ERANGE;assert(lock_depth==1);selects[nselect++]=i;active=i;return 0;}
void zmk_ble_clear_bonds(void){memset(&peers[active],0,sizeof peers[0]);conn[active]=false;}
int zmk_ble_prof_clear(uint8_t i){if(i>=5)return -ERANGE;memset(&peers[i],0,sizeof peers[0]);conn[i]=false;return 0;}
int ryong_host_guard_profile(uint8_t i){guards[nguard++]=i;return 0;}
static int site_flag;void ryong_bt_log_site_clear(bool on){site_flag=on;}
int settings_name_steq(const char *name,const char *key,const char **next){
 size_t n=strlen(key);if(strncmp(name,key,n))return 0;if(name[n]=='/'){*next=name+n+1;return 1;}if(!name[n]){*next=NULL;return 1;}return 0;}
static int slot(const char *k,int create){
 for(int i=0;i<8;i++){if(lens[i]&&!strcmp(keys[i],k))return i;}
 if(!create)return -1;
 for(int i=0;i<8;i++){if(!lens[i]){strcpy(keys[i],k);return i;}}
 return -1;}
int settings_save_one(const char *k,const void *v,size_t n){if(fail_save)return -EIO;int i=slot(k,1);memcpy(vals[i],v,n);lens[i]=n;return 0;}
int settings_delete(const char *k){if(fail_delete)return -EIO;int i=slot(k,0);if(i>=0)lens[i]=0;return 0;}
static const uint8_t *cursor;
static ssize_t reader(void *arg,void *data,size_t n){(void)arg;memcpy(data,cursor,n);return (ssize_t)n;}
static void reboot(void){
 memset(names,0,sizeof names);salted=false;
 for(int i=0;i<8;i++)if(lens[i]){assert(!strncmp(keys[i],"ryong_bt/",9));cursor=vals[i];assert(captured_set(keys[i]+9,lens[i],reader,NULL)==0);}
}
static int stored(void){int n=0;for(int i=0;i<8;i++)n+=lens[i]!=0;return n;}
static struct ryong_bt_profile_info info(int i){struct ryong_bt_profile_info x;assert(ryong_bt_profile_info(i,&x)==0);return x;}
static void pair(int i,uint8_t tag){peers[i].type=1;memset(peers[i].a,tag,6);}
#define RENAME(i,tok,s) ryong_bt_profile_rename(i,tok,s,strlen(s))
int main(void){
 assert(captured_set);
 pair(0,0xa1);pair(2,0xb2);conn[0]=true;active=0;
 assert(info(0).bonded&&info(0).connected&&!info(1).bonded&&info(1).token==0&&info(2).bonded&&!info(2).connected);
 uint32_t t0=info(0).token,t2=info(2).token;assert(t0&&t2&&t0!=t2);
 /* Name lifecycle, bound to the real bond and persisted. */
 assert(RENAME(0,t0,"맥북")==0&&!strcmp(info(0).name,"맥북"));
 assert(RENAME(0,t0+1,"x")==-ESTALE&&RENAME(1,0,"x")==-ENOENT&&RENAME(0,t0," x")==-EINVAL);
 reboot();t0=info(0).token;assert(!strcmp(info(0).name,"맥북"));
 /* Flash refusal keeps RAM and flash unchanged. */
 fail_save=1;assert(RENAME(2,t2,"회사 PC")==-EIO);fail_save=0;assert(!info(2).name[0]);reboot();assert(!info(2).name[0]);
 t2=info(2).token;assert(RENAME(2,t2,"회사 PC")==0&&stored()==2);
 /* Re-pairing outside the app (BT_CLR + new host): old name never shown, purge deletes it. */
 pair(0,0xc3);assert(!info(0).name[0]);assert(ryong_bt_profiles_purge_stale()==0&&stored()==1);
 assert(RENAME(0,t0,"stale")==-ESTALE);
 /* Clear a non-selected slot: active selection restored, name and OS records removed. */
 active=0;nselect=0;nguard=0;assert(ryong_bt_profile_clear(2,t2)==0);
 assert(!info(2).bonded&&active==0&&nselect==0);
#if CONFIG_RYONG_HOST_LAYOUT
 assert(nguard==1&&guards[0]==2);
#else
 assert(nguard==0);
#endif
 assert(stored()==0);
 assert(ryong_bt_profile_clear(2,t2)==-ENOENT);
 /* Clearing the selected slot keeps it selected (ready to pair), no extra selects. */
 pair(4,0xd4);active=4;nselect=0;uint32_t t4=info(4).token;assert(RENAME(4,t4,"아이폰")==0);
 assert(ryong_bt_profile_clear(4,t4+1)==-ESTALE&&info(4).bonded);
 /* Power loss after unpair, before name deletion: name stays hidden; next purge removes it. */
 fail_delete=1;assert(ryong_bt_profile_clear(4,t4)==-EIO);fail_delete=0;
 assert(!info(4).bonded&&nselect==0&&active==4&&!info(4).name[0]&&stored()==1);
 reboot();assert(!info(4).name[0]);assert(ryong_bt_profiles_purge_stale()==0&&stored()==0);
 /* Selection bounds. */
 assert(ryong_bt_profile_select(3)==0&&active==3&&ryong_bt_profile_select(5)==-EINVAL);
 /* Empty name removes the label. */
 pair(1,0xe5);uint32_t t1=info(1).token;assert(RENAME(1,t1,"Work")==0&&RENAME(1,t1,"")==0&&stored()==0);
 /* Corrupt or out-of-range flash records are ignored at boot. */
 cursor=(const uint8_t*)"zz";assert(captured_set("name/9",2,reader,NULL)==-EINVAL&&captured_set("other",2,reader,NULL)==-ENOENT);
 assert(lock_depth==0);
 puts("BLE profile store shim passed");
 return 0;
}
'''

class BleProfileStore(unittest.TestCase):
    def build_and_run(self, host_layout):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t)
            (p / 'shim.h').write_text(SHIM)
            for name in ['zephyr/kernel.h', 'zephyr/random/random.h', 'zephyr/settings/settings.h',
                         'zephyr/bluetooth/addr.h', 'zmk/ble.h', 'ryong/host_bond.h']:
                h = p / name
                h.parent.mkdir(parents=True, exist_ok=True)
                h.write_text('#include "shim.h"\n')
            (p / 'store.c').write_bytes((ROOT / 'modules/ryong-ble-profiles/src/profile_store.c').read_bytes())
            (p / 'test.c').write_text(HARNESS)
            inc = ROOT / 'modules/ryong-ble-profiles/include'
            flags = ['-DCONFIG_RYONG_HOST_LAYOUT=1'] if host_layout else []
            for cmd in ([os.environ.get('CC', 'cc'), '-std=gnu11', '-Wall', '-Wextra', '-Werror', *flags,
                         '-I' + str(p), '-I' + str(inc), str(p / 'test.c'),
                         str(ROOT / 'modules/ryong-ble-profiles/src/profile_core.c'), '-o', str(p / 'test')],
                        [str(p / 'test')]):
                r = subprocess.run(cmd, capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_without_host_layout(self):
        self.build_and_run(False)

    def test_with_host_layout_guard(self):
        self.build_and_run(True)

if __name__ == '__main__':
    unittest.main()
